/**
 * Math Evaluator mode: one expression per line, variables carry forward,
 * `ans` is the previous result. Pretty = `expr = result` per line, Raw =
 * results only. A bad line reports its error (line, col, hint) without
 * stopping the others.
 */

import { type ToolMode, type ModeResult, type RunContext } from './types.js';
import { evaluateLines, formatValue, type NumberFormat, type Value } from '../lib/math.js';

const FORMATS: NumberFormat[] = ['auto', 'fixed2', 'scientific', 'hex', 'binary'];

export function runMathEval(input: string, ctx: RunContext): ModeResult {
  if (input.trim() === '') return { output: '', status: '' };
  const fmtOpt = ctx.options['format'];
  const format: NumberFormat = FORMATS.includes(fmtOpt as NumberFormat) ? (fmtOpt as NumberFormat) : 'auto';
  const results = evaluateLines(input);
  if (results.length === 0) return { output: '', status: 'Only comments' };

  const lines: string[] = [];
  let firstError: ModeResult['error'];
  let errors = 0;
  let total: Value = 0n;
  let exact = true;
  for (const r of results) {
    if (r.error) {
      errors++;
      lines.push(ctx.pretty ? `${r.source} = ✗ ${r.error.message}` : `✗ ${r.error.message}`);
      if (!firstError) firstError = { message: r.error.message, line: r.line, col: r.error.col, hint: r.error.hint };
      continue;
    }
    const v = r.value as Value;
    const shown = formatValue(v, format);
    lines.push(ctx.pretty ? `${r.name ? `${r.name} = ` : `${r.source} = `}${shown}` : shown);
    if (typeof v === 'bigint' && typeof total === 'bigint') total += v;
    else { total = Number(total) + Number(v); exact = false; }
  }
  const ok = results.length - errors;
  const notes: string[] = [];
  if (ok > 1) notes.push(`Total of all results: ${formatValue(total, format)}${exact ? ' (exact)' : ''}`);
  if (results.some((r) => r.value !== undefined && typeof r.value === 'bigint')) notes.push('Integer-only lines are computed exactly with BigInt.');
  return {
    output: lines.join('\n'),
    error: firstError,
    notes: notes.length ? notes : undefined,
    status: `${results.length} expression${results.length === 1 ? '' : 's'}${errors ? ` · ${errors} error${errors === 1 ? '' : 's'}` : ''} · ${format}`,
  };
}

export const mathEvalMode: ToolMode = {
  id: 'math-eval',
  label: 'Math Evaluator',
  description: 'Evaluate arithmetic expressions line by line with functions, variables, percentages and exact big integers.',
  category: 'Developer',
  icon: 'math',
  keywords: ['math', 'calculator', 'calc', 'expression', 'evaluate', 'arithmetic', 'bigint', 'factorial', 'hex', 'binary'],
  emptyHint: 'One expression per line, e.g. "2^100", "x = sqrt(2) * 3", "ans * 15%", "0xff + 0b1010", "fact(30)". Use # for comments.',
  sample: '# variables carry forward\nprice = 199.99\ntax = price * 8.25%\nprice + tax\nround(ans, 2)\n\n# exact big integers\n2^100\nfact(25)\ngcd(1071, 462)\n\n# mixed radix and functions\n0xff + 0b1010 + 0o17\nhypot(3, 4) + sqrt(16)\nmax(1, 2, 3) * min(4, 5)',
  supportsPretty: true,
  controls: [
    {
      kind: 'select',
      key: 'format',
      label: 'Format',
      default: 'auto',
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'fixed2', label: 'Fixed (2 dp)' },
        { value: 'scientific', label: 'Scientific' },
        { value: 'hex', label: 'Hex' },
        { value: 'binary', label: 'Binary' },
      ],
    },
  ],
  run: runMathEval,
};
