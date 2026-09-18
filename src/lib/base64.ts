/**
 * Base64 encode/decode over UTF-8 bytes, standard and URL-safe alphabets.
 * Hand-rolled (rather than atob/btoa) so it handles Unicode correctly, works
 * identically in the page, the worker and Node tests, and can report exact
 * error positions.
 */

const STD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const LOOKUP = new Int16Array(256).fill(-1);
for (let i = 0; i < 64; i++) {
  LOOKUP[STD.charCodeAt(i)] = i;
  LOOKUP[URL.charCodeAt(i)] = i; // both alphabets decode; ambiguity is harmless
}

export class Base64Error extends Error {
  constructor(
    message: string,
    public readonly offset: number,
    public readonly hint?: string,
  ) {
    super(message);
  }
}

export interface EncodeOptions {
  urlSafe?: boolean;
  /** Omit `=` padding (common with URL-safe). Default: pad unless urlSafe. */
  pad?: boolean;
}

export function encodeBytes(bytes: Uint8Array, opts: EncodeOptions = {}): string {
  const alphabet = opts.urlSafe ? URL : STD;
  const pad = opts.pad ?? !opts.urlSafe;
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += alphabet[n >> 18]! + alphabet[(n >> 12) & 63]! + alphabet[(n >> 6) & 63]! + alphabet[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += alphabet[n >> 18]! + alphabet[(n >> 12) & 63]! + (pad ? '==' : '');
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += alphabet[n >> 18]! + alphabet[(n >> 12) & 63]! + alphabet[(n >> 6) & 63]! + (pad ? '=' : '');
  }
  return out;
}

export function encodeBase64(text: string, opts: EncodeOptions = {}): string {
  return encodeBytes(new TextEncoder().encode(text), opts);
}

export interface DecodeResult {
  bytes: number;
  data: Uint8Array;
  /** UTF-8 decoding of the bytes (replacement chars for invalid sequences). */
  text: string;
  /** True when the bytes look like readable text (no control chars, valid UTF-8). */
  printable: boolean;
}

/** Decode; whitespace is ignored, padding is optional, both alphabets accepted. */
export function decodeBase64(input: string, _opts: { urlSafe?: boolean } = {}): DecodeResult {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  let seenPad = false;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c === 32 || c === 10 || c === 13 || c === 9) continue;
    if (c === 61 /* = */) {
      seenPad = true;
      continue;
    }
    if (seenPad) throw new Base64Error(`Data after \`=\` padding at position ${i + 1}`, i, 'Padding must only appear at the very end.');
    const v = c < 256 ? LOOKUP[c]! : -1;
    if (v < 0) throw new Base64Error(`Invalid Base64 character \`${input[i]}\` at position ${i + 1}`, i, 'Only A–Z, a–z, 0–9, + / (or - _ for URL-safe) and = padding are allowed.');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  if (bits >= 6) throw new Base64Error('Truncated Base64 — a dangling character at the end', input.length, 'The input is missing one or more characters; the length (ignoring `=`) should never be 1 mod 4.');
  const data = Uint8Array.from(out);
  let printable = true;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    for (let i = 0; i < text.length && printable; i++) {
      const ch = text.charCodeAt(i);
      if (ch < 32 && ch !== 9 && ch !== 10 && ch !== 13) printable = false;
    }
  } catch {
    text = new TextDecoder().decode(data);
    printable = false;
  }
  return { bytes: data.length, data, text, printable };
}

/** Cheap shape test used by auto-detect and the Explain helper. */
export function looksLikeBase64(text: string): boolean {
  const s = text.replace(/\s/g, '');
  if (s.length < 4) return false;
  if (!/^[A-Za-z0-9+/\-_]+={0,2}$/.test(s)) return false;
  // Plain words like "hello" also match the alphabet; require some mix of
  // cases/digits or a length that only Base64 would have.
  const mixed = /[A-Z]/.test(s) && /[a-z]/.test(s) && (/[0-9+/\-_=]/.test(s) || s.length >= 16);
  return mixed && s.replace(/=+$/, '').length % 4 !== 1;
}
