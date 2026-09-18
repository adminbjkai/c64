/**
 * UUID / ULID / random-id generation and decoding. Implements: UUID v4 and
 * v7 (RFC 9562), ULID (Crockford base32, 48-bit ms + 80 random bits), nanoid
 * (21 chars, A-Za-z0-9_-), random hex / base64 bytes, passwords; decoding of
 * any UUID (version, variant, v1/v6/v7 timestamps) and ULIDs.
 * Randomness always comes from crypto.getRandomValues.
 */

import { toHex, bytesToBase64 } from './bytes.js';

export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const NANOID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
const PASSWORD_ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const PASSWORD_SYMBOLS = '!@#$%^&*()-_=+[]{};:,.<>?';

/** Gregorian-to-Unix epoch offset in 100 ns ticks (1582-10-15 → 1970-01-01). */
const GREGORIAN_OFFSET_100NS = 122192928000000000n;

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

function formatUuid(bytes: Uint8Array): string {
  const x = toHex(bytes);
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export function uuidV4(): string {
  const b = randomBytes(16);
  b[6] = ((b[6] as number) & 0x0f) | 0x40;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  return formatUuid(b);
}

export function uuidV7(ms: number): string {
  const b = randomBytes(16);
  let t = BigInt(Math.floor(ms));
  for (let i = 5; i >= 0; i--) {
    b[i] = Number(t & 0xffn);
    t >>= 8n;
  }
  b[6] = ((b[6] as number) & 0x0f) | 0x70;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  return formatUuid(b);
}

export function ulid(ms: number): string {
  let out = '';
  let t = BigInt(Math.floor(ms));
  const timeChars: string[] = [];
  for (let i = 0; i < 10; i++) {
    timeChars.unshift(CROCKFORD[Number(t & 31n)] as string);
    t >>= 5n;
  }
  out = timeChars.join('');
  // 80 random bits = 16 base32 chars. Use 16 random bytes, 5 bits each (slight bias-free since 256 % 32 == 0).
  const r = randomBytes(16);
  for (let i = 0; i < 16; i++) out += CROCKFORD[(r[i] as number) & 31];
  return out;
}

function pickChars(alphabet: string, n: number): string {
  // Rejection sampling to avoid modulo bias.
  const max = 256 - (256 % alphabet.length);
  let out = '';
  while (out.length < n) {
    const buf = randomBytes(n * 2);
    for (let i = 0; i < buf.length && out.length < n; i++) {
      const v = buf[i] as number;
      if (v < max) out += alphabet[v % alphabet.length];
    }
  }
  return out;
}

export function nanoid(n = 21): string {
  return pickChars(NANOID_ALPHABET, n);
}

export function randomHex(bytes: number): string {
  return toHex(randomBytes(bytes));
}

export function randomBase64(bytes: number): string {
  return bytesToBase64(randomBytes(bytes));
}

export function password(length: number, symbols: boolean): string {
  return pickChars(symbols ? PASSWORD_ALNUM + PASSWORD_SYMBOLS : PASSWORD_ALNUM, length);
}

/* ------------------------------------------------------------- decoding */

export interface IdInfo {
  id: string;
  kind: 'uuid' | 'ulid';
  valid: boolean;
  version?: number;
  versionName?: string;
  variant?: string;
  /** Embedded timestamp as ISO, when the id carries one. */
  timestamp?: string;
  timestampMs?: number;
  fields: { label: string; value: string }[];
  warnings: string[];
}

const VERSION_NAMES: Record<number, string> = {
  1: 'time-based (Gregorian)',
  2: 'DCE security',
  3: 'name-based (MD5)',
  4: 'random',
  5: 'name-based (SHA-1)',
  6: 'time-ordered (reordered Gregorian)',
  7: 'time-ordered (Unix ms)',
  8: 'custom / vendor',
};

function ticksToMs(ticks: bigint): number {
  return Number((ticks - GREGORIAN_OFFSET_100NS) / 10000n);
}

function safeIso(ms: number): string | undefined {
  if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) return undefined;
  return new Date(ms).toISOString();
}

export function decodeUuid(raw: string): IdInfo {
  const id = raw.trim();
  const hex = id.replace(/-/g, '').toLowerCase();
  const info: IdInfo = { id, kind: 'uuid', valid: false, fields: [], warnings: [] };
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    info.warnings.push('Not 32 hex digits.');
    return info;
  }
  if (id.includes('-') && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) info.warnings.push('Hyphens are not in the standard 8-4-4-4-12 positions.');
  info.valid = true;
  if (hex === '0'.repeat(32)) { info.versionName = 'nil UUID'; info.fields.push({ label: 'Special', value: 'Nil UUID (all zeros)' }); return info; }
  if (hex === 'f'.repeat(32)) { info.versionName = 'max UUID'; info.fields.push({ label: 'Special', value: 'Max UUID (all ones)' }); return info; }

  const version = parseInt(hex[12] as string, 16);
  const varNibble = parseInt(hex[16] as string, 16);
  const variant = varNibble < 8 ? 'NCS (reserved, backward compatibility)' : varNibble < 0xc ? 'RFC 4122 / 9562' : varNibble < 0xe ? 'Microsoft (reserved)' : 'Reserved (future)';
  info.version = version;
  info.versionName = VERSION_NAMES[version] ?? 'unknown';
  info.variant = variant;
  info.fields.push({ label: 'Version', value: `${version} — ${info.versionName}` }, { label: 'Variant', value: variant });
  if (varNibble < 8 || varNibble >= 0xc) info.warnings.push('Variant is not RFC 4122 — version bits may not mean what they usually do.');
  if (!(version >= 1 && version <= 8)) info.warnings.push(`Version nibble ${version} is not a defined UUID version.`);

  if (version === 1) {
    const timeLow = BigInt('0x' + hex.slice(0, 8));
    const timeMid = BigInt('0x' + hex.slice(8, 12));
    const timeHi = BigInt('0x' + hex.slice(13, 16));
    const ticks = (timeHi << 48n) | (timeMid << 32n) | timeLow;
    const ms = ticksToMs(ticks);
    const iso = safeIso(ms);
    if (iso) { info.timestamp = iso; info.timestampMs = ms; info.fields.push({ label: 'Timestamp', value: iso }); }
    info.fields.push({ label: 'Clock sequence', value: String(parseInt(hex.slice(16, 20), 16) & 0x3fff) }, { label: 'Node', value: hex.slice(20).match(/../g)!.join(':') });
    if ((parseInt(hex.slice(20, 22), 16) & 1) === 1) info.fields.push({ label: 'Node type', value: 'random (multicast bit set)' });
    else info.fields.push({ label: 'Node type', value: 'MAC address (unicast bit)' });
  } else if (version === 6) {
    const timeHigh = BigInt('0x' + hex.slice(0, 12));
    const timeLow = BigInt('0x' + hex.slice(13, 16));
    const ms = ticksToMs((timeHigh << 12n) | timeLow);
    const iso = safeIso(ms);
    if (iso) { info.timestamp = iso; info.timestampMs = ms; info.fields.push({ label: 'Timestamp', value: iso }); }
    info.fields.push({ label: 'Clock sequence', value: String(parseInt(hex.slice(16, 20), 16) & 0x3fff) }, { label: 'Node', value: hex.slice(20).match(/../g)!.join(':') });
  } else if (version === 7) {
    const ms = parseInt(hex.slice(0, 12), 16);
    const iso = safeIso(ms);
    if (iso) { info.timestamp = iso; info.timestampMs = ms; info.fields.push({ label: 'Timestamp', value: `${iso} (${ms} ms)` }); }
    info.fields.push({ label: 'rand_a', value: hex.slice(13, 16) }, { label: 'rand_b', value: hex.slice(16) });
  } else if (version === 4) {
    info.fields.push({ label: 'Random bits', value: '122' });
  } else if (version === 3 || version === 5) {
    info.fields.push({ label: 'Hash', value: version === 3 ? 'MD5 of namespace + name (truncated)' : 'SHA-1 of namespace + name (truncated)' });
  }
  return info;
}

export function decodeUlid(raw: string): IdInfo {
  const id = raw.trim().toUpperCase();
  const info: IdInfo = { id: raw.trim(), kind: 'ulid', valid: false, fields: [], warnings: [] };
  if (id.length !== 26) { info.warnings.push(`A ULID is 26 characters; this has ${id.length}.`); return info; }
  for (let i = 0; i < 26; i++) {
    const ch = id[i] as string;
    if (!CROCKFORD.includes(ch)) { info.warnings.push(`'${ch}' at position ${i + 1} is not a Crockford base32 character (I, L, O and U are excluded).`); return info; }
  }
  if ((CROCKFORD.indexOf(id[0] as string)) > 7) { info.warnings.push('First character above "7" — the timestamp overflows 48 bits.'); return info; }
  let t = 0n;
  for (let i = 0; i < 10; i++) t = (t << 5n) | BigInt(CROCKFORD.indexOf(id[i] as string));
  const ms = Number(t);
  info.valid = true;
  info.timestampMs = ms;
  info.timestamp = safeIso(ms);
  info.fields.push({ label: 'Timestamp', value: `${info.timestamp ?? '(out of range)'} (${ms} ms)` }, { label: 'Randomness', value: id.slice(10) + ' (80 bits)' });
  return info;
}

const UUID_RE = /\b[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\b/gi;
const ULID_RE = /\b[0-7][0-9A-HJKMNP-TV-Z]{25}\b/g;

/** Finds every UUID / ULID in a text, in document order. */
export function findIds(text: string): { id: string; kind: 'uuid' | 'ulid' }[] {
  const found: { index: number; id: string; kind: 'uuid' | 'ulid' }[] = [];
  for (const m of text.matchAll(UUID_RE)) found.push({ index: m.index, id: m[0], kind: 'uuid' });
  for (const m of text.matchAll(ULID_RE)) {
    // A 26-char hex-only run would also match as (part of) a UUID; skip those overlaps.
    if (found.some((f) => m.index >= f.index && m.index < f.index + f.id.length)) continue;
    found.push({ index: m.index, id: m[0], kind: 'ulid' });
  }
  found.sort((a, b) => a.index - b.index);
  return found.map(({ id, kind }) => ({ id, kind }));
}
