/**
 * String Utilities mode: slugify, deburr, reverse, ROT13/47, NATO spelling,
 * obfuscate, Roman numerals, \uXXXX escape/unescape and a code-point table.
 * With Per line on, each line is transformed independently.
 */

import { type ToolMode, type ModeResult, type RunContext } from './types.js';
import type { TableData } from './csv.js';
import { slugify, deburr, reverseString, rot13, rot47, nato, obfuscate, roman, unicodeEscapeAuto, codePoints } from '../lib/strings.js';

export type StringOp = 'slugify' | 'deburr' | 'reverse' | 'rot13' | 'rot47' | 'nato' | 'obfuscate' | 'roman' | 'unicode-escape' | 'codepoints';

const OPS: { value: StringOp; label: string }[] = [
  { value: 'slugify', label: 'Slugify' },
  { value: 'deburr', label: 'Deburr (strip accents)' },
  { value: 'reverse', label: 'Reverse' },
  { value: 'rot13', label: 'ROT13' },
  { value: 'rot47', label: 'ROT47' },
  { value: 'nato', label: 'NATO phonetic' },
  { value: 'obfuscate', label: 'Obfuscate (mask middle)' },
  { value: 'roman', label: 'Roman numerals ↔ number' },
  { value: 'unicode-escape', label: 'Unicode escape ↔ unescape' },
  { value: 'codepoints', label: 'Code points' },
];

interface Opts {
  lowercase: boolean;
  separator: string;
  maxLength: number;
  keep: number;
}

export function applyStringOp(text: string, op: StringOp, o: Opts): string {
  switch (op) {
    case 'slugify': return slugify(text, { lowercase: o.lowercase, separator: o.separator, maxLength: o.maxLength });
    case 'deburr': return deburr(text);
    case 'reverse': return reverseString(text);
    case 'rot13': return rot13(text);
    case 'rot47': return rot47(text);
    case 'nato': return nato(text);
    case 'obfuscate': return obfuscate(text, o.keep);
    case 'roman': return roman(text);
    case 'unicode-escape': return unicodeEscapeAuto(text).text;
    case 'codepoints': return codePoints(text).map((c) => `${c.codePoint.padEnd(8)} ${JSON.stringify(c.char).padEnd(8)} ${c.category.padEnd(17)} utf-8 ${c.utf8} B · utf-16 ${c.utf16} B`).join('\n');
  }
}

const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);

export function runStringUtils(input: string, ctx: RunContext): ModeResult {
  if (input === '') return { output: '', status: '' };
  const opOpt = ctx.options['op'];
  const op: StringOp = OPS.some((x) => x.value === opOpt) ? (opOpt as StringOp) : 'slugify';
  const maxLenRaw = Number(str(ctx.options['maxLength'], '').trim() || '0');
  const keepRaw = Number(str(ctx.options['keep'], '2').trim());
  const o: Opts = {
    lowercase: ctx.options['lowercase'] !== false,
    separator: str(ctx.options['separator'], '-'),
    maxLength: Number.isFinite(maxLenRaw) && maxLenRaw > 0 ? Math.floor(maxLenRaw) : 0,
    keep: Number.isInteger(keepRaw) && keepRaw >= 0 ? keepRaw : 2,
  };
  const perLine = ctx.options['perLine'] !== false;
  const label = OPS.find((x) => x.value === op)!.label;

  if (op === 'codepoints') {
    const cps = codePoints(input);
    const rows = cps.map((c) => [c.char === '\n' ? '\\n' : c.char === '\t' ? '\\t' : c.char === '\r' ? '\\r' : c.char, c.codePoint, String(c.decimal), c.category, String(c.utf8), String(c.utf16)]);
    const utf8 = cps.reduce((n, c) => n + c.utf8, 0);
    const utf16 = cps.reduce((n, c) => n + c.utf16, 0);
    const data: TableData = { header: ['Char', 'Code point', 'Decimal', 'Category', 'UTF-8 bytes', 'UTF-16 bytes'], rows, total: rows.length };
    return {
      output: applyStringOp(input, op, o),
      view: { kind: 'table', data },
      status: `${cps.length} code point${cps.length === 1 ? '' : 's'} · ${input.length} UTF-16 unit${input.length === 1 ? '' : 's'} · ${utf8} bytes UTF-8 · ${utf16} bytes UTF-16`,
    };
  }

  const lines = perLine ? input.split(/\r?\n/) : [input];
  const out: string[] = [];
  let firstError: ModeResult['error'];
  let failed = 0;
  lines.forEach((line, i) => {
    if (perLine && line.trim() === '' && (op === 'roman')) { out.push(line); return; }
    try {
      out.push(applyStringOp(line, op, o));
    } catch (e) {
      failed++;
      const msg = (e as Error).message;
      out.push(`✗ ${msg}`);
      if (!firstError) firstError = { message: msg, line: perLine ? i + 1 : undefined, col: 1, hint: op === 'roman' ? 'Use an integer 1–3999 or a numeral like MCMXCIV (one per line).' : undefined };
    }
  });
  const direction = op === 'unicode-escape' ? ` · ${unicodeEscapeAuto(input).direction}d` : '';
  return {
    output: out.join('\n'),
    error: firstError,
    status: failed ? `${label} · ${failed} of ${lines.length} line${lines.length === 1 ? '' : 's'} failed` : `${label}${direction} · ${lines.length} line${lines.length === 1 ? '' : 's'} · ${out.join('\n').length} chars`,
  };
}

export const stringUtilsMode: ToolMode = {
  id: 'string-utils',
  label: 'String Utilities',
  description: 'Slugify, strip accents, reverse, ROT13/47, NATO spelling, mask, Roman numerals, Unicode escapes and code points.',
  category: 'Text',
  icon: 'stringTool',
  keywords: ['slug', 'slugify', 'deburr', 'accents', 'diacritics', 'reverse', 'rot13', 'rot47', 'nato', 'phonetic', 'mask', 'obfuscate', 'roman', 'unicode', 'escape', 'codepoint', 'utf-8'],
  emptyHint: 'Paste text and pick an operation. Roman numerals: one number or numeral per line. Unicode escape auto-detects \\uXXXX input and unescapes it.',
  sample: 'Crème Brûlée & Zürich — 2024 Edition!',
  sampleOptions: { op: 'slugify' },
  supportsPretty: false,
  controls: [
    { kind: 'select', key: 'op', label: 'Operation', default: 'slugify', options: OPS },
    { kind: 'toggle', key: 'perLine', label: 'Per line', default: true },
    { kind: 'toggle', key: 'lowercase', label: 'Lowercase', default: true },
    { kind: 'text', key: 'separator', label: 'Separator', placeholder: '-', default: '-' },
    { kind: 'text', key: 'maxLength', label: 'Max length', placeholder: 'none', default: '' },
    { kind: 'text', key: 'keep', label: 'Keep', placeholder: '2 (obfuscate)', default: '2' },
  ],
  run: runStringUtils,
};
