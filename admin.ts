// Recurso de panel "Medios": lista con filtros, edición de alt/punto focal/carpeta y borrado (también del archivo).
// La creación va por `createUpload` + `confirmUpload` (rutas en adapters/), no por el formulario genérico.
import { and, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AdminContext, AdminResource } from '../contracts/index.ts';
import { getDb } from '../db/index.ts';
import { deleteMedia, getMedia, MediaError, updateMedia } from './library.ts';
import { type Media, media } from './schema.ts';
import { mediaUrl } from './urls.ts';

async function need(ctx: AdminContext, action: string) {
  if (!(await ctx.can(`media:${action}`))) throw new MediaError('forbidden', `forbidden: media:${action}`);
}

const Patch = z.object({
  alt: z.string().max(500).optional(),
  filename: z.string().min(1).max(200).optional(),
  folder: z.string().max(170).optional(),
  focalX: z.coerce.number().min(0).max(1).optional(),
  focalY: z.coerce.number().min(0).max(1).optional(),
});

export const mediaAdminResource: AdminResource<Media> = {
  name: 'media',
  label: { singular: 'Media', plural: 'Media' },
  group: 'Content',
  fields: [
    { name: 'filename', label: 'File name', type: 'text', list: true },
    { name: 'alt', label: 'Alt text', type: 'textarea', help: 'Describe the image for people who cannot see it. Leave empty only if decorative.' },
    { name: 'folder', label: 'Folder', type: 'text', list: true },
    { name: 'mime', label: 'Type', type: 'text', readOnly: true, list: true },
    { name: 'size', label: 'Size (bytes)', type: 'number', readOnly: true },
    { name: 'focalX', label: 'Focal point X (0–1)', type: 'number' },
    { name: 'focalY', label: 'Focal point Y (0–1)', type: 'number' },
  ],
  input: Patch,
  title: (m) => m.filename,
  links: (m) => [{ label: 'Open file', href: mediaUrl(m) }],
  async list(q, ctx) {
    await need(ctx, 'read');
    const conds: SQL[] = [eq(media.status, 'ready')];
    if (q.filters?.folder !== undefined) conds.push(eq(media.folder, q.filters.folder));
    if (q.filters?.type) conds.push(ilike(media.mime, `${q.filters.type.replace(/[%_\\]/g, '')}/%`));
    if (q.filters?.missingAlt === 'true') conds.push(eq(media.alt, ''));
    if (q.search) conds.push(or(ilike(media.filename, `%${q.search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`), ilike(media.alt, `%${q.search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`))!);
    const where = and(...conds);
    const [total] = await getDb().select({ n: count() }).from(media).where(where);
    const rows = await getDb().select().from(media).where(where).orderBy(desc(media.createdAt), desc(media.id)).limit(q.pageSize).offset((Math.max(q.page, 1) - 1) * q.pageSize);
    return { rows, total: total?.n ?? 0 };
  },
  async get(id, ctx) {
    await need(ctx, 'read');
    return getMedia(id);
  },
  async update(id, input, ctx) {
    await need(ctx, 'update');
    return updateMedia(id, Patch.parse(input));
  },
  async delete(id, ctx) {
    await need(ctx, 'delete');
    await deleteMedia(id);
  },
};
