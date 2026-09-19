/**
 * TOTP / HOTP mode: the input is a Base32 secret or an otpauth:// URL (whose
 * parameters override the controls). Computes the current code plus the
 * previous / next window with WebCrypto HMAC. The reference time comes from
 * ctx.options.now (ms) when present, else Date.now(). Pretty = full report,
 * Raw = just the current code.
 */

import { type ToolMode, type ModeResult, type RunContext } from './types.js';
import { base32Decode, hotp, totpCounter, parseOtpAuth, buildOtpAuth, OTP_ALGORITHMS, type OtpAlgorithm, type OtpAuth } from '../lib/otp.js';

export interface TotpData {
  mode: 'totp' | 'hotp';
  code: string;
  prev: string;
  next: string;
  digits: number;
  period: number;
  algorithm: OtpAlgorithm;
  /** Seconds left in the current period (totp only). */
  remaining: number;
  /** Counter used for the current code. */
  counter: string;
  url: string;
  issuer?: string;
  account?: string;
  now: number;
}

export async function runTotp(input: string, ctx: RunContext): Promise<ModeResult> {
  const text = input.trim();
  if (text === '') return { output: '', status: '' };
  const o = ctx.options;
  const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);
  const now = typeof o['now'] === 'number' && Number.isFinite(o['now']) ? (o['now'] as number) : Date.now();

  let secret = text;
  let algorithm: OtpAlgorithm = OTP_ALGORITHMS.includes(str(o['algorithm'], '').toUpperCase() as OtpAlgorithm) ? (str(o['algorithm'], '').toUpperCase() as OtpAlgorithm) : 'SHA1';
  let digits = Number(o['digits']) === 8 ? 8 : 6;
  let period = Number(o['period']) === 60 ? 60 : 30;
  let mode: 'totp' | 'hotp' = o['mode'] === 'hotp' ? 'hotp' : 'totp';
  const counterText = str(o['counter'], '0').trim();
  if (!/^\d*$/.test(counterText)) return { output: '', error: { message: `Counter "${counterText}" is not a non-negative integer.` }, status: 'Invalid counter' };
  let counter = BigInt(counterText === '' ? 0 : counterText);
  let parsed: OtpAuth | undefined;
  const notes: string[] = [];

  try {
    if (/^otpauth:\/\//i.test(text)) {
      parsed = parseOtpAuth(text);
      secret = parsed.secret;
      mode = parsed.type;
      if (parsed.algorithm) algorithm = parsed.algorithm;
      if (parsed.digits) digits = parsed.digits;
      if (parsed.period) period = parsed.period;
      if (parsed.counter !== undefined) counter = parsed.counter;
      notes.push('Options were taken from the otpauth:// URL.');
    }
    const key = base32Decode(secret);
    if (key.length < 10) notes.push(`Short secret (${key.length} bytes) — RFC 4226 recommends at least 16.`);

    const c = mode === 'totp' ? totpCounter(now, period) : counter;
    const [code, prev, next] = await Promise.all([hotp(key, c, digits, algorithm), hotp(key, c > 0n ? c - 1n : 0n, digits, algorithm), hotp(key, c + 1n, digits, algorithm)]);
    const remaining = mode === 'totp' ? period - (Math.floor(now / 1000) % period) : 0;
    const url = buildOtpAuth({
      type: mode,
      label: parsed?.label ?? 'c64',
      issuer: parsed?.issuer,
      account: parsed?.account ?? (parsed ? undefined : 'c64'),
      secret: secret.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase(),
      algorithm,
      digits,
      period,
      counter: mode === 'hotp' ? c : undefined,
    });
    const data: TotpData = { mode, code, prev, next, digits, period, algorithm, remaining, counter: String(c), url, issuer: parsed?.issuer, account: parsed?.account, now };
    const lines = [
      `${mode.toUpperCase()} code: ${code}`,
      mode === 'totp' ? `Valid for ${remaining} more second${remaining === 1 ? '' : 's'} (period ${period} s, counter ${c})` : `Counter ${c}`,
      `Previous: ${prev}`,
      `Next:     ${next}`,
      `Algorithm ${algorithm} · ${digits} digits`,
      `otpauth: ${url}`,
    ];
    return {
      output: ctx.pretty ? lines.join('\n') : code,
      view: { kind: 'totp', data },
      notes: notes.length ? notes : undefined,
      status: mode === 'totp' ? `TOTP · ${algorithm} · ${digits} digits · ${period} s · ${remaining} s left` : `HOTP · ${algorithm} · ${digits} digits · counter ${c}`,
    };
  } catch (e) {
    const err = e as { message: string; hint?: string };
    return { output: '', error: { message: err.message, hint: err.hint }, status: 'Invalid secret' };
  }
}

export const totpMode: ToolMode = {
  id: 'totp',
  label: 'TOTP / HOTP',
  description: 'Generate one-time codes from a Base32 secret or otpauth:// URL, entirely in the browser.',
  category: 'Crypto & IDs',
  icon: 'otp',
  keywords: ['totp', 'hotp', 'otp', '2fa', 'mfa', 'authenticator', 'one-time', 'otpauth', 'base32'],
  emptyHint: 'Paste a Base32 secret (e.g. JBSWY3DPEHPK3PXP) or an otpauth://totp/… URL to see the current code.',
  sample: 'otpauth://totp/c64:demo@example.com?secret=JBSWY3DPEHPK3PXP&issuer=c64&digits=6&period=30&algorithm=SHA1',
  supportsPretty: true,
  controls: [
    {
      kind: 'select',
      key: 'mode',
      label: 'Mode',
      default: 'totp',
      options: [
        { value: 'totp', label: 'TOTP (time)' },
        { value: 'hotp', label: 'HOTP (counter)' },
      ],
    },
    {
      kind: 'select',
      key: 'algorithm',
      label: 'Algorithm',
      default: 'SHA1',
      options: [
        { value: 'SHA1', label: 'SHA-1' },
        { value: 'SHA256', label: 'SHA-256' },
        { value: 'SHA512', label: 'SHA-512' },
      ],
    },
    {
      kind: 'select',
      key: 'digits',
      label: 'Digits',
      default: '6',
      options: [
        { value: '6', label: '6' },
        { value: '8', label: '8' },
      ],
    },
    {
      kind: 'select',
      key: 'period',
      label: 'Period',
      default: '30',
      options: [
        { value: '30', label: '30 s' },
        { value: '60', label: '60 s' },
      ],
    },
    { kind: 'text', key: 'counter', label: 'Counter', placeholder: '0 (HOTP)', default: '0' },
  ],
  run: runTotp,
};
