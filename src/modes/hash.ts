/**
 * Hash / Checksum mode: MD5, SHA-1/256/384/512, CRC32 of the UTF-8 bytes of
 * the input, optionally as HMAC (SHA family only). SHA digests come from
 * crypto.subtle, so run() is async.
 */

import { type ToolMode, type ModeResult, type RunContext, formatBytes } from './types.js';
import { md5 } from '../lib/md5.js';
import { crc32Bytes } from '../lib/crc32.js';
import { toHex, bytesToBase64, utf8Encode } from '../lib/bytes.js';

export const HASH_ALGORITHMS = ['md5', 'sha1', 'sha256', 'sha384', 'sha512', 'crc32'] as const;
export type HashAlgorithm = (typeof HASH_ALGORITHMS)[number];

const SUBTLE_NAME: Record<string, string> = { sha1: 'SHA-1', sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' };

export interface HashRow {
  algorithm: HashAlgorithm;
  /** Encoded digest, or "n/a" when the algorithm cannot be used as HMAC. */
  digest: string;
  bits: number;
  note?: string;
}

export interface HashData {
  rows: HashRow[];
  bytes: number;
  encoding: 'hex' | 'base64';
  hmac: boolean;
}

/** Raw digest bytes for one algorithm. `key` switches the SHA family to HMAC; returns null for md5/crc32 under HMAC. */
export async function digestBytes(algorithm: HashAlgorithm, data: Uint8Array, key?: Uint8Array): Promise<Uint8Array | null> {
  if (algorithm === 'md5') return key ? null : md5(data);
  if (algorithm === 'crc32') return key ? null : crc32Bytes(data);
  const name = SUBTLE_NAME[algorithm] as string;
  if (key) {
    const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: name }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', k, data as BufferSource));
  }
  return new Uint8Array(await crypto.subtle.digest(name, data as BufferSource));
}

function encode(bytes: Uint8Array, encoding: 'hex' | 'base64', upper: boolean): string {
  if (encoding === 'base64') return bytesToBase64(bytes);
  return toHex(bytes, upper);
}

export async function runHash(input: string, ctx: RunContext): Promise<ModeResult> {
  if (input === '') return { output: '', status: '' };
  const trim = ctx.options['trim'] === true;
  const text = trim ? input.trim() : input;
  if (text === '') return { output: '', status: '', notes: ['Input is only whitespace and Trim is on — nothing to hash.'] };

  const algoOpt = ctx.options['algorithm'];
  const algorithms: HashAlgorithm[] = (HASH_ALGORITHMS as readonly string[]).includes(String(algoOpt)) ? [algoOpt as HashAlgorithm] : [...HASH_ALGORITHMS];
  const encoding: 'hex' | 'base64' = ctx.options['encoding'] === 'base64' ? 'base64' : 'hex';
  const upper = ctx.options['uppercase'] === true;
  const hmac = ctx.options['hmac'] === true;
  const keyText = typeof ctx.options['key'] === 'string' ? ctx.options['key'] : '';

  const data = utf8Encode(text);
  const key = hmac ? utf8Encode(keyText) : undefined;
  const notes: string[] = [];
  if (hmac && keyText === '') notes.push('HMAC is on but the key is empty — the MAC is computed with a zero-length key.');
  if (!trim && /\s$/.test(input)) notes.push('Input ends with whitespace/newline, which is included in the hash. Turn on Trim to exclude it.');

  const rows: HashRow[] = [];
  try {
    for (const algorithm of algorithms) {
      const bytes = await digestBytes(algorithm, data, key);
      if (bytes === null) rows.push({ algorithm, digest: 'n/a', bits: algorithm === 'md5' ? 128 : 32, note: `HMAC-${algorithm.toUpperCase()} is not supported here` });
      else rows.push({ algorithm, digest: encode(bytes, encoding, upper), bits: bytes.length * 8 });
    }
  } catch (e) {
    return { output: '', error: { message: `Digest failed: ${(e as Error).message}` }, status: 'Hash failed' };
  }

  const output = rows.length === 1 ? (rows[0] as HashRow).digest : rows.map((r) => `${r.algorithm.padEnd(7)} ${r.digest}`).join('\n');
  const label = hmac ? 'HMAC' : 'Hashed';
  return {
    output,
    view: { kind: 'hash', data: { rows, bytes: data.length, encoding, hmac } satisfies HashData },
    notes: notes.length ? notes : undefined,
    status: `${label} · ${data.length} byte${data.length === 1 ? '' : 's'} (${formatBytes(data.length)}) · ${encoding}${trim ? ' · trimmed' : ''}`,
  };
}

export const hashMode: ToolMode = {
  id: 'hash',
  label: 'Hash / Checksum',
  description: 'MD5, SHA-1/256/384/512 and CRC32 of the input, optionally as an HMAC.',
  category: 'Crypto & IDs',
  icon: 'hash',
  keywords: ['md5', 'sha', 'sha256', 'sha512', 'crc', 'crc32', 'checksum', 'digest', 'hmac'],
  emptyHint: 'Paste any text to see its MD5, SHA and CRC32 digests. Everything is computed locally.',
  sample: 'The quick brown fox jumps over the lazy dog',
  supportsPretty: false,
  controls: [
    {
      kind: 'select',
      key: 'algorithm',
      label: 'Algorithm',
      default: 'all',
      options: [
        { value: 'all', label: 'All' },
        { value: 'md5', label: 'MD5' },
        { value: 'sha1', label: 'SHA-1' },
        { value: 'sha256', label: 'SHA-256' },
        { value: 'sha384', label: 'SHA-384' },
        { value: 'sha512', label: 'SHA-512' },
        { value: 'crc32', label: 'CRC32' },
      ],
    },
    {
      kind: 'select',
      key: 'encoding',
      label: 'Encoding',
      default: 'hex',
      options: [
        { value: 'hex', label: 'Hex' },
        { value: 'base64', label: 'Base64' },
      ],
    },
    { kind: 'toggle', key: 'uppercase', label: 'Uppercase', default: false },
    { kind: 'toggle', key: 'trim', label: 'Trim', default: false },
    { kind: 'toggle', key: 'hmac', label: 'HMAC', default: false },
    { kind: 'text', key: 'key', label: 'Key', placeholder: 'HMAC secret', default: '' },
  ],
  run: runHash,
};
