# @core/media

[![genpm](https://api.genpm.net/v1/badge/@core/media.svg)](https://genpm.net/p/@core/media) ![license](https://img.shields.io/badge/license-MIT-blue)

> Media library: signed direct uploads, real file-type checks, EXIF/GPS removal, alt text, focal point, srcset

A [GenPM](https://genpm.net) module: **source code + AI rules + MCP config**, injected into your project instead of hidden in `node_modules`. The code lands in `src/lib/media`, pinned to a verified commit, and you own it.

## Install

```bash
genpm add @core/media
```

No genpm yet? `curl -fsSL https://genpm.net/install.sh | sh` (macOS/Linux), `irm https://genpm.net/install.ps1 | iex` (Windows), or one-off with `npx @genpm-net/cli add @core/media`.

Or let your AI agent do it: run `genpm mcp setup` once, then ask *"add @core/media with genpm"* in Claude Code, Cursor, VS Code, Windsurf, Codex or Gemini CLI. It shows you a dry-run plan before writing anything.

## What it does

Media library on top of @core/storage: the browser uploads directly with a signed URL to a private staging key
(`uploads/pending/<id>.<ext>`), then `confirmUpload` checks the real file type by its bytes (declared type must match),
removes EXIF/GPS/XMP from JPEG, PNG and WebP without re-encoding, writes the validated bytes to the final `public/`
key, deletes the staging copy and stores dimensions. Malformed images (chunk lengths past the end) are rejected. Alt text and focal point per file, responsive URLs (Cloudflare Images or Next.js
image optimizer) and ready `<img>` attributes. SVG and HTML are never accepted. Table: `media`.

## Setup

After `genpm add`, follow these steps (your AI agent finds the same steps in `src/lib/media/AGENTS.md` and can do them for you):

1. Configure @core/storage first (bucket CORS must allow `PUT` from the site). Recommended: a bucket lifecycle rule
   that deletes `uploads/pending/` objects after 1 day (abandoned or replayed uploads). Optional `MEDIA_TRANSFORM`:
   `cloudflare` (Images transformations enabled on the zone), `vercel` (Next.js image optimizer; add the storage host to `images.remotePatterns`) or `none`.
2. Migrations as in `src/lib/db/AGENTS.md`.
3. Mount the upload routes with an `authorize(req)` that returns `{ userId }` only for users with `media:create` (@core/rbac).
4. Upload from the browser: `POST /api/media/uploads` with `{ filename, mime, size }` → `PUT` the file to `upload.url`
   with `upload.headers` → `POST /api/media/uploads/<id>/confirm`. Store the media `id` in your content.
5. Render: `const m = await getMedia(id); <img {...imgAttrs(m, { sizes: '(min-width: 768px) 50vw, 100vw' })} />`.
6. Add `mediaAdminResource` to `src/genpm/admin.ts`.
7. Verify: upload a photo with GPS data; after confirm, the stored file has no EXIF and the row has width/height.

## What's inside

Paths are relative to `src/lib/media`.

- `index.ts` — public API: `createUpload`, `confirmUpload`, `getMedia`, `updateMedia`, `deleteMedia`, `imageUrl`, `imgAttrs`, `mediaAdminResource`.
- `remote.ts` — `importRemoteImage(url, { allowedHosts })` for server-side imports (https, host allowlist, size limit).
- `library.ts` — upload flow, allowed types and `stagingKey(media)`. `sniff.ts`, `strip.ts` — byte checks. `urls.ts` — URLs and `<img>` attributes.
- `adapters/hono.ts` — `mediaRoutes({ authorize })`. `adapters/next.ts` — `createUploadRoute`, `confirmUploadRoute`.

## At a glance

- **GenPM dependencies** (installed with it): [@core/db](https://genpm.net/p/@core/db), [@core/storage](https://genpm.net/p/@core/storage), [@core/contracts](https://genpm.net/p/@core/contracts)
- **npm dependencies** (proposed, never installed without asking): `zod`
- **Environment variables** (added to `.env.example`): `MEDIA_TRANSFORM`
- **AI rules**: [`AGENTS.md`](AGENTS.md), loaded by your agent only when it works in `src/lib/media`

## Security

GenPM installs a 40-character commit SHA (never a branch), verifies an Ed25519-signed manifest, never runs install scripts and scans AI rules for prompt injection. Details: [genpm.net/docs/security](https://genpm.net/docs/security).

## License

MIT — see [LICENSE](LICENSE). Browse the full catalog at [genpm.net](https://genpm.net).
