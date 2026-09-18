/**
 * Number Base Converter: one integer per line (0x/0b/0o prefixes, `_`
 * separators, negatives) converted between bases 2/8/10/16/36 with BigInt.
 */

import { type ToolMode, type ModeResult, type RunContext } from './types.js';

export type Radix = 2 | 8 | 10 | 16 | 36;
export const RADICES: Radix[] = [2, 8, 10, 16, 36];
const RADIX_NAME: Record<Radix, string> = { 2: 'binary', 8: 'octal', 10: 'decimal', 16: 'hexadecimal', 36: 'base-36' };
const PREFIX: Record<string, Radix> = { '0x': 16, '0b': 2, '0o': 8 };

export interface BaseNRow {
  input: string;
  dec: string;
  hex: string;
  oct: string;
  bin: string;
  base36: string;
  detected: Radix;
  negative: boolean;
}

export interface BaseNData {
  rows: BaseNRow[];
  to: Radix | 'all';
}

export class BaseNError extends Error {
  constructor(message: string, public line: number, public col: number, public hint: string) {
    super(message);
  }
}

function digitValue(ch: string): number {
  const c = ch.toLowerCase();
  if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48;
  if (c >= 'a' && c <= 'z') return c.charCodeAt(0) - 87;
  return -1;
}

/** Parses one line. `from` "auto" uses the prefix, else falls back to decimal (or hex if a-f digits appear). */
export function parseNumber(raw: string, from: Radix | 'auto', line = 1): { value: bigint; radix: Radix; negative: boolean } {
  let s = raw.trim();
  let col = raw.indexOf(s) + 1;
  let negative = false;
  if (s.startsWith('-') || s.startsWith('+')) {
    negative = s.startsWith('-');
    s = s.slice(1);
    col++;
  }
  let radix: Radix | 'auto' = from;
  const pre = s.slice(0, 2).toLowerCase();
  if (PREFIX[pre] !== undefined) {
    const p = PREFIX[pre] as Radix;
    if (from !== 'auto' && from !== p) throw new BaseNError(`Prefix '${s.slice(0, 2)}' means ${RADIX_NAME[p]}, but From is set to ${RADIX_NAME[from]}.`, line, col, 'Remove the prefix or set From to Auto.');
    radix = p;
    s = s.slice(2);
    col += 2;
  }
  if (s === '') throw new BaseNError('No digits found.', line, col, 'Type a number such as 255, 0xff, 0b1010 or 0o377.');
  if (radix === 'auto') radix = /[a-f]/i.test(s) ? 16 : /[g-z]/i.test(s) ? 36 : 10;
  let value = 0n;
  const big = BigInt(radix);
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] as string;
    if (ch === '_') continue;
    const v = digitValue(ch);
    if (v < 0 || v >= radix) {
      throw new BaseNError(`'${ch}' is not a ${RADIX_NAME[radix]} digit.`, line, col + i, radix === 10 && v >= 10 ? "Use a 0x prefix for hex, or set From to the number's base." : `Base ${radix} digits are 0-${radix <= 10 ? radix - 1 : (radix - 1).toString(36)}.`);
    }
    value = value * big + BigInt(v);
  }
  return { value: negative ? -value : value, radix, negative };
}

export function toRow(input: string, value: bigint, radix: Radix, negative: boolean, upper: boolean): BaseNRow {
  const fmt = (r: number) => {
    const s = value.toString(r);
    return upper ? s.toUpperCase() : s;
  };
  return { input, dec: value.toString(10), hex: fmt(16), oct: fmt(8), bin: fmt(2), base36: fmt(36), detected: radix, negative };
}

export function runBaseN(input: string, ctx: RunContext): ModeResult {
  if (input.trim() === '') return { output: '', status: '' };
  const fromOpt = String(ctx.options['from'] ?? 'auto');
  const from: Radix | 'auto' = (RADICES as number[]).includes(Number(fromOpt)) ? (Number(fromOpt) as Radix) : 'auto';
  const toOpt = String(ctx.options['to'] ?? 'all');
  const to: Radix | 'all' = (RADICES as number[]).includes(Number(toOpt)) ? (Number(toOpt) as Radix) : 'all';
  const upper = ctx.options['uppercase'] === true;

  const rows: BaseNRow[] = [];
  const lines = input.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] as string;
    if (raw.trim() === '') continue;
    try {
      const { value, radix, negative } = parseNumber(raw, from, i + 1);
      rows.push(toRow(raw.trim(), value, radix, negative, upper));
    } catch (e) {
      if (e instanceof BaseNError) return { output: '', error: { message: e.message, line: e.line, col: e.col, hint: e.hint }, status: `Invalid number · line ${e.line}, col ${e.col}` };
      return { output: '', error: { message: (e as Error).message }, status: 'Invalid number' };
    }
  }

  const pick = (r: BaseNRow, radix: Radix) => ({ 2: r.bin, 8: r.oct, 10: r.dec, 16: r.hex, 36: r.base36 })[radix];
  let output: string;
  if (to === 'all') {
    output = ['input\tdec\thex\toct\tbin', ...rows.map((r) => [r.input, r.dec, r.hex, r.oct, r.bin].join('\t'))].join('\n');
  } else {
    output = rows.map((r) => pick(r, to)).join('\n');
  }
  return {
    output,
    view: { kind: 'basen', data: { rows, to } satisfies BaseNData },
    status: `${rows.length} number${rows.length === 1 ? '' : 's'} · from ${from === 'auto' ? 'auto' : RADIX_NAME[from]} · to ${to === 'all' ? 'all bases' : RADIX_NAME[to]}`,
  };
}

export const baseNMode: ToolMode = {
  id: 'base-n',
  label: 'Number Base Converter',
  description: 'Convert integers of any size between binary, octal, decimal, hex and base-36.',
  category: 'Encoding',
  icon: 'hex',
  keywords: ['radix', 'binary', 'octal', 'decimal', 'hexadecimal', 'base', 'bigint'],
  emptyHint: 'One number per line — 255, 0xff, 0b1111_1111, 0o377 or -42. Huge integers are fine.',
  sample: '255\n0xdead_beef\n0b1010\n0o755\n-18446744073709551616',
  supportsPretty: false,
  controls: [
    {
      kind: 'select',
      key: 'from',
      label: 'From',
      default: 'auto',
      options: [
        { value: 'auto', label: 'Auto' },
        { value: '2', label: 'Binary' },
        { value: '8', label: 'Octal' },
        { value: '10', label: 'Decimal' },
        { value: '16', label: 'Hex' },
        { value: '36', label: 'Base-36' },
      ],
    },
    {
      kind: 'select',
      key: 'to',
      label: 'To',
      default: 'all',
      options: [
        { value: 'all', label: 'All' },
        { value: '2', label: 'Binary' },
        { value: '8', label: 'Octal' },
        { value: '10', label: 'Decimal' },
        { value: '16', label: 'Hex' },
        { value: '36', label: 'Base-36' },
      ],
    },
    { kind: 'toggle', key: 'uppercase', label: 'Uppercase', default: false },
  ],
  run: runBaseN,
};
