/**
 * HOTP (RFC 4226) and TOTP (RFC 6238) over WebCrypto HMAC, plus Base32
 * (RFC 4648, tolerant: case, spaces, hyphens, missing padding) and
 * otpauth:// URL parsing / building. SHA-1, SHA-256 and SHA-512 only.
 */

export type OtpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512';
export const OTP_ALGORITHMS: OtpAlgorithm[] = ['SHA1', 'SHA256', 'SHA512'];

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export class OtpError extends Error {
  hint?: string;
  constructor(message: string, hint?: string) {
    super(message);
    this.hint = hint;
  }
}

/** Decodes Base32, ignoring whitespace, hyphens, case and trailing '='. */
export function base32Decode(text: string): Uint8Array {
  const clean = text.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  if (clean === '') throw new OtpError('Secret is empty.', 'Paste the Base32 secret from the authenticator setup page or an otpauth:// URL.');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i] as string;
    const v = B32.indexOf(ch);
    if (v < 0) throw new OtpError(`'${ch}' is not a Base32 character.`, 'Base32 uses A–Z and 2–7 only (0, 1, 8 and 9 never appear).');
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function base32Encode(bytes: Uint8Array): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

const SUBTLE: Record<OtpAlgorithm, string> = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' };

export async function hotp(key: Uint8Array, counter: bigint, digits = 6, algorithm: OtpAlgorithm = 'SHA1'): Promise<string> {
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = Number(c & 0xffn);
    c >>= 8n;
  }
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: SUBTLE[algorithm] }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, msg as BufferSource));
  const offset = (mac[mac.length - 1] as number) & 0x0f;
  const code = (((mac[offset] as number) & 0x7f) << 24) | ((mac[offset + 1] as number) << 16) | ((mac[offset + 2] as number) << 8) | (mac[offset + 3] as number);
  return String(code % 10 ** digits).padStart(digits, '0');
}

export function totpCounter(nowMs: number, period: number): bigint {
  return BigInt(Math.floor(nowMs / 1000 / period));
}

export async function totp(key: Uint8Array, nowMs: number, opts: { digits?: number; period?: number; algorithm?: OtpAlgorithm } = {}): Promise<string> {
  return hotp(key, totpCounter(nowMs, opts.period ?? 30), opts.digits ?? 6, opts.algorithm ?? 'SHA1');
}

export interface OtpAuth {
  type: 'totp' | 'hotp';
  label: string;
  issuer?: string;
  account?: string;
  secret: string;
  algorithm?: OtpAlgorithm;
  digits?: number;
  period?: number;
  counter?: bigint;
}

export function parseOtpAuth(url: string): OtpAuth {
  const m = /^otpauth:\/\/(totp|hotp)\/([^?]*)(?:\?(.*))?$/i.exec(url.trim());
  if (!m) throw new OtpError('Not an otpauth:// URL.', 'Expected otpauth://totp/Issuer:account?secret=…');
  const type = (m[1] as string).toLowerCase() as 'totp' | 'hotp';
  const label = decodeURIComponent(m[2] as string);
  const params = new URLSearchParams(m[3] ?? '');
  const secret = params.get('secret') ?? '';
  if (secret === '') throw new OtpError('The otpauth URL has no secret parameter.');
  const out: OtpAuth = { type, label, secret };
  const colon = label.indexOf(':');
  if (colon >= 0) {
    out.issuer = label.slice(0, colon).trim();
    out.account = label.slice(colon + 1).trim();
  } else out.account = label;
  const issuer = params.get('issuer');
  if (issuer) out.issuer = issuer;
  const algo = (params.get('algorithm') ?? '').toUpperCase().replace('-', '');
  if (OTP_ALGORITHMS.includes(algo as OtpAlgorithm)) out.algorithm = algo as OtpAlgorithm;
  const digits = Number(params.get('digits'));
  if (digits === 6 || digits === 8) out.digits = digits;
  const period = Number(params.get('period'));
  if (Number.isInteger(period) && period > 0) out.period = period;
  const counter = params.get('counter');
  if (counter !== null && /^\d+$/.test(counter)) out.counter = BigInt(counter);
  return out;
}

export function buildOtpAuth(a: OtpAuth): string {
  const label = a.issuer ? `${a.issuer}:${a.account ?? ''}` : a.account ?? a.label;
  const p = new URLSearchParams();
  p.set('secret', a.secret);
  if (a.issuer) p.set('issuer', a.issuer);
  if (a.algorithm) p.set('algorithm', a.algorithm);
  if (a.digits) p.set('digits', String(a.digits));
  if (a.type === 'totp' && a.period) p.set('period', String(a.period));
  if (a.type === 'hotp') p.set('counter', String(a.counter ?? 0n));
  return `otpauth://${a.type}/${encodeURIComponent(label)}?${p.toString().replace(/\+/g, '%20')}`;
}
