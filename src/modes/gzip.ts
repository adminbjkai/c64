/**
 * Gzip / Deflate mode: compress text to Base64 / hex, or decompress
 * Base64 / hex back to UTF-8 text. Uses the platform CompressionStream /
 * DecompressionStream (available in browsers, workers and Node ≥ 18).
 *
 * Auto direction: if the input decodes (as Base64 or hex) to bytes that
 * start with the gzip (1f 8b) or zlib (78 xx) magic, it is decompressed
 * with that algorithm; otherwise the text is compressed.
 */

import { type ToolMode, type ModeResult, type RunContext, formatBytes } from './types.js';
import { decodeBase64, looksLikeBase64 } from '../lib/base64.js';
import { toHex, bytesToBase64, utf8Encode, utf8Decode } from '../lib/bytes.js';

export type GzipAlgorithm = 'gzip' | 'deflate' | 'deflate-raw';
export type GzipEncoding = 'base64' | 'hex';

const HEX_RE = /^[0-9a-fA-F]+$/;

function algorithmOption(v: unknown): GzipAlgorithm {
  return v === 'deflate' || v === 'deflate-raw' ? v : 'gzip';
}

/** Decode compressed input; hex is detected first, then Base64. */
export function decodeInput(text: string): { bytes: Uint8Array; encoding: GzipEncoding } | null {
  const s = text.replace(/\s+/g, '');
  if (s.length >= 2 && s.length % 2 === 0 && HEX_RE.test(s)) {
    const bytes = new Uint8Array(s.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
    return { bytes, encoding: 'hex' };
  }
  if (!/^[A-Za-z0-9+/\-_]+={0,2}$/.test(s)) return null;
  try {
    return { bytes: decodeBase64(s).data, encoding: 'base64' };
  } catch {
    return null;
  }
}

/** gzip / zlib magic sniffing; deflate-raw has no header. */
export function sniffCompressed(bytes: Uint8Array): GzipAlgorithm | null {
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return 'gzip';
  if (bytes.length >= 2 && bytes[0] === 0x78 && ((bytes[0]! << 8) | bytes[1]!) % 31 === 0) return 'deflate';
  return null;
}

async function pump(bytes: Uint8Array, stream: { readable: ReadableStream<Uint8Array>; writable: WritableStream<BufferSource> }): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  // The reader surfaces any decompression error; the writer side rejects too
  // and would otherwise be an unhandled rejection.
  const done = writer.write(new Uint8Array(bytes)).then(() => writer.close());
  done.catch(() => undefined);
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    chunks.push(value);
  }
  await done;
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export function compressBytes(bytes: Uint8Array, algorithm: GzipAlgorithm): Promise<Uint8Array> {
  return pump(bytes, new CompressionStream(algorithm));
}

export function decompressBytes(bytes: Uint8Array, algorithm: GzipAlgorithm): Promise<Uint8Array> {
  return pump(bytes, new DecompressionStream(algorithm));
}

export async function runGzip(input: string, ctx: RunContext): Promise<ModeResult> {
  if (input.trim() === '') return { output: '', status: '' };
  const dirOpt = ctx.options['direction'];
  const encoding: GzipEncoding = ctx.options['encoding'] === 'hex' ? 'hex' : 'base64';
  let algorithm = algorithmOption(ctx.options['algorithm']);
  const notes: string[] = [];

  let direction: 'compress' | 'decompress';
  let decoded: { bytes: Uint8Array; encoding: GzipEncoding } | null = null;
  if (dirOpt === 'compress' || dirOpt === 'decompress') {
    direction = dirOpt;
  } else {
    decoded = decodeInput(input);
    const sniffed = decoded ? sniffCompressed(decoded.bytes) : null;
    if (decoded && sniffed) {
      direction = 'decompress';
      if (sniffed !== algorithm) {
        notes.push(`Input starts with the ${sniffed === 'gzip' ? 'gzip' : 'zlib'} header — decompressing as ${sniffed}.`);
        algorithm = sniffed;
      }
    } else {
      direction = 'compress';
      if (decoded && looksLikeBase64(input)) notes.push('Input looks like Base64 but has no gzip/zlib header — compressing it as text. Set Direction to "decompress" for raw deflate.');
    }
  }

  if (direction === 'compress') {
    const raw = utf8Encode(input);
    const packed = await compressBytes(raw, algorithm);
    const output = encoding === 'hex' ? toHex(packed) : bytesToBase64(packed);
    const pct = raw.length ? Math.round((1 - packed.length / raw.length) * 100) : 0;
    const change = pct >= 0 ? `${pct}% smaller` : `${-pct}% larger`;
    return { output, notes: notes.length ? notes : undefined, status: `${formatBytes(raw.length)} → ${formatBytes(packed.length)} (${change}) · ${algorithm} · ${encoding}` };
  }

  decoded ??= decodeInput(input);
  if (!decoded) {
    return {
      output: '',
      error: { message: 'Input is not valid Base64 or hex', hint: 'Compressed data must be pasted as Base64 (A–Z a–z 0–9 + / =) or hex (0–9 a–f).' },
      status: 'Invalid compressed input',
    };
  }
  if (decoded.encoding !== encoding) notes.push(`Input detected as ${decoded.encoding}.`);
  try {
    const plain = await decompressBytes(decoded.bytes, algorithm);
    const { text, invalid } = utf8Decode(plain);
    if (invalid) notes.push('Decompressed bytes are not valid UTF-8 — invalid sequences are shown as \uFFFD.');
    return { output: text, notes: notes.length ? notes : undefined, status: `${formatBytes(decoded.bytes.length)} → ${formatBytes(plain.length)} · ${algorithm}` };
  } catch {
    const sniffed = sniffCompressed(decoded.bytes);
    const hint = sniffed && sniffed !== algorithm ? `The bytes start with the ${sniffed} header — pick "${sniffed}" as the algorithm.` : sniffed ? 'The header looks right but the body is corrupt or truncated.' : 'No gzip (1f 8b) or zlib (78 xx) header found — try "deflate-raw", or check the data was copied completely.';
    return { output: '', error: { message: `Not valid ${algorithm} data — check the algorithm`, hint }, status: `Cannot decompress as ${algorithm}` };
  }
}

export const gzipMode: ToolMode = {
  id: 'gzip',
  label: 'Gzip / Deflate',
  description: 'Compress text to gzip, zlib or raw deflate (as Base64 or hex) and decompress it back, detecting the header automatically.',
  category: 'Encoding',
  icon: 'compress',
  keywords: ['gzip', 'deflate', 'zlib', 'compress', 'decompress', 'inflate', 'zip', 'base64'],
  emptyHint: 'Paste text to compress it, or Base64 / hex gzip data to decompress it — the header is detected.',
  sample: 'H4sIAAAAAAAAA6tWykjNyclXslIqzy/KSVHSUcpTsjKsBQAAtkvRFwAAAA==',
  supportsPretty: false,
  controls: [
    {
      kind: 'select',
      key: 'direction',
      label: 'Direction',
      default: 'auto',
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'compress', label: 'Compress' },
        { value: 'decompress', label: 'Decompress' },
      ],
    },
    {
      kind: 'select',
      key: 'algorithm',
      label: 'Algorithm',
      default: 'gzip',
      options: [
        { value: 'gzip', label: 'gzip' },
        { value: 'deflate', label: 'deflate (zlib)' },
        { value: 'deflate-raw', label: 'deflate-raw' },
      ],
    },
    {
      kind: 'select',
      key: 'encoding',
      label: 'Encoding',
      default: 'base64',
      options: [
        { value: 'base64', label: 'Base64' },
        { value: 'hex', label: 'Hex' },
      ],
    },
  ],
  run: runGzip,
};
