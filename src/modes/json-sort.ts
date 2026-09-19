/**
 * JSON Sort & Normalise mode: deep-sort object keys (asc / desc / natural /
 * by length), optionally sort and dedupe arrays, drop nulls and empties,
 * and round or truncate numbers. Pretty = indented, Raw = minified.
 */

import { type ToolMode, type ModeResult, type RunContext, failure } from './types.js';
import { parseJson, indentString } from './json.js';

export type KeyOrder = 'asc' | 'desc' | 'natural' | 'length';

export interface NormaliseOptions {
  order?: KeyOrder;
  sortArrays?: boolean;
  /** Sort arrays of objects by this key (when every element is an object with it). */
  arrayKey?: string;
  dropNulls?: boolean;
  dropEmpty?: boolean;
  dedupeArrays?: boolean;
  numbers?: 'keep' | 'round2' | 'integers';
}

export interface NormaliseStats {
  keys: number;
  arrays: number;
  dropped: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function keyComparator(order: KeyOrder): (a: string, b: string) => number {
  switch (order) {
    case 'desc':
      return (a, b) => (a < b ? 1 : a > b ? -1 : 0);
    case 'natural':
      return (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0);
    case 'length':
      return (a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
    default:
      return (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  }
}

function isEmpty(v: unknown): boolean {
  if (v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (isObj(v)) return Object.keys(v).length === 0;
  return false;
}

/** Canonical string for dedupe (keys already sorted by the time this runs). */
const canon = (v: unknown) => JSON.stringify(v);

function primitiveCompare(order: KeyOrder): (a: unknown, b: unknown) => number {
  const byKey = keyComparator(order);
  return (a, b) => {
    if (typeof a === 'number' && typeof b === 'number') return order === 'desc' ? b - a : a - b;
    if (typeof a === 'number' && typeof b !== 'number') return -1;
    if (typeof b === 'number' && typeof a !== 'number') return 1;
    return byKey(String(a), String(b));
  };
}

export function normaliseJson(value: unknown, opts: NormaliseOptions = {}): { value: unknown; stats: NormaliseStats } {
  const stats: NormaliseStats = { keys: 0, arrays: 0, dropped: 0 };
  const order = opts.order ?? 'asc';
  const cmpKeys = keyComparator(order);
  const cmpPrim = primitiveCompare(order);
  const arrayKey = opts.arrayKey?.trim() || '';
  const walk = (v: unknown): unknown => {
    if (typeof v === 'number') {
      if (opts.numbers === 'round2') return Math.round(v * 100) / 100;
      if (opts.numbers === 'integers') return Math.trunc(v);
      return v;
    }
    if (Array.isArray(v)) {
      stats.arrays++;
      let items = v.map(walk);
      const before = items.length;
      if (opts.dropNulls) items = items.filter((x) => x !== null);
      if (opts.dropEmpty) items = items.filter((x) => !isEmpty(x));
      stats.dropped += before - items.length;
      if (opts.sortArrays) {
        const allPrim = items.every((x) => x === null || typeof x !== 'object');
        if (allPrim) items = items.map((x, i) => ({ x, i })).sort((a, b) => cmpPrim(a.x, b.x) || a.i - b.i).map((p) => p.x);
        else if (arrayKey && items.every((x) => isObj(x) && arrayKey in x)) {
          items = items
            .map((x, i) => ({ x, i }))
            .sort((a, b) => cmpPrim((a.x as Record<string, unknown>)[arrayKey], (b.x as Record<string, unknown>)[arrayKey]) || a.i - b.i)
            .map((p) => p.x);
        }
      }
      if (opts.dedupeArrays) {
        const seen = new Set<string>();
        const n = items.length;
        items = items.filter((x) => {
          const c = canon(x);
          if (seen.has(c)) return false;
          seen.add(c);
          return true;
        });
        stats.dropped += n - items.length;
      }
      return items;
    }
    if (isObj(v)) {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort(cmpKeys)) {
        const item = walk(v[k]);
        if ((opts.dropNulls && item === null) || (opts.dropEmpty && isEmpty(item))) {
          stats.dropped++;
          continue;
        }
        stats.keys++;
        out[k] = item;
      }
      return out;
    }
    return v;
  };
  return { value: walk(value), stats };
}

export function runJsonSort(input: string, ctx: RunContext): ModeResult {
  if (input.trim() === '') return { output: '', status: '' };
  try {
    const { value, notes } = parseJson(input);
    const orderOpt = ctx.options['order'];
    const numOpt = ctx.options['numbers'];
    const { value: sorted, stats } = normaliseJson(value, {
      order: orderOpt === 'desc' || orderOpt === 'natural' || orderOpt === 'length' ? orderOpt : 'asc',
      sortArrays: ctx.options['sortArrays'] === true,
      arrayKey: typeof ctx.options['arrayKey'] === 'string' ? ctx.options['arrayKey'] : '',
      dropNulls: ctx.options['dropNulls'] === true,
      dropEmpty: ctx.options['dropEmpty'] === true,
      dedupeArrays: ctx.options['dedupeArrays'] === true,
      numbers: numOpt === 'round2' || numOpt === 'integers' ? numOpt : 'keep',
    });
    const output = ctx.pretty ? JSON.stringify(sorted, null, indentString(ctx.options['indent'])) : JSON.stringify(sorted);
    const parts = ['sorted', `${stats.keys} key${stats.keys === 1 ? '' : 's'}`, `${stats.arrays} array${stats.arrays === 1 ? '' : 's'}`];
    if (stats.dropped) parts.push(`${stats.dropped} dropped`);
    return { output, status: parts.join(' · '), notes: notes.length ? notes : undefined };
  } catch (e) {
    return failure('JSON', e);
  }
}

export const jsonSortMode: ToolMode = {
  id: 'json-sort',
  label: 'JSON Sort & Normalise',
  description: 'Deep-sort object keys, sort and dedupe arrays, drop nulls and empties, and round numbers for stable comparisons.',
  category: 'JSON',
  icon: 'sortAz',
  keywords: ['sort', 'normalize', 'normalise', 'canonical', 'keys', 'dedupe', 'clean', 'stable'],
  emptyHint: 'Paste JSON to sort its keys deeply and normalise it for diffing or hashing.',
  sample: '{"zeta":[3,1,2,1],"alpha":{"k10":null,"k2":"","k1":1.005},"items":[{"id":"b","n":2},{"id":"a","n":1}],"empty":{},"tags":["b","a","b"]}',
  supportsPretty: true,
  controls: [
    {
      kind: 'select',
      key: 'order',
      label: 'Key order',
      default: 'asc',
      options: [
        { value: 'asc', label: 'A → Z' },
        { value: 'desc', label: 'Z → A' },
        { value: 'natural', label: 'Natural (k2 < k10)' },
        { value: 'length', label: 'By length' },
      ],
    },
    { kind: 'toggle', key: 'sortArrays', label: 'Sort arrays', default: false },
    { kind: 'text', key: 'arrayKey', label: 'Array key', placeholder: 'id', default: '' },
    { kind: 'toggle', key: 'dedupeArrays', label: 'Dedupe arrays', default: false },
    { kind: 'toggle', key: 'dropNulls', label: 'Drop nulls', default: false },
    { kind: 'toggle', key: 'dropEmpty', label: 'Drop empty', default: false },
    {
      kind: 'select',
      key: 'numbers',
      label: 'Numbers',
      default: 'keep',
      options: [
        { value: 'keep', label: 'Keep numbers' },
        { value: 'round2', label: 'Round to 2 dp' },
        { value: 'integers', label: 'Truncate to integers' },
      ],
    },
    {
      kind: 'select',
      key: 'indent',
      label: 'Indent',
      default: '2',
      options: [
        { value: '2', label: '2 spaces' },
        { value: '4', label: '4 spaces' },
        { value: 'tab', label: 'Tab' },
      ],
    },
  ],
  run: runJsonSort,
};
