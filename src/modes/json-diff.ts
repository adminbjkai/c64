/**
 * JSON Compare mode: structural diff of two JSON documents.
 * Pretty = readable change report, Raw = RFC 6902 JSON Patch (Original → Changed).
 */

import { type ToolMode, type ModeResult, type RunContext } from './types.js';
import { parseJson } from './json.js';
import { checkSides, compareControls, compareValues, readDiffOptions, sideFailure } from './struct-compare.js';

const LABELS: [string, string] = ['Original', 'Changed'];

export function runJsonDiff(input: string, ctx: RunContext): ModeResult {
  const early = checkSides(input, ctx.inputB, LABELS);
  if (early) return early;
  const notes: string[] = [];
  let a: unknown;
  let b: unknown;
  try {
    const r = parseJson(input);
    a = r.value;
    notes.push(...r.notes.map((n) => `${LABELS[0]}: ${n}`));
  } catch (e) {
    return sideFailure(LABELS[0], 'JSON', e);
  }
  try {
    const r = parseJson(ctx.inputB ?? '');
    b = r.value;
    notes.push(...r.notes.map((n) => `${LABELS[1]}: ${n}`));
  } catch (e) {
    return sideFailure(LABELS[1], 'JSON', e);
  }
  return compareValues(a, b, ctx, readDiffOptions(ctx), LABELS, notes);
}

export const jsonDiffMode: ToolMode = {
  id: 'json-diff',
  label: 'JSON Compare',
  description: 'Compare two JSON documents structurally and produce a change report or JSON Patch.',
  category: 'Compare',
  icon: 'compare',
  keywords: ['diff', 'json patch', 'rfc 6902', 'structural', 'semantic', 'compare objects'],
  emptyHint: 'Paste the original JSON in Original and the new version in Changed.',
  inputs: 2,
  inputLabels: LABELS,
  sample: JSON.stringify(
    {
      id: 42,
      name: 'Widget',
      price: '9.99',
      tags: ['a', 'b', 'c'],
      stock: { warehouse: 12, shop: 3 },
      legacy: true,
    },
    null,
    2,
  ),
  sampleB: JSON.stringify(
    {
      id: 42,
      name: 'Widget Pro',
      price: 9.99,
      tags: ['a', 'c', 'd'],
      stock: { warehouse: 10, shop: 3, online: 7 },
      sku: 'W-42',
    },
    null,
    2,
  ),
  supportsPretty: true,
  outputLanguage: (ctx) => (ctx.pretty ? undefined : 'json'),
  controls: compareControls(),
  run: runJsonDiff,
};
