// Biblioteca de medios: subida directa firmada, confirmación con comprobación del tipo real, limpieza de metadatos.
import { eq } from 'drizzle-orm';
import { type Executor, getDb, newId } from '../db/index.ts';
import { getStorage, type PresignedUpload } from '../storage/index.ts';
import { type Media, media } from './schema.ts';
import { imageSize, type SniffedType, sniff } from './sniff.ts';
import { MalformedImageError, stripMetadata } from './strip.ts';
import { imgAttrs } from './urls.ts';

export class MediaError extends Error {
  constructor(
    readonly code: 'unsupported_type' | 'too_large' | 'type_mismatch' | 'not_found' | 'invalid_state' | 'invalid_input' | 'forbidden',
    message: string = code,
  ) {
    super(message);
    this.name = 'MediaError';
  }
}

const MB = 1024 * 1024;

/** Tipos admitidos, extensión y tamaño máximo. SVG no se admite (puede contener scripts). */
export const ALLOWED: Record<SniffedType, { ext: string; maxBytes: number }> = {
  'image/jpeg': { ext: 'jpg', maxBytes: 15 * MB },
  'image/png': { ext: 'png', maxBytes: 15 * MB },
  'image/gif': { ext: 'gif', maxBytes: 10 * MB },
  'image/webp': { ext: 'webp', maxBytes: 15 * MB },
  'image/avif': { ext: 'avif', maxBytes: 15 * MB },
  'application/pdf': { ext: 'pdf', maxBytes: 25 * MB },
  'video/mp4': { ext: 'mp4', maxBytes: 200 * MB },
  'video/webm': { ext: 'webm', maxBytes: 200 * MB },
};

const isAllowed = (mime: string): mime is SniffedType => mime in ALLOWED;

const FOLDER_RE = /^([a-z0-9][a-z0-9-]{0,40}(\/[a-z0-9][a-z0-9-]{0,40}){0,3})?$/;

/**
 * Clave privada donde sube el navegador. La URL firmada puede reutilizarse hasta que caduca, así que nunca apunta a la
 * clave pública final: `confirmUpload` lee de aquí, valida y limpia, y escribe él mismo los bytes en `public/`.
 */
export const stagingKey = (m: Pick<Media, 'id' | 'mime'>) => `uploads/pending/${m.id}.${isAllowed(m.mime) ? ALLOWED[m.mime].ext : 'bin'}`;

export type CreateUploadInput = { filename: string; mime: string; size: number; folder?: string; alt?: string; uploadedBy?: string | null };

/** Reserva un medio `pending` y devuelve la URL firmada para subirlo directamente desde el navegador. */
export async function createUpload(input: CreateUploadInput, db: Executor = getDb()): Promise<{ media: Media; upload: PresignedUpload }> {
  if (!isAllowed(input.mime)) throw new MediaError('unsupported_type', `unsupported type: ${input.mime}`);
  const { ext, maxBytes } = ALLOWED[input.mime];
  if (!Number.isInteger(input.size) || input.size <= 0 || input.size > maxBytes) throw new MediaError('too_large', `max ${maxBytes} bytes for ${input.mime}`);
  const folder = input.folder ?? '';
  if (!FOLDER_RE.test(folder)) throw new MediaError('invalid_input', `invalid folder: ${folder}`);
  const id = newId('med');
  const now = new Date();
  const key = `public/media/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id.slice(4).toLowerCase()}.${ext}`;
  const filename = input.filename.replace(/[\u0000-\u001f\\/]/g, '').slice(0, 200) || `file.${ext}`;
  const [row] = await db
    .insert(media)
    .values({ id, key, filename, mime: input.mime, size: input.size, folder, alt: (input.alt ?? '').slice(0, 500), uploadedBy: input.uploadedBy ?? null })
    .returning();
  const upload = await getStorage().presignUpload(stagingKey(row!), { contentType: input.mime, size: input.size, maxBytes });
  return { media: row!, upload };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Tras la subida: lee el archivo de la clave de subida privada y comprueba que su contenido es del tipo declarado; si
 * no, lo borra y lo marca `rejected`. En imágenes elimina EXIF/GPS/XMP. Solo entonces escribe los bytes validados en
 * la clave pública final, guarda las dimensiones y borra la copia de subida.
 */
export async function confirmUpload(id: string, db: Executor = getDb()): Promise<Media> {
  const [row] = await db.select().from(media).where(eq(media.id, id));
  if (!row) throw new MediaError('not_found', `media ${id} not found`);
  if (row.status !== 'pending') return row;
  const storage = getStorage();
  const staged = stagingKey(row);
  const obj = await storage.get(staged);
  if (!obj) throw new MediaError('invalid_state', 'file not uploaded yet');
  let bytes = await readAll(obj.body);
  const reject = async (message: string) => {
    await storage.delete(staged);
    await db.update(media).set({ status: 'rejected' }).where(eq(media.id, id));
    return new MediaError('type_mismatch', message);
  };
  const type = sniff(bytes);
  if (type !== row.mime) throw await reject(`content is ${type ?? 'unknown'}, declared ${row.mime}`);
  if (type.startsWith('image/')) {
    try {
      bytes = stripMetadata(bytes, type);
    } catch (e) {
      if (e instanceof MalformedImageError) throw await reject(`malformed ${type}`);
      throw e;
    }
  }
  await storage.put(row.key, bytes, { contentType: type, cacheControl: 'public, max-age=31536000, immutable' });
  await storage.delete(staged);
  const dims = type.startsWith('image/') ? imageSize(bytes, type) : null;
  const [updated] = await db
    .update(media)
    .set({ status: 'ready', size: bytes.length, width: dims?.width ?? null, height: dims?.height ?? null })
    .where(eq(media.id, id))
    .returning();
  return updated!;
}

export async function getMedia(id: string, db: Executor = getDb()): Promise<Media | null> {
  const [row] = await db.select().from(media).where(eq(media.id, id));
  return row ?? null;
}

export async function updateMedia(
  id: string,
  patch: { alt?: string; focalX?: number; focalY?: number; folder?: string; filename?: string },
  db: Executor = getDb(),
): Promise<Media> {
  const clamp = (n: number | undefined) => (n === undefined ? undefined : Math.min(1, Math.max(0, n)));
  if (patch.folder !== undefined && !FOLDER_RE.test(patch.folder)) throw new MediaError('invalid_input', `invalid folder: ${patch.folder}`);
  const [row] = await db
    .update(media)
    .set({
      ...(patch.alt !== undefined && { alt: patch.alt.slice(0, 500) }),
      ...(patch.filename !== undefined && { filename: patch.filename.slice(0, 200) }),
      ...(patch.folder !== undefined && { folder: patch.folder }),
      ...(patch.focalX !== undefined && { focalX: clamp(patch.focalX) }),
      ...(patch.focalY !== undefined && { focalY: clamp(patch.focalY) }),
    })
    .where(eq(media.id, id))
    .returning();
  if (!row) throw new MediaError('not_found', `media ${id} not found`);
  return row;
}

/** Borra el registro y el archivo. */
export async function deleteMedia(id: string, db: Executor = getDb()): Promise<void> {
  const row = await getMedia(id, db);
  if (!row) return;
  await getStorage().delete(row.key);
  if (row.status === 'pending') await getStorage().delete(stagingKey(row));
  await db.delete(media).where(eq(media.id, id));
}

/** Imagen lista para `<img>` (src, srcSet, sizes, dimensiones y alt) o null si no existe o no está lista. */
export async function imageFor(
  id: string | null | undefined,
  opts: { sizes?: string; alt?: string; widths?: number[] } = {},
  db: Executor = getDb(),
): Promise<{ src: string; alt: string; width?: number; height?: number; srcSet?: string; sizes?: string } | null> {
  if (!id) return null;
  const m = await getMedia(id, db);
  if (!m || m.status !== 'ready') return null;
  const a = imgAttrs(m, { ...(opts.sizes && { sizes: opts.sizes }), ...(opts.widths && { widths: opts.widths }) });
  return { src: a.src, alt: opts.alt ?? a.alt, ...(a.width && { width: a.width }), ...(a.height && { height: a.height }), ...(a.srcSet && { srcSet: a.srcSet }), ...(a.sizes && { sizes: a.sizes }) };
}
