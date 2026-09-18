/**
 * Hex / Binary / Bytes mode: text → hex, hex → text, xxd-style hexdump,
 * text → binary, binary → text. "Auto" sniffs hex pairs or 0/1 groups and
 * decodes; anything else is encoded to hex.
 */

import { type ToolMode, type ModeResult, type RunContext } from './types.js';
import { utf8Encode, utf8Decode } from '../lib/bytes.js';

export type HexMode = 'text-to-hex' | 'hex-to-text' | 'hexdump' | 'text-to-binary' | 'binary-to-text' | 'auto';
export type HexSeparator = 'none' | 'space' | 'colon' | '0x';

export class HexError extends Error {
  constructor(message: string, public line: number, public col: number, public hint: string) {
    super(message);
  }
}

function lineCol(text: string, offset: number): { line: number; col: number } {
  const before = text.slice(0, offset);
  return { line: before.split('\n').length, col: offset - before.lastIndexOf('\n') };
}

export function looksLikeHex(s: string): boolean {
  const t = s.trim();
  if (t === '') return false;
  const stripped = t.replace(/0x/gi, '').replace(/[\s:,]/g, '');
  return stripped.length >= 2 && stripped.length % 2 === 0 && /^[0-9a-f]+$/i.test(stripped);
}

export function looksLikeBinary(s: string): boolean {
  const t = s.trim();
  if (t === '') return false;
  const stripped = t.replace(/\s/g, '');
  return stripped.length >= 8 && stripped.length % 8 === 0 && /^[01]+$/.test(stripped);
}

/** Parses hex tolerating spaces, colons, commas, newlines and 0x prefixes. Throws HexError with position. */
export function parseHex(input: string): Uint8Array {
  const digits: number[] = [];
  let lastDigitOffset = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i] as string;
    if (/[\s:,]/.test(ch)) continue;
    if ((ch === '0' && (input[i + 1] === 'x' || input[i + 1] === 'X')) && digits.length % 2 === 0) {
      i++;
      continue;
    }
    const v = parseInt(ch, 16);
    if (Number.isNaN(v) || !/^[0-9a-fA-F]$/.test(ch)) {
      const { line, col } = lineCol(input, i);
      throw new HexError(`'${ch}' is not a hexadecimal digit.`, line, col, 'Hex uses only 0-9 and a-f; separators may be spaces, colons, commas or 0x prefixes.');
    }
    digits.push(v);
    lastDigitOffset = i;
  }
  if (digits.length % 2 !== 0) {
    const { line, col } = lineCol(input, lastDigitOffset);
    throw new HexError(`Odd number of hex digits (${digits.length}) — the last byte is incomplete.`, line, col, 'Every byte needs two hex digits; add a leading 0 to the last one or remove it.');
  }
  const out = new Uint8Array(digits.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = ((digits[i * 2] as number) << 4) | (digits[i * 2 + 1] as number);
  return out;
}

/** Parses groups of 8 binary digits; whitespace between bits/groups is ignored. */
export function parseBinary(input: string): Uint8Array {
  const bits: number[] = [];
  let lastOffset = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i] as string;
    if (/\s/.test(ch)) continue;
    if (ch !== '0' && ch !== '1') {
      const { line, col } = lineCol(input, i);
      throw new HexError(`'${ch}' is not a binary digit.`, line, col, 'Binary uses only 0 and 1, in groups of 8 bits per byte.');
    }
    bits.push(ch === '1' ? 1 : 0);
    lastOffset = i;
  }
  if (bits.length % 8 !== 0) {
    const { line, col } = lineCol(input, lastOffset);
    throw new HexError(`Bit count ${bits.length} is not a multiple of 8 — the last byte is incomplete.`, line, col, 'Each byte needs exactly 8 bits; pad the last group with leading zeros.');
  }
  const out = new Uint8Array(bits.length / 8);
  for (let i = 0; i < out.length; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | (bits[i * 8 + j] as number);
    out[i] = b;
  }
  return out;
}

export function formatHex(data: Uint8Array, separator: HexSeparator, upper: boolean): string {
  const parts = Array.from(data, (b) => {
    const s = b.toString(16).padStart(2, '0');
    return upper ? s.toUpperCase() : s;
  });
  switch (separator) {
    case 'none': return parts.join('');
    case 'colon': return parts.join(':');
    case '0x': return parts.map((p) => `0x${p}`).join(', ');
    default: return parts.join(' ');
  }
}

export function formatBinary(data: Uint8Array, separator: HexSeparator): string {
  const parts = Array.from(data, (b) => b.toString(2).padStart(8, '0'));
  switch (separator) {
    case 'none': return parts.join('');
    case 'colon': return parts.join(':');
    case '0x': return parts.map((p) => `0b${p}`).join(', ');
    default: return parts.join(' ');
  }
}

/** xxd-style dump: `00000000: 48 65 6c ...  Hello world.` — 16 bytes per line. */
export function xxdDump(data: Uint8Array, upper = false): string {
  const lines: string[] = [];
  for (let off = 0; off < data.length; off += 16) {
    const chunk = data.subarray(off, off + 16);
    const hex = Array.from(chunk, (b) => {
      const s = b.toString(16).padStart(2, '0');
      return upper ? s.toUpperCase() : s;
    }).join(' ');
    const ascii = Array.from(chunk, (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${off.toString(16).padStart(8, '0')}: ${hex.padEnd(47)}  ${ascii}`);
  }
  return lines.join('\n');
}

export function runHex(input: string, ctx: RunContext): ModeResult {
  if (input === '') return { output: '', status: '' };
  const modeOpt = ctx.options['mode'];
  const sepOpt = ctx.options['separator'];
  const separator: HexSeparator = sepOpt === 'none' || sepOpt === 'colon' || sepOpt === '0x' ? sepOpt : 'space';
  const upper = ctx.options['uppercase'] === true;
  const notes: string[] = [];

  let mode: HexMode;
  if (modeOpt === 'text-to-hex' || modeOpt === 'hex-to-text' || modeOpt === 'hexdump' || modeOpt === 'text-to-binary' || modeOpt === 'binary-to-text') mode = modeOpt;
  else if (looksLikeBinary(input)) { mode = 'binary-to-text'; notes.push('Auto: input looks like binary octets, so it was decoded.'); }
  else if (looksLikeHex(input)) { mode = 'hex-to-text'; notes.push('Auto: input looks like hex bytes, so it was decoded.'); }
  else mode = 'text-to-hex';

  const bytesWord = (n: number) => `${n} byte${n === 1 ? '' : 's'}`;
  try {
    if (mode === 'hex-to-text' || mode === 'binary-to-text') {
      const data = mode === 'hex-to-text' ? parseHex(input) : parseBinary(input);
      const { text, invalid } = utf8Decode(data);
      if (invalid) notes.push('Some bytes are not valid UTF-8 and were replaced with U+FFFD.');
      return { output: text, notes: notes.length ? notes : undefined, status: `Decoded · ${bytesWord(data.length)}${invalid ? ' · not valid UTF-8' : ''}` };
    }
    const data = utf8Encode(input);
    let output: string;
    if (mode === 'hexdump') output = xxdDump(data, upper);
    else if (mode === 'text-to-binary') output = formatBinary(data, separator);
    else output = formatHex(data, separator, upper);
    return { output, notes: notes.length ? notes : undefined, status: `${mode === 'hexdump' ? 'Hexdump' : 'Encoded'} · ${bytesWord(data.length)}` };
  } catch (e) {
    if (e instanceof HexError) {
      return { output: '', error: { message: e.message, line: e.line, col: e.col, hint: e.hint }, status: `Invalid ${mode === 'binary-to-text' ? 'binary' : 'hex'} · line ${e.line}, col ${e.col}` };
    }
    return { output: '', error: { message: (e as Error).message }, status: 'Failed' };
  }
}

export const hexMode: ToolMode = {
  id: 'hex',
  label: 'Hex / Binary / Bytes',
  description: 'Convert text to hex or binary bytes and back, or view an xxd-style hexdump.',
  category: 'Encoding',
  icon: 'hex',
  keywords: ['hex', 'hexdump', 'xxd', 'binary', 'bytes', 'utf-8', 'octets'],
  emptyHint: 'Paste text to see its bytes, or hex / binary to decode it (auto-detected).',
  sample: '48 65 6c 6c 6f 2c 20 77 6f 72 6c 64 21',
  supportsPretty: false,
  controls: [
    {
      kind: 'select',
      key: 'mode',
      label: 'Mode',
      default: 'auto',
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'text-to-hex', label: 'Text → Hex' },
        { value: 'hex-to-text', label: 'Hex → Text' },
        { value: 'hexdump', label: 'Hexdump' },
        { value: 'text-to-binary', label: 'Text → Binary' },
        { value: 'binary-to-text', label: 'Binary → Text' },
      ],
    },
    {
      kind: 'select',
      key: 'separator',
      label: 'Separator',
      default: 'space',
      options: [
        { value: 'none', label: 'None' },
        { value: 'space', label: 'Space' },
        { value: 'colon', label: 'Colon' },
        { value: '0x', label: '0x, 0x' },
      ],
    },
    { kind: 'toggle', key: 'uppercase', label: 'Uppercase', default: false },
  ],
  run: runHex,
};
