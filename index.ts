// @core/media — API pública. Importa desde aquí; rutas de subida en adapters/hono.ts y adapters/next.ts.
export { mediaAdminResource } from './admin.ts';
export {
  ALLOWED,
  type CreateUploadInput,
  confirmUpload,
  createUpload,
  deleteMedia,
  getMedia,
  imageFor,
  MediaError,
  stagingKey,
  updateMedia,
} from './library.ts';
export { type Media, media } from './schema.ts';
export { importRemoteImage, type RemoteImageOptions } from './remote.ts';
export { imageSize, type SniffedType, sniff } from './sniff.ts';
export { MalformedImageError, stripMetadata } from './strip.ts';
export { DEFAULT_WIDTHS, type ImageOptions, type ImgAttrs, imageUrl, imgAttrs, mediaUrl, type Transform } from './urls.ts';
