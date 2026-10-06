import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AdminContext } from '../contracts/index.js';
import { testDb } from '../db/__fixtures__/pglite.js';
import { backendStorage, getStorage, handleLocalUpload, memoryBackend, setStorage, type StorageProvider } from '../storage/index.js';
import { mediaRoutes } from './adapters/hono.js';
import { confirmUploadRoute, createUploadRoute } from './adapters/next.js';
import * as schema from './schema.js';
import {
  confirmUpload,
  createUpload,
  deleteMedia,
  imageSize,
  imageUrl,
  imgAttrs,
  MediaError,
  mediaAdminResource,
  sniff,
  stripMetadata,
  updateMedia,
} from './index.js';

const SECRET = 's'.repeat(40);
const bytes = (...parts: Array<number[] | string>) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));
const u32 = (n: number) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const u32le = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const chunk = (type: string, data: number[] | string) => {
  const d = typeof data === 'string' ? [...data].map((c) => c.charCodeAt(0)) : data;
  return [...u32(d.length), ...[...type].map((c) => c.charCodeAt(0)), ...d, 0, 0, 0, 0];
};

const png = bytes('\x89PNG\r\n\x1a\n', chunk('IHDR', [...u32(640), ...u32(480), 8, 2, 0, 0, 0]), chunk('tEXt', 'Comment\0GPS 40.4N'), chunk('IDAT', [1, 2, 3]), chunk('IEND', []));
const jpeg = bytes(
  [0xff, 0xd8],
  [0xff, 0xe0, 0, 16], 'JFIF\0', [1, 1, 0, 0, 1, 0, 1, 0, 0],
  [0xff, 0xe1, 0, 16], 'Exif\0\0GPS40.4N',
  [0xff, 0xc0, 0, 11, 8, 0, 50, 0, 80, 1, 1, 0x11, 0],
  [0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0], [9, 9, 9], [0xff, 0xd9],
);
const webpBody = [
  ...bytes('VP8X', u32le(10), [0x08, 0, 0, 0], [99, 0, 0], [49, 0, 0]),
  ...bytes('EXIF', u32le(6), 'GPS404'),
  ...bytes('VP8L', u32le(2), [0, 0]),
];
const webp = bytes('RIFF', u32le(webpBody.length + 4), 'WEBP', webpBody);
const contains = (b: Uint8Array, s: string) => new TextDecoder('latin1').decode(b).includes(s);

let storage: StorageProvider;
beforeEach(async () => {
  await testDb(schema);
  storage = backendStorage('memory', memoryBackend(), { secret: SECRET, baseUrl: 'https://site.test' });
  setStorage(storage);
  delete process.env.MEDIA_TRANSFORM;
});

async function upload(file: Uint8Array, mime: string, name = 'photo') {
  const { media, upload } = await createUpload({ filename: name, mime, size: file.length });
  const res = await handleLocalUpload(new Request(upload.url, { method: 'PUT', headers: upload.headers, body: file as Uint8Array<ArrayBuffer> }), storage, SECRET);
  expect(res.status).toBe(200);
  return media;
}

describe('sniffing, sizes and metadata', () => {
  it('detects types by magic bytes and reads image sizes', () => {
    expect(sniff(png)).toBe('image/png');
    expect(sniff(jpeg)).toBe('image/jpeg');
    expect(sniff(webp)).toBe('image/webp');
    expect(sniff(bytes('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull();
    expect(sniff(bytes('%PDF-1.7'))).toBe('application/pdf');
    expect(imageSize(png, 'image/png')).toEqual({ width: 640, height: 480 });
    expect(imageSize(jpeg, 'image/jpeg')).toEqual({ width: 80, height: 50 });
    expect(imageSize(webp, 'image/webp')).toEqual({ width: 100, height: 50 });
  });

  it('strips EXIF/GPS and text chunks without touching image data', () => {
    for (const [file, type] of [[png, 'image/png'], [jpeg, 'image/jpeg'], [webp, 'image/webp']] as const) {
      expect(contains(file, 'GPS')).toBe(true);
      const out = stripMetadata(file, type);
      expect(contains(out, 'GPS'), type).toBe(false);
      expect(sniff(out)).toBe(type);
      expect(imageSize(out, type)).toEqual(imageSize(file, type));
    }
    const w = stripMetadata(webp, 'image/webp');
    expect(w[20]! & 0x08).toBe(0); // bandera EXIF de VP8X apagada
    const riffSize = w[4]! | (w[5]! << 8) | (w[6]! << 16) | (w[7]! << 24);
    expect(riffSize).toBe(w.length - 8);
  });
});

describe('upload flow', () => {
  it('uploads with a signed URL, confirms, strips metadata and stores dimensions', async () => {
    const m = await upload(png, 'image/png', '../../evil name.png');
    expect(m.key).toMatch(/^public\/media\/\d{4}\/\d{2}\/[0-9a-z]+\.png$/);
    expect(m.filename).toBe('....evil name.png');
    const ready = await confirmUpload(m.id);
    expect(ready).toMatchObject({ status: 'ready', width: 640, height: 480 });
    const stored = await storage.get(m.key);
    expect(contains(new Uint8Array(await new Response(stored!.body).arrayBuffer()), 'GPS')).toBe(false);
    expect(ready.size).toBeLessThan(png.length);
  });

  it('rejects unsupported types, oversize files and content that does not match the declared type', async () => {
    await expect(createUpload({ filename: 'x.svg', mime: 'image/svg+xml', size: 10 })).rejects.toThrow(MediaError);
    await expect(createUpload({ filename: 'x.png', mime: 'image/png', size: 16 * 1024 * 1024 })).rejects.toThrow(/max/);
    await expect(createUpload({ filename: 'x.png', mime: 'image/png', size: 10, folder: '../x' })).rejects.toThrow(/folder/);
    const fake = bytes('<html><script>alert(1)</script></html>');
    const m = await upload(fake, 'image/png');
    await expect(confirmUpload(m.id)).rejects.toMatchObject({ code: 'type_mismatch' });
    expect(await storage.get(m.key)).toBeNull();
    const notYet = await createUpload({ filename: 'a.png', mime: 'image/png', size: png.length });
    await expect(confirmUpload(notYet.media.id)).rejects.toMatchObject({ code: 'invalid_state' });
  });
});

describe('urls', () => {
  const m = { key: 'public/media/a.jpg', mime: 'image/jpeg', width: 1000, height: 500, alt: 'A mug', focalX: 0.25, focalY: 0.75 };
  it('returns originals without a transform service', () => {
    expect(imageUrl(m, { width: 300 })).toBe('https://site.test/api/storage/public/media/a.jpg');
    expect(imgAttrs(m)).toMatchObject({ alt: 'A mug', width: 1000, loading: 'lazy', style: { objectPosition: '25% 75%' } });
    expect(imgAttrs(m).srcSet).toBeUndefined();
  });
  it('builds Cloudflare and Vercel URLs and a srcset capped at the original width', () => {
    process.env.MEDIA_TRANSFORM = 'cloudflare';
    expect(imageUrl(m, { width: 320, fit: 'cover' })).toBe('/cdn-cgi/image/width=320,fit=cover,quality=75,format=auto/https://site.test/api/storage/public/media/a.jpg');
    const a = imgAttrs(m, { sizes: '50vw', priority: true });
    expect(a.srcSet?.split(', ').map((s) => s.split(' ')[1])).toEqual(['320w', '640w', '960w']);
    expect(a).toMatchObject({ sizes: '50vw', loading: 'eager' });
    process.env.MEDIA_TRANSFORM = 'vercel';
    expect(imageUrl(m, { width: 640 })).toBe(`/_next/image?url=${encodeURIComponent('https://site.test/api/storage/public/media/a.jpg')}&w=640&q=75`);
  });
});

describe('admin and routes', () => {
  const ctx = (perms: string[]): AdminContext => ({ user: { id: 'usr_1', email: null, name: null }, can: async (p) => perms.includes(p) });

  it('lists ready media, edits alt and focal point, deletes files', async () => {
    const m = await upload(jpeg, 'image/jpeg');
    await confirmUpload(m.id);
    const admin = ctx(['media:read', 'media:update', 'media:delete']);
    expect((await mediaAdminResource.list({ page: 1, pageSize: 10, filters: { missingAlt: 'true' } }, admin)).total).toBe(1);
    const updated = await mediaAdminResource.update!(m.id, { alt: 'Red mug', focalX: '2' }, admin).catch((e) => e);
    expect(updated).toBeInstanceOf(Error);
    expect((await mediaAdminResource.update!(m.id, { alt: 'Red mug', focalX: '0.3' }, admin)).alt).toBe('Red mug');
    expect((await updateMedia(m.id, { focalY: 5 })).focalY).toBe(1);
    await expect(mediaAdminResource.list({ page: 1, pageSize: 10 }, ctx([]))).rejects.toMatchObject({ code: 'forbidden' });
    await mediaAdminResource.delete!(m.id, admin);
    expect(await storage.get(m.key)).toBeNull();
    await deleteMedia('med_missing');
  });

  it('Hono and Next upload routes require authorization', async () => {
    const authorize = async (req: Request) => (req.headers.get('x-user') ? { userId: req.headers.get('x-user')! } : null);
    const app = new Hono().route('/api/media', mediaRoutes({ authorize }));
    const body = JSON.stringify({ filename: 'p.png', mime: 'image/png', size: png.length });
    expect((await app.request('/api/media/uploads', { method: 'POST', body })).status).toBe(403);
    const created = await app.request('/api/media/uploads', { method: 'POST', body, headers: { 'x-user': 'usr_1', 'content-type': 'application/json' } });
    expect(created.status).toBe(201);
    const { id, upload: up } = (await created.json()) as { id: string; upload: { url: string; headers: Record<string, string> } };
    await handleLocalUpload(new Request(up.url, { method: 'PUT', headers: up.headers, body: png as Uint8Array<ArrayBuffer> }), getStorage(), SECRET);
    const confirmed = await confirmUploadRoute(authorize)(new Request('http://x', { method: 'POST', headers: { 'x-user': 'usr_1' } }), { params: Promise.resolve({ id }) });
    expect(((await confirmed.json()) as { status: string }).status).toBe('ready');
    const bad = await createUploadRoute(authorize)(new Request('http://x', { method: 'POST', headers: { 'x-user': 'u' }, body: JSON.stringify({ filename: 'x', mime: 'text/html', size: 1 }) }));
    expect(bad.status).toBe(400);
  });
});
