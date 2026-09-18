/**
 * Line Tools mode: sort, dedupe, shuffle, number, wrap, join/split and
 * friends — small pure operations over the lines of the input.
 */

import { type ToolMode, type ModeResult, type RunContext } from './types.js';

export type LineOp =
  | 'sort' | 'sort-desc' | 'sort-natural' | 'sort-length' | 'reverse' | 'shuffle'
  | 'dedupe' | 'dedupe-consecutive' | 'trim' | 'remove-empty' | 'number' | 'unnumber'
  | 'prefix-suffix' | 'join' | 'split' | 'unique-count' | 'wrap' | 'truncate';

const OPS: { value: LineOp; label: string }[] = [
  { value: 'sort', label: 'Sort A→Z' },
  { value: 'sort-desc', label: 'Sort Z→A' },
  { value: 'sort-natural', label: 'Sort natural (numeric-aware)' },
  { value: 'sort-length', label: 'Sort by length' },
  { value: 'reverse', label: 'Reverse' },
  { value: 'shuffle', label: 'Shuffle (seeded)' },
  { value: 'dedupe', label: 'Remove duplicates' },
  { value: 'dedupe-consecutive', label: 'Remove consecutive duplicates' },
  { value: 'trim', label: 'Trim whitespace' },
  { value: 'remove-empty', label: 'Remove empty lines' },
  { value: 'number', label: 'Number lines' },
  { value: 'unnumber', label: 'Strip numbering / bullets' },
  { value: 'prefix-suffix', label: 'Add prefix / suffix' },
  { value: 'join', label: 'Join with separator' },
  { value: 'split', label: 'Split by separator' },
  { value: 'unique-count', label: 'Count unique lines' },
  { value: 'wrap', label: 'Hard wrap at width' },
  { value: 'truncate', label: 'Truncate at width' },
];

interface Opts {
  caseInsensitive: boolean;
  seed: string;
  prefix: string;
  suffix: string;
  separator: string;
  width: number;
}

const key = (s: string, o: Opts) => (o.caseInsensitive ? s.toLowerCase() : s);
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Deterministic Fisher–Yates using a small LCG seeded from the seed text. */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  let state = 0;
  for (const ch of seed) state = (state * 31 + ch.charCodeAt(0)) >>> 0;
  state = (state || 1) >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function wrapLine(line: string, width: number): string[] {
  const words = line.split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return [''];
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur === '') cur = w;
    else if (cur.length + 1 + w.length <= width) cur += ' ' + w;
    else {
      out.push(cur);
      cur = w;
    }
  }
  out.push(cur);
  return out;
}

const NUMBERING = /^\s*(?:\d+[.):]|\(\d+\)|[a-zA-Z][.)]|[-*•+–—>]|\[[ xX]?\])\s+/;

export function applyLineOp(lines: string[], op: LineOp, o: Opts): string[] {
  switch (op) {
    case 'sort': return lines.slice().sort((a, b) => cmp(key(a, o), key(b, o)));
    case 'sort-desc': return lines.slice().sort((a, b) => cmp(key(b, o), key(a, o)));
    case 'sort-natural': return lines.slice().sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: o.caseInsensitive ? 'base' : 'variant' }));
    case 'sort-length': return lines.slice().sort((a, b) => a.length - b.length || cmp(a, b));
    case 'reverse': return lines.slice().reverse();
    case 'shuffle': return seededShuffle(lines, o.seed);
    case 'dedupe': {
      const seen = new Set<string>();
      return lines.filter((l) => (seen.has(key(l, o)) ? false : (seen.add(key(l, o)), true)));
    }
    case 'dedupe-consecutive': return lines.filter((l, i) => i === 0 || key(l, o) !== key(lines[i - 1]!, o));
    case 'trim': return lines.map((l) => l.trim());
    case 'remove-empty': return lines.filter((l) => l.trim() !== '');
    case 'number': return lines.map((l, i) => `${i + 1}. ${l}`);
    case 'unnumber': return lines.map((l) => l.replace(NUMBERING, ''));
    case 'prefix-suffix': return lines.map((l) => o.prefix + l + o.suffix);
    case 'join': return [lines.join(o.separator)];
    case 'split': return lines.join('\n').split(o.separator).map((s) => s.trim());
    case 'unique-count': {
      const counts = new Map<string, { line: string; n: number }>();
      for (const l of lines) {
        const k = key(l, o);
        const e = counts.get(k);
        if (e) e.n++;
        else counts.set(k, { line: l, n: 1 });
      }
      return Array.from(counts.values()).sort((a, b) => b.n - a.n).map((e) => `${e.n}\t${e.line}`);
    }
    case 'wrap': return lines.flatMap((l) => wrapLine(l, o.width));
    case 'truncate': return lines.map((l) => (l.length > o.width ? l.slice(0, Math.max(0, o.width - 1)) + '…' : l));
  }
}

const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);
/** Allow "\n" and "\t" to be typed into the separator control. */
const unescapeSep = (s: string) => s.replace(/\\n/g, '\n').replace(/\\t/g, '\t');

export function runLines(input: string, ctx: RunContext): ModeResult {
  if (input === '') return { output: '', status: '' };
  const opOpt = ctx.options['op'];
  const op: LineOp = OPS.some((x) => x.value === opOpt) ? (opOpt as LineOp) : 'sort';
  const widthRaw = Number(str(ctx.options['width'], '80'));
  const o: Opts = {
    caseInsensitive: ctx.options['caseInsensitive'] === true,
    seed: str(ctx.options['seed'], '1'),
    prefix: str(ctx.options['prefix'], ''),
    suffix: str(ctx.options['suffix'], ''),
    separator: unescapeSep(str(ctx.options['separator'], ', ')),
    width: Number.isFinite(widthRaw) && widthRaw > 0 ? Math.floor(widthRaw) : 80,
  };
  if (op === 'split' && o.separator === '') {
    return { output: '', error: { message: 'Separator is empty', hint: 'Type the text to split on in the Separator box, e.g. ", " or \\t.' }, status: 'Missing separator' };
  }

  let lines = input.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const before = lines.length;
  if (ctx.options['trimFirst'] === true) lines = lines.map((l) => l.trim());
  const out = applyLineOp(lines, op, o);
  return {
    output: out.join('\n'),
    status: `${OPS.find((x) => x.value === op)!.label} · ${before} line${before === 1 ? '' : 's'} → ${out.length} line${out.length === 1 ? '' : 's'}`,
  };
}

export const linesMode: ToolMode = {
  id: 'lines',
  label: 'Line Tools',
  description: 'Sort, dedupe, number, wrap, shuffle, join or split the lines of any text.',
  category: 'Text',
  icon: 'lines',
  keywords: ['sort', 'dedupe', 'unique', 'shuffle', 'wrap', 'join', 'split', 'number', 'trim', 'reverse'],
  emptyHint: 'Paste lines of text, then pick an operation from the header.',
  sample: 'banana\napple\nfile10.txt\nfile2.txt\napple\n\ncherry\nBanana\n',
  supportsPretty: false,
  controls: [
    { kind: 'select', key: 'op', label: 'Operation', default: 'sort', options: OPS },
    { kind: 'toggle', key: 'caseInsensitive', label: 'Ignore case', default: false },
    { kind: 'toggle', key: 'trimFirst', label: 'Trim first', default: false },
    { kind: 'text', key: 'separator', label: 'Separator', placeholder: ', ', default: ', ' },
    { kind: 'text', key: 'prefix', label: 'Prefix', placeholder: 'prefix', default: '' },
    { kind: 'text', key: 'suffix', label: 'Suffix', placeholder: 'suffix', default: '' },
    { kind: 'text', key: 'width', label: 'Width', placeholder: '80', default: '80' },
    { kind: 'text', key: 'seed', label: 'Shuffle seed', placeholder: '1', default: '1' },
  ],
  run: runLines,
};
