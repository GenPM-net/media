// Importa una imagen desde una URL remota a la biblioteca (para importaciones de proveedores o migraciones).
// Protección SSRF: solo https, solo hosts de la lista permitida (también tras redirecciones), tamaño y tiempo máximos,
// y el contenido debe ser una imagen real (se comprueba por bytes y se le quitan los metadatos).
import { type Executor, getDb, newId } from '../db/index.ts';
import { getStorage } from '../storage/index.ts';
import { ALLOWED, MediaError } from './library.ts';
import { type Media, media } from './schema.ts';
import { imageSize, sniff } from './sniff.ts';
import { MalformedImageError, stripMetadata } from './strip.ts';

export type RemoteImageOptions = {
  /** Hosts exactos permitidos (`ae01.alicdn.com`) o sufijos con punto inicial (`.alicdn.com`). */
  allowedHosts: string[];
  maxBytes?: number;
  alt?: string;
  folder?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

const hostAllowed = (host: string, allowed: string[]) =>
  allowed.some((a) => (a.startsWith('.') ? host.endsWith(a) && host.length > a.length : host === a));

export async function importRemoteImage(url: string, opts: RemoteImageOptions, db: Executor = getDb()): Promise<Media> {
  const doFetch = opts.fetch ?? fetch;
  const maxBytes = Math.min(opts.maxBytes ?? 10 * 1024 * 1024, 15 * 1024 * 1024);
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 15_000);
  let current = url;
  let res: Response | null = null;
  for (let hop = 0; hop < 4; hop++) {
    let u: URL;
    try {
      u = new URL(current);
    } catch {
      throw new MediaError('invalid_input', 'invalid image URL');
    }
    if (u.protocol !== 'https:' || u.username || u.password || !hostAllowed(u.hostname.toLowerCase(), opts.allowedHosts))
      throw new MediaError('invalid_input', `image host not allowed: ${u.hostname}`);
    res = await doFetch(u.toString(), { redirect: 'manual', signal, headers: { accept: 'image/*' } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location')!, u).toString();
      continue;
    }
    break;
  }
  if (!res || !res.ok || !res.body) throw new MediaError('invalid_input', `image download failed (${res?.status ?? 'no response'})`);
  if (Number(res.headers.get('content-length') ?? 0) > maxBytes) throw new MediaError('too_large', 'image too large');
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new MediaError('too_large', 'image too large');
    }
    chunks.push(value);
  }
  let bytes = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) {
    bytes.set(c, o);
    o += c.byteLength;
  }
  const type = sniff(bytes);
  if (!type || !type.startsWith('image/')) throw new MediaError('type_mismatch', 'not an image');
  try {
    bytes = stripMetadata(bytes, type) as Uint8Array<ArrayBuffer>;
  } catch (e) {
    if (e instanceof MalformedImageError) throw new MediaError('type_mismatch', `malformed ${type}`);
    throw e;
  }
  const dims = imageSize(bytes, type);
  const id = newId('med');
  const now = new Date();
  const key = `public/media/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id.slice(4).toLowerCase()}.${ALLOWED[type].ext}`;
  await getStorage().put(key, bytes, { contentType: type, cacheControl: 'public, max-age=31536000, immutable' });
  const filename = decodeURIComponent(new URL(current).pathname.split('/').pop() ?? '').replace(/[^\w.-]/g, '').slice(0, 200) || `image.${ALLOWED[type].ext}`;
  const [row] = await db
    .insert(media)
    .values({ id, key, filename, mime: type, size: bytes.length, width: dims?.width ?? null, height: dims?.height ?? null, alt: (opts.alt ?? '').slice(0, 500), folder: opts.folder ?? '', status: 'ready' })
    .returning();
  return row!;
}
