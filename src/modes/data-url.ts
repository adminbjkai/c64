/**
 * Data URL / File Base64 mode: decode a `data:` URL (any MIME, base64 or
 * percent-encoded) into text or a hex dump with magic-byte detection, or
 * wrap text / base64 into a data URL.
 */

import { type ToolMode, type ModeResult, type RunContext, formatBytes } from './types.js';
import { parseDataUrl, buildDataUrl, sniffBytes, isTextLike, isDataUrl, extensionFor, DataUrlError } from '../lib/data-url.js';
import { decodeBase64, looksLikeBase64 } from '../lib/base64.js';
import { xxdDump } from './hex.js';

export interface DataUrlData {
  direction: 'decode' | 'encode';
  dataUrl: string;
  mediaType: string;
  mime: string;
  charset: string | null;
  base64: boolean;
  size: number;
  /** Magic-byte detection, when recognised. */
  detected: { mime: string; label: string } | null;
  /** True when the sniffed type disagrees with the declared MIME. */
  mismatch: boolean;
  isImage: boolean;
  /** Decoded text for text-like payloads (capped for the view). */
  text: string | null;
  filename: string;
}

const PREVIEW_BYTES = 256;
const TEXT_CAP = 20_000;

function directionOption(v: unknown, input: string): 'decode' | 'encode' {
  if (v === 'decode' || v === 'encode') return v;
  return isDataUrl(input) ? 'decode' : 'encode';
}

function decode(input: string): ModeResult {
  let parsed;
  try {
    parsed = parseDataUrl(input);
  } catch (e) {
    const err = e as DataUrlError;
    return { output: '', error: { message: err.message, line: 1, col: err.col, hint: err.hint }, status: 'Invalid data URL' };
  }
  const { bytes, mime, mediaType, charset, base64 } = parsed;
  const detected = sniffBytes(bytes);
  const mismatch = detected !== null && detected.mime !== mime;
  const textLike = isTextLike(mime) && detected === null;
  const notes: string[] = [];
  if (mismatch) notes.push(`Declared ${mime} but the bytes look like ${detected!.label} (${detected!.mime}).`);
  let output: string;
  let text: string | null = null;
  if (textLike) {
    const dec = new TextDecoder(charset && /^(utf-?8|us-ascii|iso-8859-1|latin1|windows-1252)$/i.test(charset) ? charset : 'utf-8', { fatal: false });
    output = dec.decode(bytes);
    text = output.length > TEXT_CAP ? output.slice(0, TEXT_CAP) : output;
  } else {
    const head = bytes.subarray(0, PREVIEW_BYTES);
    output = `${mediaType} · ${bytes.length} bytes${detected ? ` · ${detected.label}` : ''}${bytes.length > PREVIEW_BYTES ? ` · first ${PREVIEW_BYTES} bytes` : ''}\n${xxdDump(head)}`;
  }
  const status = [mediaType, formatBytes(bytes.length), detected ? (mismatch ? `looks like ${detected.label}` : detected.label) : textLike ? 'text' : 'binary', base64 ? 'base64' : 'percent-encoded'].join(' · ');
  const data: DataUrlData = {
    direction: 'decode',
    dataUrl: input.trim(),
    mediaType,
    mime,
    charset,
    base64,
    size: bytes.length,
    detected: detected ? { mime: detected.mime, label: detected.label } : null,
    mismatch,
    isImage: mime.startsWith('image/') || (detected?.mime.startsWith('image/') ?? false),
    text,
    filename: `file.${detected ? detected.ext : extensionFor(mime)}`,
  };
  return { output, status, notes: notes.length ? notes : undefined, view: { kind: 'data-url', data } };
}

function encode(input: string, mediaType: string, base64: boolean): ModeResult {
  const mime = mediaType.split(';')[0]!.trim().toLowerCase();
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(mime)) {
    return { output: '', error: { message: `"${mediaType}" is not a media type`, hint: 'Use type/subtype, e.g. text/plain;charset=utf-8 or image/png.' }, status: 'Invalid MIME type' };
  }
  let bytes: Uint8Array;
  const notes: string[] = [];
  // Already-base64 payload for a binary type: wrap it as-is rather than re-encoding the text.
  if (base64 && !isTextLike(mime) && looksLikeBase64(input)) {
    try {
      bytes = decodeBase64(input).data;
      notes.push('Input looked like base64 for a binary type — wrapped as-is.');
    } catch {
      bytes = new TextEncoder().encode(input);
    }
  } else {
    bytes = new TextEncoder().encode(input);
  }
  const dataUrl = buildDataUrl(bytes, mediaType, base64);
  const detected = sniffBytes(bytes);
  const data: DataUrlData = {
    direction: 'encode',
    dataUrl,
    mediaType,
    mime,
    charset: /charset=([^;]+)/i.exec(mediaType)?.[1] ?? null,
    base64,
    size: bytes.length,
    detected: detected ? { mime: detected.mime, label: detected.label } : null,
    mismatch: detected !== null && detected.mime !== mime,
    isImage: mime.startsWith('image/'),
    text: isTextLike(mime) ? input.slice(0, TEXT_CAP) : null,
    filename: `file.${detected ? detected.ext : extensionFor(mime)}`,
  };
  if (data.mismatch) notes.push(`Declared ${mime} but the bytes look like ${detected!.label} (${detected!.mime}).`);
  return { output: dataUrl, status: `${mediaType} · ${formatBytes(bytes.length)} · ${base64 ? 'base64' : 'percent-encoded'} · ${formatBytes(dataUrl.length)} URL`, notes: notes.length ? notes : undefined, view: { kind: 'data-url', data } };
}

export function runDataUrl(input: string, ctx: RunContext): ModeResult {
  if (input.trim() === '') return { output: '', status: '' };
  const direction = directionOption(ctx.options['direction'], input);
  if (direction === 'decode') return decode(input);
  const mime = typeof ctx.options['mime'] === 'string' && ctx.options['mime'].trim() !== '' ? ctx.options['mime'].trim() : 'text/plain;charset=utf-8';
  return encode(input, mime, ctx.options['base64'] !== false);
}

export const dataUrlMode: ToolMode = {
  id: 'data-url',
  label: 'Data URL / File Base64',
  description: 'Decode data: URLs to text or a hex dump with image preview and type detection, or wrap text and base64 into a data URL.',
  category: 'Encoding',
  icon: 'image',
  keywords: ['data url', 'data uri', 'base64', 'image', 'png', 'mime', 'inline', 'download', 'file'],
  emptyHint: 'Paste a data: URL to inspect it (or drop an image), or paste text to wrap into one.',
  sample: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAbElEQVR42hXNQRUAUQhCUaMYhShGeVGIQhSizB+XXA7ODDtouIHBQ4YOM8suWm5h8ZKl+0CskDiBsIioHhx76LiDw0eO3oN/4FVf+J8h0PduzBqZ8x/bxNQPwgaFy192SGgelC0q13/CJaXlA8Z7WAFXOTbyAAAAAElFTkSuQmCC',
  supportsPretty: false,
  controls: [
    {
      kind: 'select',
      key: 'direction',
      label: 'Direction',
      default: 'auto',
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'decode', label: 'Decode' },
        { value: 'encode', label: 'Encode' },
      ],
    },
    { kind: 'text', key: 'mime', label: 'MIME', placeholder: 'text/plain;charset=utf-8', default: 'text/plain;charset=utf-8' },
    { kind: 'toggle', key: 'base64', label: 'Base64', default: true },
  ],
  run: runDataUrl,
};
