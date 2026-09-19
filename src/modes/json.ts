/**
 * JSON Format / Validate mode.
 *
 * Pretty  → indented (2 / 4 / tab), optional sorted keys.
 * Raw     → minified on one line.
 *
 * Parsing strategy: native JSON.parse first (fast, handles multi-MB input in
 * milliseconds). Only when that throws do we run the tolerant parser, which
 * either rescues the input (trailing commas, smart quotes, …) and says what it
 * fixed, or fails with an exact line/column and a plain-English hint.
 */

import { type ToolMode, type ModeResult, type RunContext, formatBytes, byteLength } from './types.js';
import { parseTolerant, JsonParseError } from './json-parse.js';

export type IndentChoice = '2' | '4' | 'tab';

export function indentString(choice: unknown): string {
  return choice === 'tab' ? '\t' : choice === '4' ? '    ' : '  ';
}

/** Recursively sort object keys (arrays keep their order). */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).sort()) {
      out[k] = sortKeysDeep((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/** Parse with the native fast path, falling back to the tolerant parser. */
export function parseJson(text: string): { value: unknown; notes: string[] } {
  try {
    return { value: JSON.parse(text), notes: [] };
  } catch {
    return parseTolerant(text); // throws JsonParseError with position + hint
  }
}

/**
 * Parse and also record where every value sits in the source text. Always
 * uses the tolerant parser (the native one has no position info), so it is
 * slower — used by Tree / Path / Graph, which need the spans for
 * "click → select in editor".
 */
export function parseJsonWithSpans(text: string): { value: unknown; notes: string[]; spans: Map<string, [number, number]> } {
  const r = parseTolerant(text, { spans: true });
  return { value: r.value, notes: r.notes, spans: r.spans! };
}

export function describeShape(value: unknown): string {
  if (Array.isArray(value)) return `array · ${value.length} item${value.length === 1 ? '' : 's'}`;
  if (value && typeof value === 'object') {
    const n = Object.keys(value).length;
    return `object · ${n} key${n === 1 ? '' : 's'}`;
  }
  if (value === null) return 'null';
  return typeof value;
}

export function runJson(input: string, ctx: RunContext): ModeResult {
  if (input.trim() === '') return { output: '', status: '' };
  try {
    const { value, notes } = parseJson(input);
    const data = ctx.options['sortKeys'] === true ? sortKeysDeep(value) : value;
    const output = ctx.pretty ? JSON.stringify(data, null, indentString(ctx.options['indent'])) : JSON.stringify(data);
    const bytes = byteLength(output);
    return {
      output,
      notes: notes.length ? notes : undefined,
      status: `Valid JSON · ${describeShape(value)} · ${formatBytes(bytes)}`,
    };
  } catch (e) {
    if (e instanceof JsonParseError) {
      return {
        output: '',
        error: { message: e.message, line: e.line, col: e.col, hint: e.hint },
        status: `Invalid JSON · line ${e.line}, col ${e.col}`,
      };
    }
    return { output: '', error: { message: (e as Error).message }, status: 'Invalid JSON' };
  }
}

export const jsonMode: ToolMode = {
  id: 'json',
  label: 'JSON Format / Validate',
  description: 'Prettify, minify and validate JSON — with exact error locations and fix hints.',
  category: 'JSON',
  icon: 'braces',
  emptyHint: 'Paste JSON to format and validate it. Trailing commas and smart quotes are tolerated.',
  sample: '{"service":"api","version":3,"healthy":true,"regions":["us-east-1","eu-west-2"],"limits":{"rps":1200,"burst":null}}',
  outputLanguage: 'json',
  supportsPretty: true,
  controls: [
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
    { kind: 'toggle', key: 'sortKeys', label: 'Sort keys', default: false },
  ],
  run: runJson,
};
