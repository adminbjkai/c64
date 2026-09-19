/**
 * JSON → Table mode: an array of objects (or object of objects, or NDJSON)
 * becomes a table. Nested values are flattened to `a.b` / `arr[0]` columns.
 * Pretty = table view; the text output is CSV / TSV / Markdown / JSON.
 */

import { type ToolMode, type ModeResult, type RunContext, failure } from './types.js';
import { parseJson } from './json.js';
import { flatten } from '../lib/json-flatten.js';
import { stringifyCsv } from '../lib/csv.js';
import { TABLE_ROW_CAP, type TableData } from './csv.js';

const FLATTEN_DEPTH = 5;

type Row = Record<string, unknown>;
const isObj = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Parse JSON or NDJSON and return the records plus notes about what was done. */
export function toRecords(text: string): { records: Row[]; notes: string[] } {
  const notes: string[] = [];
  let value: unknown;
  try {
    ({ value } = parseJson(text));
  } catch (e) {
    // NDJSON: one JSON object per non-empty line.
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length > 1 && lines.every((l) => l.trim().startsWith('{'))) {
      const records = lines.map((l) => JSON.parse(l) as unknown);
      if (records.every(isObj)) {
        notes.push(`Parsed ${records.length} NDJSON lines.`);
        return { records: records as Row[], notes };
      }
    }
    throw e;
  }
  if (isObj(value)) {
    const obj = value;
    const keys = Object.keys(obj);
    const arrayKeys = keys.filter((k) => Array.isArray(obj[k]));
    if (arrayKeys.length === 1) {
      notes.push(`Using the "${arrayKeys[0]}" array of the top-level object.`);
      value = obj[arrayKeys[0]!];
    } else if (keys.length > 0 && keys.every((k) => isObj(obj[k]))) {
      notes.push('Object of objects: keys are in the "_key" column.');
      return { records: keys.map((k) => ({ _key: k, ...(obj[k] as Row) })), notes };
    } else {
      return { records: [obj], notes };
    }
  }
  if (!Array.isArray(value)) throw new Error(`Expected an array of objects, got ${value === null ? 'null' : typeof value}.`);
  const records = value.map((item, i) => {
    if (isObj(item)) return item;
    if (Array.isArray(item)) return Object.fromEntries(item.map((c, j) => [String(j), c]));
    return { value: item };
  });
  if (records.length && value.some((it) => !isObj(it))) notes.push(`Row ${value.findIndex((it) => !isObj(it)) + 1} is not an object; primitives go in a "value" column, arrays in numbered columns.`);
  return { records, notes };
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function compareCells(a: string, b: string): number {
  const na = a.trim() === '' ? NaN : Number(a);
  const nb = b.trim() === '' ? NaN : Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  if (a === '' && b !== '') return 1;
  if (b === '' && a !== '') return -1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export function toMarkdownTable(header: string[], rows: string[][]): string {
  const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const line = (cells: string[]) => `| ${cells.map(esc).join(' | ')} |`;
  return [line(header), `| ${header.map(() => '---').join(' | ')} |`, ...rows.map((r) => line(header.map((_, i) => r[i] ?? '')))].join('\n');
}

export function runJsonTable(input: string, ctx: RunContext): ModeResult {
  if (input.trim() === '') return { output: '', status: '' };
  let records: Row[];
  let notes: string[];
  try {
    ({ records, notes } = toRecords(input));
  } catch (e) {
    return failure('JSON', e);
  }
  const doFlatten = ctx.options['flatten'] !== false;
  const flat: Row[] = doFlatten ? records.map((r) => flatten(r, { style: 'dot', maxDepth: FLATTEN_DEPTH }) as Row) : records;

  // Columns: union of keys in first-seen order.
  const seen = new Set<string>();
  for (const r of flat) for (const k of Object.keys(r)) seen.add(k);
  let header = [...seen];
  if (ctx.options['sortColumns'] === true) header = header.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  let rows = flat.map((r) => header.map((k) => cellText(r[k])));

  const filter = typeof ctx.options['filter'] === 'string' ? ctx.options['filter'].trim().toLowerCase() : '';
  if (filter) rows = rows.filter((r) => r.some((c) => c.toLowerCase().includes(filter)));

  const sortBy = typeof ctx.options['sortBy'] === 'string' ? ctx.options['sortBy'].trim() : '';
  if (sortBy) {
    const desc = sortBy.startsWith('-');
    const col = desc ? sortBy.slice(1).trim() : sortBy;
    const idx = header.indexOf(col);
    if (idx === -1) notes.push(`Sort column "${col}" not found; columns are ${header.slice(0, 8).join(', ')}${header.length > 8 ? ', …' : ''}.`);
    else {
      rows = rows
        .map((r, i) => ({ r, i }))
        .sort((a, b) => compareCells(a.r[idx] ?? '', b.r[idx] ?? '') * (desc ? -1 : 1) || a.i - b.i)
        .map((x) => x.r);
    }
  }

  const outputFmt = ctx.options['output'];
  let output: string;
  if (outputFmt === 'tsv') output = stringifyCsv({ header, rows }, { delimiter: '\t' });
  else if (outputFmt === 'markdown') output = toMarkdownTable(header, rows);
  else if (outputFmt === 'json') output = JSON.stringify(rows.map((r) => Object.fromEntries(header.map((k, i) => [k, r[i] ?? '']))), null, 2);
  else output = stringifyCsv({ header, rows });

  const status = `${rows.length} row${rows.length === 1 ? '' : 's'} · ${header.length} column${header.length === 1 ? '' : 's'}${filter ? ` · filtered from ${flat.length}` : ''}`;
  const result: ModeResult = { output, status, notes: notes.length ? notes : undefined };
  if (ctx.pretty) {
    const data: TableData = { header, rows: rows.slice(0, TABLE_ROW_CAP), total: rows.length };
    result.view = { kind: 'table', data };
  }
  return result;
}

export const jsonTableMode: ToolMode = {
  id: 'json-table',
  label: 'JSON → Table',
  description: 'Turn an array of JSON objects (or NDJSON) into a sortable, filterable table and export it as CSV, TSV or Markdown.',
  category: 'JSON',
  icon: 'table',
  keywords: ['table', 'grid', 'ndjson', 'csv', 'markdown', 'rows', 'columns', 'records'],
  emptyHint: 'Paste a JSON array of objects, an object of objects or NDJSON — nested keys become a.b / arr[0] columns.',
  sample: '[{"sku":"K-1","name":"Keyboard","qty":1,"price":99.5,"dims":{"w":44,"h":14},"tags":["input","usb"]},{"sku":"M-2","name":"Mouse","qty":2,"price":25,"dims":{"w":6,"h":4}},{"sku":"C-3","name":"Cable","qty":10,"price":7.99,"tags":["usb-c"]}]',
  supportsPretty: true,
  controls: [
    { kind: 'text', key: 'sortBy', label: 'Sort by', placeholder: 'column or -column', default: '' },
    { kind: 'text', key: 'filter', label: 'Filter', placeholder: 'contains…', default: '' },
    {
      kind: 'select',
      key: 'output',
      label: 'Output',
      default: 'csv',
      options: [
        { value: 'csv', label: 'CSV' },
        { value: 'tsv', label: 'TSV' },
        { value: 'markdown', label: 'Markdown' },
        { value: 'json', label: 'JSON rows' },
      ],
    },
    { kind: 'toggle', key: 'flatten', label: 'Flatten nested', default: true },
    { kind: 'toggle', key: 'sortColumns', label: 'Sort columns', default: false },
  ],
  run: runJsonTable,
};
