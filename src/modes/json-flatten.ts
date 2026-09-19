/**
 * JSON Flatten / Unflatten mode: nested JSON ↔ single-level { path: leaf }.
 * Pretty = 2-space, Raw = minified. Auto direction unflattens when the input
 * is already a flat map of path-like keys.
 */

import { type ToolMode, type ModeResult, type RunContext, failure } from './types.js';
import { parseJson } from './json.js';
import { flatten, unflatten, looksFlattened, type FlattenStyle } from '../lib/json-flatten.js';

function styleOption(v: unknown): FlattenStyle {
  return v === 'bracket' || v === 'slash' ? v : 'dot';
}

export function runJsonFlatten(input: string, ctx: RunContext): ModeResult {
  if (input.trim() === '') return { output: '', status: '' };
  let value: unknown;
  let notes: string[];
  try {
    ({ value, notes } = parseJson(input));
  } catch (e) {
    return failure('JSON', e);
  }
  const dirOpt = ctx.options['direction'];
  const direction = dirOpt === 'flatten' || dirOpt === 'unflatten' ? dirOpt : looksFlattened(value) ? 'unflatten' : 'flatten';
  const style = styleOption(ctx.options['style']);
  const delimiter = typeof ctx.options['delimiter'] === 'string' && ctx.options['delimiter'] !== '' ? ctx.options['delimiter'] : '.';
  const arraysAsIndex = ctx.options['arraysAsIndex'] !== false;
  const rebuildArrays = ctx.options['rebuildArrays'] !== false;

  let result: unknown;
  let status: string;
  if (direction === 'flatten') {
    const flat = flatten(value, { style, delimiter, arraysAsIndex });
    const n = Object.keys(flat).length;
    result = flat;
    status = `flattened · ${n} key${n === 1 ? '' : 's'} · ${style}`;
  } else {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { output: '', error: { message: 'Unflatten needs an object whose keys are paths, e.g. {"a.b": 1}.', hint: 'Switch Direction to "flatten" to flatten this value instead.' }, status: 'Cannot unflatten' };
    }
    result = unflatten(value as Record<string, unknown>, { style, delimiter, rebuildArrays });
    const n = typeof result === 'object' && result !== null ? Object.keys(result).length : 0;
    status = `unflattened · ${n} top-level ${Array.isArray(result) ? 'item' : 'key'}${n === 1 ? '' : 's'} · ${style}`;
  }
  if (dirOpt !== 'flatten' && dirOpt !== 'unflatten') notes.push(`Auto-detected: ${direction}.`);
  return {
    output: ctx.pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result),
    status,
    notes: notes.length ? notes : undefined,
  };
}

export const jsonFlattenMode: ToolMode = {
  id: 'json-flatten',
  label: 'JSON Flatten / Unflatten',
  description: 'Flatten nested JSON into dotted-path keys (or JSON Pointers) and rebuild the nesting again.',
  category: 'JSON',
  icon: 'flatten',
  keywords: ['flatten', 'unflatten', 'dot notation', 'path', 'pointer', 'nested', 'expand'],
  emptyHint: 'Paste nested JSON to flatten it to path keys, or a flat {"a.b[0]": …} map to rebuild the nesting.',
  sample: '{"user":{"name":"Ada","tags":["math","code"],"address":{"city":"London","geo":{"lat":51.5,"lng":-0.12}}},"empty":{},"none":[]}',
  supportsPretty: true,
  controls: [
    {
      kind: 'select',
      key: 'direction',
      label: 'Direction',
      default: 'auto',
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'flatten', label: 'Flatten' },
        { value: 'unflatten', label: 'Unflatten' },
      ],
    },
    {
      kind: 'select',
      key: 'style',
      label: 'Style',
      default: 'dot',
      options: [
        { value: 'dot', label: 'a.b[0].c' },
        { value: 'bracket', label: 'a[b][0][c]' },
        { value: 'slash', label: '/a/b/0/c' },
      ],
    },
    { kind: 'text', key: 'delimiter', label: 'Delimiter', placeholder: '.', default: '.' },
    { kind: 'toggle', key: 'arraysAsIndex', label: 'Arrays as [0]', default: true },
    { kind: 'toggle', key: 'rebuildArrays', label: 'Rebuild arrays', default: true },
  ],
  run: runJsonFlatten,
};
