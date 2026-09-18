/**
 * JSON Tree View and JSON Path modes. Both parse with source spans so the
 * renderer can select the clicked value in the editor. Path mode adds a
 * live JSONPath query (src/lib/jsonpath.ts).
 *
 * `output` carries the formatted JSON so Copy still yields text.
 */

import { type ToolMode, type ModeResult, type RunContext, failure, formatBytes, byteLength } from './types.js';
import { parseJsonWithSpans, describeShape } from './json.js';
import { queryJsonPath, JsonPathError } from '../lib/jsonpath.js';
import type { TreeData } from '../views/json-tree.js';

const SAMPLE = JSON.stringify(
  {
    order: { id: 'A-1042', placed: '2026-09-16T14:02:00Z', total: 149.5, paid: true },
    customer: { name: 'Ada', email: 'ada@example.com', tags: ['vip', 'newsletter'] },
    items: [
      { sku: 'K-1', name: 'Keyboard', qty: 1, price: 99.5 },
      { sku: 'M-2', name: 'Mouse', qty: 2, price: 25 },
    ],
    notes: null,
  },
  null,
  2,
);

function parseForTree(input: string): { data: TreeData; notes: string[] } {
  const { value, notes, spans } = parseJsonWithSpans(input);
  return { data: { value, spans }, notes };
}

function baseResult(input: string, data: TreeData, notes: string[]): ModeResult {
  const output = JSON.stringify(data.value, null, 2);
  return {
    output,
    notes: notes.length ? notes : undefined,
    status: `Valid JSON · ${describeShape(data.value)} · ${formatBytes(byteLength(input))}`,
  };
}

export function runJsonTree(input: string, _ctx: RunContext): ModeResult {
  if (input.trim() === '') return { output: '', status: '' };
  try {
    const { data, notes } = parseForTree(input);
    return { ...baseResult(input, data, notes), view: { kind: 'json-tree', data } };
  } catch (e) {
    return failure('JSON', e);
  }
}

export function runJsonPath(input: string, ctx: RunContext): ModeResult {
  if (input.trim() === '') return { output: '', status: '' };
  try {
    const { data, notes } = parseForTree(input);
    const query = typeof ctx.options['query'] === 'string' ? (ctx.options['query'] as string) : '';
    let matches: { path: (string | number)[]; value: unknown }[] = [];
    let queryError: string | undefined;
    if (query.trim()) {
      try {
        matches = queryJsonPath(data.value, query);
      } catch (e) {
        queryError = e instanceof JsonPathError ? `${e.message}${e.hint ? ` — ${e.hint}` : ''}` : (e as Error).message;
      }
    }
    const selected = Array.isArray(ctx.options['selectedPath']) ? (ctx.options['selectedPath'] as (string | number)[]) : undefined;
    data.path = { query, matches, queryError, selected };
    const base = baseResult(input, data, notes);
    // Copy gives the query results when there is a query, else the document.
    const output = query.trim() && !queryError ? JSON.stringify(matches.map((m) => m.value), null, 2) : base.output;
    const status = query.trim() && !queryError ? `${matches.length} match${matches.length === 1 ? '' : 'es'} · ${base.status}` : base.status;
    return { ...base, output, status, view: { kind: 'json-path', data } };
  } catch (e) {
    return failure('JSON', e);
  }
}

export const jsonTreeMode: ToolMode = {
  id: 'json-tree',
  label: 'JSON Tree View',
  description: 'Explore nested JSON as a collapsible tree; copy any value or its path.',
  category: 'JSON',
  icon: 'tree',
  emptyHint: 'Paste JSON to explore it as a collapsible tree. Click a node to select it in the editor.',
  sample: SAMPLE,
  supportsPretty: false,
  controls: [],
  run: runJsonTree,
};

export const jsonPathMode: ToolMode = {
  id: 'json-path',
  label: 'JSON Path',
  description: 'Click a value to get its JSONPath, or run live queries like $..name.',
  category: 'JSON',
  icon: 'path',
  emptyHint: 'Paste JSON, click any value to get its path, or type a JSONPath query like $..name',
  sample: SAMPLE,
  supportsPretty: false,
  controls: [{ kind: 'text', key: 'query', label: 'JSONPath query', placeholder: '$.items[*].name', default: '' }],
  run: runJsonPath,
};
