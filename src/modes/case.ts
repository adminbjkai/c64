/**
 * Case Converter mode: camelCase, snake_case, kebab-case, Title Case and
 * friends, per line or for the whole input as one identifier. The view lists
 * every variant of the first line at once with copy buttons.
 */

import { type ToolMode, type ModeResult, type RunContext } from './types.js';
import { convertCase, CASE_STYLES, type CaseStyle } from '../lib/case.js';

export interface CaseAllData {
  source: string;
  variants: { name: string; value: string }[];
}

function styleOption(v: unknown): CaseStyle {
  return CASE_STYLES.some((s) => s.value === v) ? (v as CaseStyle) : 'camel';
}

export function runCase(input: string, ctx: RunContext): ModeResult {
  if (input.trim() === '') return { output: '', status: '' };
  const style = styleOption(ctx.options['to']);
  const perLine = ctx.options['perLine'] !== false;
  const label = CASE_STYLES.find((s) => s.value === style)!.label;

  let output: string;
  let source: string;
  let status: string;
  if (perLine) {
    const lines = input.split(/\r?\n/);
    output = lines.map((l) => (l.trim() === '' ? l : convertCase(l, style))).join('\n');
    source = lines.find((l) => l.trim() !== '') ?? '';
    const n = lines.filter((l) => l.trim() !== '').length;
    status = `${label} · ${n} line${n === 1 ? '' : 's'}`;
  } else {
    output = convertCase(input, style);
    source = input;
    status = `${label} · whole input as one identifier`;
  }
  const data: CaseAllData = { source, variants: CASE_STYLES.map((s) => ({ name: s.label, value: convertCase(source, s.value) })) };
  return { output, status, view: { kind: 'case-all', data } };
}

export const caseMode: ToolMode = {
  id: 'case',
  label: 'Case Converter',
  description: 'Convert identifiers and text between camelCase, snake_case, kebab-case, Title Case and more.',
  category: 'Text',
  icon: 'textCase',
  keywords: ['camel', 'snake', 'kebab', 'pascal', 'title', 'uppercase', 'lowercase', 'identifier'],
  emptyHint: 'Paste identifiers or text, one per line — every variant is shown in the output panel.',
  sample: 'userAccountID\nHTTPServerConfig\nparse XML-document v2\nmax_retry_count',
  supportsPretty: false,
  controls: [
    { kind: 'select', key: 'to', label: 'Convert to', default: 'camel', options: CASE_STYLES },
    { kind: 'toggle', key: 'perLine', label: 'Per line', default: true },
  ],
  run: runCase,
};
