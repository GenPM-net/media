// Elimina metadatos (EXIF con GPS, XMP, IPTC, comentarios) de JPEG, PNG y WebP sin recodificar la imagen.
import type { SniffedType } from './sniff.ts';

/** Archivo mal formado (un segmento declara más bytes de los que hay, o una longitud imposible). */
export class MalformedImageError extends Error {
  constructor(message = 'malformed image') {
    super(message);
    this.name = 'MalformedImageError';
  }
}

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

/** JPEG: quita APP1 (EXIF/XMP), APP13 (IPTC) y COM; conserva APP0, APP2 (perfil ICC) y lo demás. */
function stripJpeg(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const marker = b[i + 1]!;
    if (marker === 0xda) break; // inicio de datos de imagen: el resto se copia tal cual
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    // La longitud incluye sus 2 bytes: < 2 es imposible; más allá del final, archivo truncado o manipulado.
    if (len < 2 || i + 2 + len > b.length) throw new MalformedImageError('malformed JPEG segment');
    if (marker !== 0xe1 && marker !== 0xed && marker !== 0xfe) parts.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  parts.push(b.subarray(i));
  return concat(parts);
}

/** PNG: quita eXIf, tEXt, zTXt, iTXt y tIME. */
function stripPng(b: Uint8Array): Uint8Array {
  const drop = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
    const type = String.fromCharCode(...b.subarray(i + 4, i + 8));
    const end = i + 12 + len;
    if (end > b.length) throw new MalformedImageError('malformed PNG chunk');
    if (!drop.has(type)) parts.push(b.subarray(i, end));
    i = end;
  }
  return concat(parts);
}

/** WebP: quita los chunks EXIF y XMP, ajusta el tamaño RIFF y las banderas de VP8X. */
function stripWebp(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let i = 12;
  while (i + 8 <= b.length) {
    const type = String.fromCharCode(...b.subarray(i, i + 4));
    // Sin signo (`>>> 0`): con `| (x << 24)` una longitud como 0xFFFFFFF8 sería negativa y el bucle no avanzaría.
    const len = (b[i + 4]! | (b[i + 5]! << 8) | (b[i + 6]! << 16) | (b[i + 7]! << 24)) >>> 0;
    const dataEnd = i + 8 + len;
    if (dataEnd > b.length) throw new MalformedImageError('malformed WebP chunk');
    // Byte de relleno de los chunks impares; se tolera que falte en el último.
    const end = Math.min(dataEnd + (len % 2), b.length);
    if (type !== 'EXIF' && type !== 'XMP ') {
      const chunk = b.slice(i, end);
      if (type === 'VP8X') chunk[8] = chunk[8]! & ~0x0c; // banderas EXIF (0x08) y XMP (0x04)
      parts.push(chunk);
    }
    i = end;
  }
  const body = concat(parts);
  const header = b.slice(0, 12);
  const size = body.length + 4;
  header.set([size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >>> 24) & 0xff], 4);
  return concat([header, body]);
}

/** Lanza `MalformedImageError` si la estructura del archivo no es coherente (nunca entra en bucle). */
export function stripMetadata(b: Uint8Array, type: SniffedType): Uint8Array {
  if (type === 'image/jpeg') return stripJpeg(b);
  if (type === 'image/png') return stripPng(b);
  if (type === 'image/webp') return stripWebp(b);
  return b;
}
