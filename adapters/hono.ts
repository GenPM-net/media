// Adaptador Hono: `app.route('/api/media', mediaRoutes({ authorize }))`. `authorize` suele comprobar `media:create`
// con @core/rbac: `async (req) => { const u = await getUserFromCookieHeader(req.headers.get('cookie')); return u && (await can(u.id, 'media:create')) ? { userId: u.id } : null; }`.
import { Hono } from 'hono';
import { type Authorize, handleConfirmUpload, handleCreateUpload } from './http.js';

export function mediaRoutes(opts: { authorize: Authorize }) {
  return new Hono()
    .post('/uploads', (c) => handleCreateUpload(c.req.raw, opts.authorize))
    .post('/uploads/:id/confirm', (c) => handleConfirmUpload(c.req.raw, c.req.param('id'), opts.authorize));
}
