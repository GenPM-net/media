// Detección del tipo real por la firma de bytes y dimensiones de imagen, sin dependencias.

export type SniffedType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/gif'
  | 'image/webp'
  | 'image/avif'
  | 'application/pdf'
  | 'video/mp4'
  | 'video/webm';

const ascii = (b: Uint8Array, from: number, len: number) => String.fromCharCode(...b.subarray(from, from + len));

export function sniff(b: Uint8Array): SniffedType | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (ascii(b, 0, 8) === '\x89PNG\r\n\x1a\n') return 'image/png';
  if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') return 'image/gif';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'image/webp';
  if (ascii(b, 0, 5) === '%PDF-') return 'application/pdf';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
  if (ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V '].includes(brand)) return 'video/mp4';
  }
  return null;
}

const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u32be = (b: Uint8Array, i: number) => ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
const u16le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);

/** Ancho y alto de JPEG, PNG, GIF y WebP leyendo solo las cabeceras. */
export function imageSize(b: Uint8Array, type: SniffedType): { width: number; height: number } | null {
  try {
    if (type === 'image/png') return { width: u32be(b, 16), height: u32be(b, 20) };
    if (type === 'image/gif') return { width: u16le(b, 6), height: u16le(b, 8) };
    if (type === 'image/webp') {
      const kind = ascii(b, 12, 4);
      if (kind === 'VP8X') return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
      if (kind === 'VP8 ') return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
      if (kind === 'VP8L') {
        const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      return null;
    }
    if (type === 'image/jpeg') {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) return null;
        const marker = b[i + 1]!;
        const len = u16be(b, i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
          return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
        i += 2 + len;
      }
    }
  } catch {
    return null;
  }
  return null;
}
