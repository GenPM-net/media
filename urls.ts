// URLs de imagen responsivas según el servicio de transformación (MEDIA_TRANSFORM) y atributos <img> listos.
import { getStorage } from '../storage/index.ts';
import type { Media } from './schema.ts';

export type Transform = 'none' | 'cloudflare' | 'vercel';
export type ImageOptions = { width?: number; height?: number; fit?: 'cover' | 'contain' | 'scale-down'; quality?: number };

const transform = (): Transform => {
  const t = process.env.MEDIA_TRANSFORM ?? 'none';
  if (t !== 'none' && t !== 'cloudflare' && t !== 'vercel') throw new Error(`unknown MEDIA_TRANSFORM: ${t}`);
  return t;
};

export const mediaUrl = (m: Pick<Media, 'key'>) => getStorage().publicUrl(m.key);

/** URL de la imagen redimensionada. Sin servicio de transformación (`none`) devuelve la original. */
export function imageUrl(m: Pick<Media, 'key' | 'mime'>, opts: ImageOptions = {}): string {
  const src = mediaUrl(m);
  const t = transform();
  if (t === 'none' || !m.mime.startsWith('image/') || m.mime === 'image/gif') return src;
  const q = Math.min(Math.max(Math.round(opts.quality ?? 75), 1), 100);
  if (t === 'vercel') return `/_next/image?url=${encodeURIComponent(src)}&w=${opts.width ?? 1200}&q=${q}`;
  const params = [
    opts.width && `width=${Math.round(opts.width)}`,
    opts.height && `height=${Math.round(opts.height)}`,
    opts.fit && `fit=${opts.fit}`,
    `quality=${q}`,
    'format=auto',
  ].filter(Boolean);
  return `/cdn-cgi/image/${params.join(',')}/${src}`;
}

export const DEFAULT_WIDTHS = [320, 640, 960, 1280, 1920];

export type ImgAttrs = {
  src: string;
  srcSet?: string;
  sizes?: string;
  width?: number;
  height?: number;
  alt: string;
  loading: 'lazy' | 'eager';
  decoding: 'async';
  style: { objectPosition: string };
};

/** Atributos para `<img>` (o `<Image unoptimized>`) con srcset, dimensiones, alt y punto focal. */
export function imgAttrs(
  m: Pick<Media, 'key' | 'mime' | 'width' | 'height' | 'alt' | 'focalX' | 'focalY'>,
  opts: { sizes?: string; widths?: number[]; priority?: boolean; alt?: string } = {},
): ImgAttrs {
  const t = transform();
  const widths = (opts.widths ?? DEFAULT_WIDTHS).filter((w) => !m.width || w <= m.width);
  const responsive = t !== 'none' && m.mime.startsWith('image/') && m.mime !== 'image/gif' && widths.length > 0;
  return {
    src: imageUrl(m, { width: widths.at(-1) ?? m.width ?? undefined }),
    ...(responsive && { srcSet: widths.map((w) => `${imageUrl(m, { width: w })} ${w}w`).join(', '), sizes: opts.sizes ?? '100vw' }),
    ...(m.width && { width: m.width }),
    ...(m.height && { height: m.height }),
    alt: opts.alt ?? m.alt,
    loading: opts.priority ? 'eager' : 'lazy',
    decoding: 'async',
    style: { objectPosition: `${Math.round(m.focalX * 100)}% ${Math.round(m.focalY * 100)}%` },
  };
}
