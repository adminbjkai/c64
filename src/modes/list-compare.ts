/**
 * List Compare mode: set operations on two line lists (one item per line).
 * Items are trimmed and de-duplicated by default; `ignoreCase` folds case for
 * matching while keeping the first spelling seen. Output is either every set
 * under a heading (`## Only in A (3)` …) or just the lines of one set.
 */

import { type ToolMode, type ModeResult, type RunContext } from './types.js';

export type ListShow = 'all' | 'intersection' | 'onlyA' | 'onlyB' | 'union' | 'symmetric';

export interface ListCompareData {
  show: ListShow;
  countA: number;
  countB: number;
  onlyA: string[];
  onlyB: string[];
  common: string[];
  union: string[];
  symmetric: string[];
}

export interface ListCompareOptions {
  ignoreCase?: boolean;
  trim?: boolean;
  unique?: boolean;
}

export function splitItems(text: string, opts: ListCompareOptions): string[] {
  const lines = text.split(/\r\n|\r|\n/).map((l) => (opts.trim !== false ? l.trim() : l));
  const items = lines.filter((l) => l !== '');
  if (opts.unique === false) return items;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    const k = opts.ignoreCase ? it.toLowerCase() : it;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

export function compareLists(a: string[], b: string[], opts: ListCompareOptions): Omit<ListCompareData, 'show'> {
  const key = (s: string) => (opts.ignoreCase ? s.toLowerCase() : s);
  const setA = new Set(a.map(key));
  const setB = new Set(b.map(key));
  const onlyA = a.filter((x) => !setB.has(key(x)));
  const onlyB = b.filter((x) => !setA.has(key(x)));
  const common = a.filter((x) => setB.has(key(x)));
  return { countA: a.length, countB: b.length, onlyA, onlyB, common, union: [...a, ...onlyB], symmetric: [...onlyA, ...onlyB] };
}

const SECTIONS: { key: keyof Omit<ListCompareData, 'show' | 'countA' | 'countB'>; title: string; show: ListShow }[] = [
  { key: 'common', title: 'In both', show: 'intersection' },
  { key: 'onlyA', title: 'Only in A', show: 'onlyA' },
  { key: 'onlyB', title: 'Only in B', show: 'onlyB' },
  { key: 'union', title: 'Union', show: 'union' },
  { key: 'symmetric', title: 'Symmetric difference', show: 'symmetric' },
];

export function runListCompare(input: string, ctx: RunContext): ModeResult {
  const textB = ctx.inputB ?? '';
  if (input.trim() === '' && textB.trim() === '') return { output: '', status: '' };
  const opts: ListCompareOptions = {
    ignoreCase: ctx.options['ignoreCase'] === true,
    trim: ctx.options['trim'] !== false,
    unique: ctx.options['unique'] !== false,
  };
  const s = ctx.options['show'];
  const show: ListShow = s === 'intersection' || s === 'onlyA' || s === 'onlyB' || s === 'union' || s === 'symmetric' ? s : 'all';
  const a = splitItems(input, opts);
  const b = splitItems(textB, opts);
  const data: ListCompareData = { show, ...compareLists(a, b, opts) };
  let output: string;
  if (show === 'all') {
    output = SECTIONS.filter((sec) => sec.show !== 'union' && sec.show !== 'symmetric')
      .map((sec) => `## ${sec.title} (${data[sec.key].length})\n${data[sec.key].join('\n')}`)
      .join('\n\n');
  } else {
    output = data[SECTIONS.find((sec) => sec.show === show)!.key].join('\n');
  }
  return {
    output,
    status: `A ${data.countA} · B ${data.countB} · common ${data.common.length}`,
    view: { kind: 'list-compare', data },
  };
}

export const listCompareMode: ToolMode = {
  id: 'list-compare',
  label: 'List Compare',
  description: 'Compare two line lists: items in both, only in A, only in B, union and symmetric difference.',
  category: 'Compare',
  icon: 'lines',
  keywords: ['set', 'intersection', 'difference', 'union', 'unique', 'lines', 'venn'],
  emptyHint: 'Paste one item per line in List A and List B.',
  inputs: 2,
  inputLabels: ['List A', 'List B'],
  sample: 'apple\nbanana\ncherry\ndate\nelderberry\nfig\napple\n',
  sampleB: 'banana\nCherry\ndate\ngrape\nkiwi\n  fig  \n',
  supportsPretty: false,
  controls: [
    {
      kind: 'select',
      key: 'show',
      label: 'Show',
      default: 'all',
      options: [
        { value: 'all', label: 'All sets' },
        { value: 'intersection', label: 'In both' },
        { value: 'onlyA', label: 'Only in A' },
        { value: 'onlyB', label: 'Only in B' },
        { value: 'union', label: 'Union' },
        { value: 'symmetric', label: 'Symmetric difference' },
      ],
    },
    { kind: 'toggle', key: 'ignoreCase', label: 'Ignore case', default: false },
    { kind: 'toggle', key: 'trim', label: 'Trim', default: true },
    { kind: 'toggle', key: 'unique', label: 'Unique', default: true },
  ],
  run: runListCompare,
};
