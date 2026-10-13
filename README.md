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

## At a glance

- **GenPM dependencies** (installed with it): [@core/db](https://genpm.net/p/@core/db), [@core/storage](https://genpm.net/p/@core/storage), [@core/contracts](https://genpm.net/p/@core/contracts)
- **npm dependencies** (proposed, never installed without asking): `zod`
- **Environment variables** (added to `.env.example`): `MEDIA_TRANSFORM`
- **AI rules**: [`AGENTS.md`](AGENTS.md), loaded by your agent only when it works in `src/lib/media`

## Security

GenPM installs a 40-character commit SHA (never a branch), verifies an Ed25519-signed manifest, never runs install scripts and scans AI rules for prompt injection. Details: [genpm.net/docs/security](https://genpm.net/docs/security).

## License

MIT — see [LICENSE](LICENSE). Browse the full catalog at [genpm.net](https://genpm.net).
