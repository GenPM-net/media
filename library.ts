// Biblioteca de medios: subida directa firmada, confirmación con comprobación del tipo real, limpieza de metadatos.
import { eq } from 'drizzle-orm';
import { type Executor, getDb, newId } from '../db/index.js';
import { getStorage, type PresignedUpload } from '../storage/index.js';
import { type Media, media } from './schema.js';
import { imageSize, type SniffedType, sniff } from './sniff.js';
import { stripMetadata } from './strip.js';
import { imgAttrs } from './urls.js';

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
  const upload = await getStorage().presignUpload(key, { contentType: input.mime, size: input.size, maxBytes });
  return { media: row!, upload };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Tras la subida: comprueba que el archivo existe y que su contenido es del tipo declarado; si no, lo borra y lo
 * marca `rejected`. En imágenes elimina EXIF/GPS/XMP y guarda las dimensiones.
 */
export async function confirmUpload(id: string, db: Executor = getDb()): Promise<Media> {
  const [row] = await db.select().from(media).where(eq(media.id, id));
  if (!row) throw new MediaError('not_found', `media ${id} not found`);
  if (row.status !== 'pending') return row;
  const storage = getStorage();
  const obj = await storage.get(row.key);
  if (!obj) throw new MediaError('invalid_state', 'file not uploaded yet');
  let bytes = await readAll(obj.body);
  const type = sniff(bytes);
  if (type !== row.mime) {
    await storage.delete(row.key);
    await db.update(media).set({ status: 'rejected' }).where(eq(media.id, id));
    throw new MediaError('type_mismatch', `content is ${type ?? 'unknown'}, declared ${row.mime}`);
  }
  if (type.startsWith('image/')) {
    const stripped = stripMetadata(bytes, type);
    if (stripped.length !== bytes.length) {
      await storage.put(row.key, stripped, { contentType: type, cacheControl: 'public, max-age=31536000, immutable' });
      bytes = stripped;
    }
  }
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
