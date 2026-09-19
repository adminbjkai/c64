/**
 * JSON Patch / Merge Patch mode: applies an RFC 6902 JSON Patch (an array of
 * operations) or an RFC 7386 JSON Merge Patch (an object) to a document.
 * Pretty = the resulting document indented, Raw = minified. Errors name the
 * failing operation index and why it failed. With `showDiff` the view is a
 * structural diff of document → result.
 */

import { type ToolMode, type ModeResult, type RunContext } from './types.js';
import { parseJson } from './json.js';
import { applyJsonPatch, applyMergePatch, JsonPatchError } from '../lib/structural-diff.js';
import { compareValues, sideFailure } from './struct-compare.js';

const LABELS: [string, string] = ['Document', 'Patch'];

export function runJsonPatch(input: string, ctx: RunContext): ModeResult {
  const patchText = ctx.inputB ?? '';
  if (input.trim() === '' && patchText.trim() === '') return { output: '', status: '' };
  let doc: unknown;
  let patch: unknown;
  const notes: string[] = [];
  try {
    const r = parseJson(input.trim() === '' ? 'null' : input);
    doc = r.value;
    notes.push(...r.notes.map((n) => `${LABELS[0]}: ${n}`));
  } catch (e) {
    return sideFailure(LABELS[0], 'JSON', e);
  }
  if (patchText.trim() === '') {
    return { output: '', error: { message: 'Patch: nothing to apply', hint: 'Paste a JSON Patch array or a Merge Patch object in the second editor' }, status: 'Patch is empty' };
  }
  try {
    const r = parseJson(patchText);
    patch = r.value;
    notes.push(...r.notes.map((n) => `${LABELS[1]}: ${n}`));
  } catch (e) {
    return sideFailure(LABELS[1], 'JSON', e);
  }

  const f = ctx.options['format'];
  const format = f === 'json-patch' || f === 'merge-patch' ? f : Array.isArray(patch) ? 'json-patch' : 'merge-patch';
  let result: unknown;
  let status: string;
  if (format === 'json-patch') {
    if (!Array.isArray(patch)) {
      return { output: '', error: { message: 'Patch: a JSON Patch must be an array of operations', hint: 'Switch Format to Merge Patch to apply an object, or wrap the operations in [ ]' }, status: 'Invalid JSON Patch' };
    }
    try {
      result = applyJsonPatch(doc, patch);
    } catch (e) {
      const err = e as JsonPatchError;
      return { output: '', error: { message: err.message, hint: err.hint }, status: err.index >= 0 ? `Failed at op ${err.index}` : 'Invalid JSON Patch' };
    }
    const counts = new Map<string, number>();
    for (const op of patch as { op?: unknown }[]) {
      const name = typeof op.op === 'string' ? op.op : '?';
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const n = patch.length;
    status = [`${n} op${n === 1 ? '' : 's'} applied`, ...Array.from(counts, ([k, v]) => `${v} ${k}`)].join(' · ');
  } else {
    if (Array.isArray(patch)) notes.push('Patch: an array Merge Patch replaces the whole document (RFC 7386)');
    result = applyMergePatch(doc, patch);
    const keys = patch !== null && typeof patch === 'object' && !Array.isArray(patch) ? Object.keys(patch).length : 0;
    status = `Merge patch applied · ${keys} top-level key${keys === 1 ? '' : 's'}`;
  }
  const output = result === undefined ? '' : ctx.pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result);
  const base: ModeResult = { output, status, notes: notes.length ? notes : undefined };
  if (ctx.options['showDiff'] === true) {
    const cmp = compareValues(doc, result, { ...ctx, options: { ...ctx.options, arrays: 'index' } }, { arrays: 'index', detectMoves: true }, ['Document', 'Result']);
    base.view = cmp.view;
  }
  return base;
}

export const jsonPatchMode: ToolMode = {
  id: 'json-patch',
  label: 'JSON Patch / Merge Patch',
  description: 'Apply an RFC 6902 JSON Patch or RFC 7386 Merge Patch to a document and see the result.',
  category: 'Compare',
  icon: 'patch',
  keywords: ['rfc 6902', 'rfc 7386', 'apply', 'patch', 'merge', 'operations'],
  emptyHint: 'Paste the JSON document in Document and a JSON Patch array (or Merge Patch object) in Patch.',
  inputs: 2,
  inputLabels: LABELS,
  sample: JSON.stringify({ name: 'Widget', price: 9.99, tags: ['a', 'b'], stock: { shop: 3 } }, null, 2),
  sampleB: JSON.stringify(
    [
      { op: 'test', path: '/name', value: 'Widget' },
      { op: 'replace', path: '/name', value: 'Widget Pro' },
      { op: 'add', path: '/tags/-', value: 'c' },
      { op: 'move', from: '/tags/0', path: '/tags/-' },
      { op: 'add', path: '/stock/online', value: 7 },
      { op: 'copy', from: '/price', path: '/stock/price' },
      { op: 'remove', path: '/stock/shop' },
    ],
    null,
    2,
  ),
  supportsPretty: true,
  outputLanguage: 'json',
  controls: [
    {
      kind: 'select',
      key: 'format',
      label: 'Format',
      default: 'auto',
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'json-patch', label: 'JSON Patch' },
        { value: 'merge-patch', label: 'Merge Patch' },
      ],
    },
    { kind: 'toggle', key: 'showDiff', label: 'Show diff', default: false },
  ],
  run: runJsonPatch,
};
