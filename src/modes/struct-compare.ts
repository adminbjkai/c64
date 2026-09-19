/**
 * Shared plumbing for the structural Compare modes (JSON / XML / YAML
 * Compare). Each mode parses its two texts into plain values and hands them
 * here; this module reads the common controls, runs the engine and builds
 * the result: Pretty = readable change report, Raw = RFC 6902 JSON Patch,
 * view = 'struct-diff'.
 */

import { type ModeControl, type ModeResult, type RunContext, toDiagnostic } from './types.js';
import { alignValues, diffValues, formatChanges, normalize, summarize, toJsonPatch, type ArrayMode, type DiffOptions } from '../lib/structural-diff.js';
import type { StructDiffData } from '../views/struct-diff.js';

const splitList = (v: unknown): string[] =>
  typeof v === 'string'
    ? v
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '')
    : [];

export function readDiffOptions(ctx: RunContext, defaults: { trimStrings?: boolean } = {}): DiffOptions {
  const a = ctx.options['arrays'];
  const arrays: ArrayMode = a === 'lcs' || a === 'key' || a === 'set' ? a : 'index';
  const keyFields = splitList(ctx.options['keyFields']);
  return {
    arrays,
    keyFields: keyFields.length > 0 ? keyFields : ['id'],
    caseInsensitive: ctx.options['ignoreCase'] === true,
    trimStrings: typeof ctx.options['trimStrings'] === 'boolean' ? ctx.options['trimStrings'] : defaults.trimStrings === true,
    numericStrings: ctx.options['numericStrings'] === true,
    ignorePaths: splitList(ctx.options['ignorePaths']),
    detectMoves: true,
  };
}

export function compareControls(opts: { trimStrings?: boolean } = {}): ModeControl[] {
  return [
    {
      kind: 'select',
      key: 'arrays',
      label: 'Arrays',
      default: 'index',
      options: [
        { value: 'index', label: 'By index' },
        { value: 'lcs', label: 'Sequence (LCS)' },
        { value: 'key', label: 'By key field' },
        { value: 'set', label: 'As set' },
      ],
    },
    { kind: 'text', key: 'keyFields', label: 'Key fields', placeholder: 'id, name', default: 'id' },
    { kind: 'toggle', key: 'ignoreCase', label: 'Ignore case', default: false },
    { kind: 'toggle', key: 'trimStrings', label: 'Trim strings', default: opts.trimStrings === true },
    { kind: 'toggle', key: 'numericStrings', label: 'Numeric strings', default: false },
    { kind: 'text', key: 'ignorePaths', label: 'Ignore paths', placeholder: '/meta/updatedAt, /items/*/id', default: '' },
    { kind: 'toggle', key: 'onlyChanges', label: 'Only changes', default: true },
  ];
}

/** Both inputs blank → the standard empty result; one blank → an attributed error. Returns null when the caller should proceed. */
export function checkSides(a: string, b: string | undefined, labels: [string, string]): ModeResult | null {
  const bb = b ?? '';
  if (a.trim() === '' && bb.trim() === '') return { output: '', status: '' };
  if (a.trim() === '') return { output: '', error: { message: `${labels[0]}: nothing to compare`, hint: `Paste the ${labels[0].toLowerCase()} document in the first editor` }, status: `${labels[0]} is empty` };
  if (bb.trim() === '') return { output: '', error: { message: `${labels[1]}: nothing to compare`, hint: `Paste the ${labels[1].toLowerCase()} document in the second editor` }, status: `${labels[1]} is empty` };
  return null;
}

/** A parse failure attributed to one side: message prefixed with the side's label, line/col kept. */
export function sideFailure(label: string, what: string, e: unknown): ModeResult {
  const d = toDiagnostic(e);
  d.message = `${label}: ${d.message}`;
  return { output: '', error: d, status: d.line ? `Invalid ${what} in ${label} · line ${d.line}, col ${d.col}` : `Invalid ${what} in ${label}` };
}

export function statusLine(s: ReturnType<typeof summarize>): string {
  const parts = [`${s.changed} changed`, `${s.added} added`, `${s.removed} removed`];
  if (s.typeChanges) parts.push(`${s.typeChanges} type change${s.typeChanges === 1 ? '' : 's'}`);
  if (s.moved) parts.push(`${s.moved} moved`);
  return parts.join(' · ');
}

/** Compare two parsed values and build the full mode result. */
export function compareValues(a: unknown, b: unknown, ctx: RunContext, opts: DiffOptions, labels: [string, string], notes: string[] = []): ModeResult {
  const changes = diffValues(a, b, opts);
  const summary = summarize(changes);
  const patch = toJsonPatch(changes);
  const identical = changes.length === 0;
  const data: StructDiffData = {
    left: normalize(a, opts),
    right: normalize(b, opts),
    changes,
    summary,
    onlyChanges: ctx.options['onlyChanges'] !== false,
    tree: alignValues(a, b, opts),
    labels,
  };
  const allNotes = [...notes];
  if (identical) allNotes.push('Documents are identical' + (opts.ignorePaths && opts.ignorePaths.length ? ' (ignored paths excluded)' : ''));
  return {
    output: ctx.pretty ? (identical ? '' : formatChanges(changes)) : JSON.stringify(patch, null, 2),
    status: identical ? 'Identical' : statusLine(summary),
    notes: allNotes.length ? allNotes : undefined,
    view: { kind: 'struct-diff', data },
  };
}
