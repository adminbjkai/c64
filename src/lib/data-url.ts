/**
 * data-url.ts — `data:` URL parsing / building and magic-byte sniffing.
 *
 * What it implements
 * ------------------
 * - RFC 2397 parsing: `data:[<mediatype>][;base64],<data>`. The media type
 *   defaults to `text/plain;charset=US-ASCII`. Base64 payloads are decoded
 *   with the lenient decoder from base64.ts (whitespace ignored, padding
 *   optional); otherwise the payload is percent-decoded byte-wise.
 * - Building: bytes → base64 or percent-encoded data URL.
 * - Sniffing: PNG, JPEG, GIF, WebP, PDF, ZIP, gzip from the leading bytes.
 * - "Text-like" MIME detection (text/*, JSON, XML, JavaScript, SVG, …).
 */

import { decodeBase64, encodeBytes, Base64Error } from './base64.js';

export class DataUrlError extends Error {
  constructor(message: string, public hint: string, public col?: number) {
    super(message);
  }
}

export interface ParsedDataUrl {
  /** Full media type including parameters, e.g. `text/plain;charset=utf-8`. */
  mediaType: string;
  /** Just the type/subtype, lowercase. */
  mime: string;
  charset: string | null;
  base64: boolean;
  bytes: Uint8Array;
}

export function isDataUrl(s: string): boolean {
  return /^\s*data:/i.test(s);
}

function percentDecodeBytes(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 37 /* % */) {
      const hex = s.slice(i + 1, i + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) throw new DataUrlError(`Bad percent-escape "%${hex}" at offset ${i}`, 'Each % must be followed by two hex digits, e.g. %20 for a space.', i + 1);
      out.push(parseInt(hex, 16));
      i += 2;
    } else if (c === 10 || c === 13) {
      continue; // tolerate wrapped lines
    } else if (c < 128) {
      out.push(c);
    } else {
      // Non-ASCII characters in a non-base64 data URL: take their UTF-8 bytes.
      for (const b of new TextEncoder().encode(s[i]!)) out.push(b);
    }
  }
  return Uint8Array.from(out);
}

export function parseDataUrl(input: string): ParsedDataUrl {
  const s = input.trim();
  if (!/^data:/i.test(s)) throw new DataUrlError('Not a data URL', 'A data URL starts with `data:`, e.g. data:text/plain;base64,SGVsbG8=', 1);
  const comma = s.indexOf(',');
  if (comma < 0) throw new DataUrlError('Data URL has no comma separating the header from the data', 'Write it as data:<mime>[;base64],<data>.', s.length);
  const header = s.slice(5, comma);
  const payload = s.slice(comma + 1);
  const parts = header.split(';').map((p) => p.trim()).filter((p) => p !== '');
  let base64 = false;
  if (parts.length && parts[parts.length - 1]!.toLowerCase() === 'base64') {
    base64 = true;
    parts.pop();
  }
  let mime = parts[0] && parts[0].includes('/') ? parts[0].toLowerCase() : '';
  const params = mime ? parts.slice(1) : parts;
  if (parts[0] && !parts[0].includes('/') && !parts[0].includes('=')) {
    throw new DataUrlError(`"${parts[0]}" is not a media type`, 'Media types look like type/subtype, e.g. image/png or text/plain.', 6);
  }
  if (mime === '') mime = 'text/plain';
  let charset: string | null = null;
  for (const p of params) {
    const m = /^charset=(.+)$/i.exec(p);
    if (m) charset = m[1]!.replace(/^"|"$/g, '');
  }
  if (mime === 'text/plain' && !charset && !parts[0]?.includes('/')) charset = 'US-ASCII';
  const mediaType = [mime, ...params].join(';');
  let bytes: Uint8Array;
  if (base64) {
    try {
      bytes = decodeBase64(payload).data;
    } catch (e) {
      const err = e as Base64Error;
      throw new DataUrlError(`Invalid base64 payload: ${err.message}`, err.hint ?? 'Check the payload for characters outside the base64 alphabet.', comma + 2 + (typeof err.offset === 'number' ? err.offset : 0));
    }
  } else {
    try {
      bytes = percentDecodeBytes(payload);
    } catch (e) {
      const err = e as DataUrlError;
      throw new DataUrlError(err.message, err.hint, comma + 1 + (err.col ?? 0));
    }
  }
  return { mediaType, mime, charset, base64, bytes };
}

export function buildDataUrl(bytes: Uint8Array, mediaType: string, base64: boolean): string {
  if (base64) return `data:${mediaType};base64,${encodeBytes(bytes)}`;
  let s = '';
  for (const b of bytes) {
    // Unreserved characters stay literal; everything else is %XX.
    if ((b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122) || b === 45 || b === 46 || b === 95 || b === 126) s += String.fromCharCode(b);
    else s += '%' + b.toString(16).toUpperCase().padStart(2, '0');
  }
  return `data:${mediaType},${s}`;
}

/* -------------------------------------------------------------- sniffing */

export interface SniffResult {
  mime: string;
  label: string;
  ext: string;
}

const starts = (b: Uint8Array, sig: number[], at = 0): boolean => sig.every((x, i) => b[at + i] === x);

export function sniffBytes(b: Uint8Array): SniffResult | null {
  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', label: 'PNG', ext: 'png' };
  if (starts(b, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', label: 'JPEG', ext: 'jpg' };
  if (starts(b, [0x47, 0x49, 0x46, 0x38]) && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return { mime: 'image/gif', label: 'GIF', ext: 'gif' };
  if (starts(b, [0x52, 0x49, 0x46, 0x46]) && starts(b, [0x57, 0x45, 0x42, 0x50], 8)) return { mime: 'image/webp', label: 'WebP', ext: 'webp' };
  if (starts(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { mime: 'application/pdf', label: 'PDF', ext: 'pdf' };
  if (starts(b, [0x50, 0x4b, 0x03, 0x04]) || starts(b, [0x50, 0x4b, 0x05, 0x06])) return { mime: 'application/zip', label: 'ZIP', ext: 'zip' };
  if (starts(b, [0x1f, 0x8b])) return { mime: 'application/gzip', label: 'gzip', ext: 'gz' };
  return null;
}

export function isTextLike(mime: string): boolean {
  const m = mime.toLowerCase();
  return m.startsWith('text/') || /^application\/(json|xml|javascript|ecmascript|x-javascript|x-www-form-urlencoded|yaml|x-yaml|toml|sql)$/.test(m) || /\+(json|xml)$/.test(m) || m === 'image/svg+xml';
}

const EXT: Record<string, string> = {
  'text/plain': 'txt', 'text/html': 'html', 'text/css': 'css', 'text/csv': 'csv', 'text/markdown': 'md', 'text/javascript': 'js',
  'application/json': 'json', 'application/xml': 'xml', 'application/javascript': 'js', 'application/pdf': 'pdf', 'application/zip': 'zip', 'application/gzip': 'gz',
  'application/octet-stream': 'bin', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/x-icon': 'ico',
  'image/bmp': 'bmp', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'video/mp4': 'mp4', 'font/woff2': 'woff2', 'font/woff': 'woff', 'font/ttf': 'ttf',
};

export function extensionFor(mime: string): string {
  const m = mime.toLowerCase();
  if (EXT[m]) return EXT[m]!;
  const sub = m.split('/')[1] ?? 'bin';
  return sub.replace(/^x-/, '').replace(/\+.*$/, '').replace(/[^a-z0-9]/g, '') || 'bin';
}
