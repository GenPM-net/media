# @core/media — rules for AI agents

## Purpose
Media library on top of @core/storage: the browser uploads directly with a signed URL, then `confirmUpload` checks
the real file type by its bytes (declared type must match), removes EXIF/GPS/XMP from JPEG, PNG and WebP without
re-encoding, and stores dimensions. Alt text and focal point per file, responsive URLs (Cloudflare Images or Next.js
image optimizer) and ready `<img>` attributes. SVG and HTML are never accepted. Table: `media`.

## Map
- `index.ts` — public API: `createUpload`, `confirmUpload`, `getMedia`, `updateMedia`, `deleteMedia`, `imageUrl`, `imgAttrs`, `mediaAdminResource`.
- `library.ts` — upload flow and allowed types. `sniff.ts`, `strip.ts` — byte checks. `urls.ts` — URLs and `<img>` attributes.
- `adapters/hono.ts` — `mediaRoutes({ authorize })`. `adapters/next.ts` — `createUploadRoute`, `confirmUploadRoute`.

## Integration
1. Configure @core/storage first (bucket CORS must allow `PUT` from the site). Optional `MEDIA_TRANSFORM`:
   `cloudflare` (Images transformations enabled on the zone), `vercel` (Next.js image optimizer; add the storage host to `images.remotePatterns`) or `none`.
2. Migrations as in `src/lib/db/AGENTS.md`.
3. Mount the upload routes with an `authorize(req)` that returns `{ userId }` only for users with `media:create` (@core/rbac).
4. Upload from the browser: `POST /api/media/uploads` with `{ filename, mime, size }` → `PUT` the file to `upload.url`
   with `upload.headers` → `POST /api/media/uploads/<id>/confirm`. Store the media `id` in your content.
5. Render: `const m = await getMedia(id); <img {...imgAttrs(m, { sizes: '(min-width: 768px) 50vw, 100vw' })} />`.
6. Add `mediaAdminResource` to `src/genpm/admin.ts`.
7. Verify: upload a photo with GPS data; after confirm, the stored file has no EXIF and the row has width/height.

## Conventions
- Reference media by `id` in content; resolve URLs at render time (driver or CDN can change).
- Every non-decorative image needs `alt`; the admin can filter `missingAlt=true`.
- Hero/LCP images: `imgAttrs(m, { priority: true })`; everything else stays lazy.

## Don't
- Don't accept files without `confirmUpload`; pending or rejected media must never be shown.
- Don't allow SVG uploads or serve user files from the site's own origin without the storage route's sandbox headers.
- Don't hotlink third-party images; copy them into storage first.
