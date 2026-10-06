// @core/media — API pública. Importa desde aquí; rutas de subida en adapters/hono.ts y adapters/next.ts.
export { mediaAdminResource } from './admin.js';
export {
  ALLOWED,
  type CreateUploadInput,
  confirmUpload,
  createUpload,
  deleteMedia,
  getMedia,
  MediaError,
  updateMedia,
} from './library.js';
export { type Media, media } from './schema.js';
export { importRemoteImage, type RemoteImageOptions } from './remote.js';
export { imageSize, type SniffedType, sniff } from './sniff.js';
export { stripMetadata } from './strip.js';
export { DEFAULT_WIDTHS, type ImageOptions, type ImgAttrs, imageUrl, imgAttrs, mediaUrl, type Transform } from './urls.js';
