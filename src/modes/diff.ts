/**
 * Text Diff mode. The pane has one input, so the two texts are separated by a
 * line containing only `=====` (five or more `=`, configurable). Line mode
 * produces a unified-style listing; word/char mode an inline `[-old-]{+new+}`
 * listing. The view shows a side-by-side or inline rendering.
 */

import { type ToolMode, type ModeResult, type RunContext } from './types.js';
import { diffLines, diffWords, diffChars, diffStats, formatLineDiff, formatInlineDiff, type DiffOp, type DiffOptions } from '../lib/diff.js';

export type DiffGranularity = 'line' | 'word' | 'char';

export interface DiffData {
  granularity: DiffGranularity;
  ops: DiffOp[];
  stats: { added: number; removed: number; equal: number };
}

export const DEFAULT_SEPARATOR = '=====';

/** Split the pane input into [left, right] on the first separator line. Returns null when absent. */
export function splitSides(input: string, separator = DEFAULT_SEPARATOR): [string, string] | null {
  const lines = input.split(/\r\n|\r|\n/);
  const isSep = (l: string) => {
    const t = l.trim();
    if (separator === DEFAULT_SEPARATOR) return /^={5,}$/.test(t);
    return t === separator;
  };
  const idx = lines.findIndex(isSep);
  if (idx < 0) return null;
  return [lines.slice(0, idx).join('\n'), lines.slice(idx + 1).join('\n')];
}

export function runDiff(input: string, ctx: RunContext): ModeResult {
  if (input.trim() === '') return { output: '', status: '' };
  const sepOpt = ctx.options['separator'];
  const separator = typeof sepOpt === 'string' && sepOpt.trim() !== '' ? sepOpt.trim() : DEFAULT_SEPARATOR;
  // Two editors when the pane offers them; the separator line still works for
  // pasted-in-one-box comparisons and old share links.
  const sides = ctx.inputB !== undefined && (ctx.inputB !== '' || !splitSides(input, separator)) ? ([input, ctx.inputB] as [string, string]) : splitSides(input, separator);
  if (!sides) {
    return {
      output: '',
      error: { message: `No separator line (${separator}) found.`, hint: `Put ${separator} on its own line between the two texts` },
      status: 'Missing separator',
    };
  }
  const [a, b] = sides;
  const g = ctx.options['granularity'];
  const granularity: DiffGranularity = g === 'word' || g === 'char' ? g : 'line';
  const opts: DiffOptions = { ignoreWhitespace: ctx.options['ignoreWhitespace'] === true, ignoreCase: ctx.options['ignoreCase'] === true };
  const ops = granularity === 'line' ? diffLines(a, b, opts) : granularity === 'word' ? diffWords(a, b, opts) : diffChars(a, b, opts);
  const stats = diffStats(ops);
  const output = granularity === 'line' ? formatLineDiff(ops) : formatInlineDiff(ops);
  const unit = granularity === 'line' ? 'lines' : granularity === 'word' ? 'runs' : 'runs';
  const identical = stats.added === 0 && stats.removed === 0;
  const data: DiffData = { granularity, ops, stats };
  return {
    output,
    status: `+${stats.added} −${stats.removed} · ${stats.equal} ${unit} equal`,
    notes: identical ? ['Texts are identical'] : undefined,
    view: { kind: 'diff', data },
  };
}

export const diffMode: ToolMode = {
  id: 'diff',
  label: 'Text Diff',
  description: 'Compare two texts by line, word or character with a side-by-side or inline view.',
  category: 'Developer',
  icon: 'diff',
  keywords: ['compare', 'patch', 'myers', 'changes', 'unified'],
  emptyHint: 'Paste the original text in Before and the changed text in After.',
  inputs: 2,
  inputLabels: ['Before', 'After'],
  sample: 'The quick brown fox\njumps over the lazy dog.\nLine three stays.\nThis line is removed.\n',
  sampleB: 'The quick red fox\njumps over the lazy dog.\nLine three stays.\nThis line is new.\n',
  supportsPretty: false,
  controls: [
    {
      kind: 'select',
      key: 'granularity',
      label: 'Granularity',
      default: 'line',
      options: [
        { value: 'line', label: 'Lines' },
        { value: 'word', label: 'Words' },
        { value: 'char', label: 'Characters' },
      ],
    },
    { kind: 'toggle', key: 'ignoreWhitespace', label: 'Ignore whitespace', default: false },
    { kind: 'toggle', key: 'ignoreCase', label: 'Ignore case', default: false },
  ],
  run: runDiff,
};
