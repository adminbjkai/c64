/**
 * JWT mode — DECODE ONLY.
 *
 * Splits header.payload.signature, pretty-prints both JSON parts, renders
 * time claims (exp, iat, nbf) as human dates and flags expiry. It never
 * verifies the signature: that needs the issuer's key, which this tool does
 * not have and will not fetch. The view says so, always.
 */

import { type ToolMode, type ModeResult, type RunContext } from './types.js';
import { decodeBase64 } from '../lib/base64.js';

export interface JwtClaim {
  name: string;
  value: unknown;
  /** Human rendering for time claims, e.g. "2026-09-16 14:02 UTC (in 3 hours)". */
  human?: string;
  /** Standard-claim description. */
  meaning?: string;
  /** Problem with this claim (expired, not yet valid). */
  warn?: string;
}

export interface JwtData {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: string;
  segments: [string, string, string];
  claims: JwtClaim[];
  status: 'valid-window' | 'expired' | 'not-yet-valid' | 'no-exp';
  alg: string;
  warnings: string[];
}

const MEANINGS: Record<string, string> = {
  iss: 'Issuer',
  sub: 'Subject',
  aud: 'Audience',
  exp: 'Expiration time',
  nbf: 'Not valid before',
  iat: 'Issued at',
  jti: 'JWT ID',
  scope: 'Granted scopes',
  azp: 'Authorized party',
  email: 'Email',
  name: 'Name',
};

/** "2026-09-16 14:02:00 UTC (in 2 hours)" for a NumericDate claim. */
export function humanTime(seconds: number, now = Date.now()): string {
  const d = new Date(seconds * 1000);
  const iso = d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
  const diff = seconds * 1000 - now;
  const abs = Math.abs(diff);
  const units: [number, string][] = [
    [86_400_000, 'day'],
    [3_600_000, 'hour'],
    [60_000, 'minute'],
    [1000, 'second'],
  ];
  let rel = 'now';
  for (const [ms, name] of units) {
    if (abs >= ms) {
      const n = Math.round(abs / ms);
      rel = `${n} ${name}${n === 1 ? '' : 's'}`;
      rel = diff < 0 ? `${rel} ago` : `in ${rel}`;
      break;
    }
  }
  return `${iso} (${rel})`;
}

function decodeSegment(seg: string, what: string): Record<string, unknown> {
  let text: string;
  try {
    text = decodeBase64(seg, { urlSafe: true }).text;
  } catch (e) {
    throw new Error(`The ${what} is not valid base64url: ${(e as Error).message}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`The ${what} decodes but is not JSON: ${text.slice(0, 60)}${text.length > 60 ? '…' : ''}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`The ${what} must be a JSON object.`);
  return value as Record<string, unknown>;
}

export function decodeJwt(token: string, now = Date.now()): JwtData {
  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    throw Object.assign(new Error(`A JWT has 3 dot-separated parts; this has ${parts.length}.`), {
      hint: parts.length === 5 ? 'Five parts means a JWE (encrypted token) — this tool only decodes signed JWS tokens.' : 'Expected header.payload.signature.',
    });
  }
  const [h, p, s] = parts as [string, string, string];
  const header = decodeSegment(h, 'header');
  const payload = decodeSegment(p, 'payload');
  const warnings: string[] = [];
  const alg = String(header['alg'] ?? 'missing');
  if (alg === 'none') warnings.push('alg is "none": this token is unsigned. Never accept such a token from an untrusted source.');
  if (!s) warnings.push('The signature segment is empty.');

  const claims: JwtClaim[] = [];
  let status: JwtData['status'] = 'no-exp';
  const nowSec = now / 1000;
  for (const [name, value] of Object.entries(payload)) {
    const c: JwtClaim = { name, value, meaning: MEANINGS[name] };
    if ((name === 'exp' || name === 'iat' || name === 'nbf') && typeof value === 'number' && Number.isFinite(value)) {
      c.human = humanTime(value, now);
      if (name === 'exp') {
        if (value < nowSec) {
          c.warn = 'Expired';
          status = 'expired';
        } else if (status === 'no-exp') status = 'valid-window';
      }
      if (name === 'nbf' && value > nowSec) {
        c.warn = 'Not yet valid';
        status = 'not-yet-valid';
      }
      if (name === 'iat' && value > nowSec + 300) c.warn = 'Issued in the future — clock skew?';
    }
    claims.push(c);
  }
  return { header, payload, signature: s, segments: [h, p, s], claims, status, alg, warnings };
}

export function runJwt(input: string, _ctx: RunContext): ModeResult {
  if (input.trim() === '') return { output: '', status: '' };
  try {
    const data = decodeJwt(input);
    const output = JSON.stringify({ header: data.header, payload: data.payload, signature: data.signature }, null, 2);
    const statusWord = { 'valid-window': 'within its validity window', expired: 'EXPIRED', 'not-yet-valid': 'not yet valid', 'no-exp': 'no expiry claim' }[data.status];
    return {
      output,
      view: { kind: 'jwt', data },
      status: `Decoded · alg ${data.alg} · ${statusWord} · signature NOT verified`,
    };
  } catch (e) {
    const err = e as Error & { hint?: string };
    return { output: '', error: { message: err.message, hint: err.hint }, status: 'Not a decodable JWT' };
  }
}

// A sample token (HS256, expired in 2024) — for demonstration only.
const SAMPLE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsImlzcyI6Imh0dHBzOi8vYXV0aC5leGFtcGxlLmNvbSIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjoxNzAwMDg2NDAwLCJzY29wZSI6InJlYWQgd3JpdGUifQ.' +
  'sflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

export const jwtMode: ToolMode = {
  id: 'jwt',
  label: 'JWT (decode only)',
  description: "Split and read a JWT's header and claims. Decode only — never verifies.",
  category: 'Encoding',
  icon: 'key',
  emptyHint: 'Paste a JWT to split and decode it. Signatures are never verified here.',
  sample: SAMPLE,
  supportsPretty: false,
  controls: [],
  run: runJwt,
};
