/**
 * JSON → Types mode: infer TypeScript / Zod / Python TypedDict / Go / JSON
 * Schema definitions from a JSON sample. Output is the generated code.
 */

import { type ToolMode, type ModeResult, type RunContext } from './types.js';
import { parseJson } from './json.js';
import { JsonParseError } from './json-parse.js';
import { generateTypes, type Target } from '../lib/json-types.js';

const TARGETS: Target[] = ['typescript', 'zod', 'python', 'go', 'jsonschema'];

export function runJsonToTypes(input: string, ctx: RunContext): ModeResult {
  if (input.trim() === '') return { output: '', status: '' };
  try {
    const { value, notes } = parseJson(input);
    const t = ctx.options['target'];
    const target: Target = typeof t === 'string' && (TARGETS as string[]).includes(t) ? (t as Target) : 'typescript';
    const rootName = typeof ctx.options['rootName'] === 'string' && ctx.options['rootName'].trim() ? ctx.options['rootName'].trim() : 'Root';
    const { code, typeCount } = generateTypes(value, { target, rootName, optionalMissing: ctx.options['optionalMissing'] !== false });
    return {
      output: code,
      notes: notes.length ? notes : undefined,
      status: `${typeCount} type${typeCount === 1 ? '' : 's'} generated`,
    };
  } catch (e) {
    if (e instanceof JsonParseError) {
      return { output: '', error: { message: e.message, line: e.line, col: e.col, hint: e.hint }, status: `Invalid JSON · line ${e.line}, col ${e.col}` };
    }
    return { output: '', error: { message: (e as Error).message }, status: 'Invalid JSON' };
  }
}

export const jsonToTypesMode: ToolMode = {
  id: 'json-to-types',
  label: 'JSON → Types',
  description: 'Generate TypeScript, Zod, Python TypedDict, Go struct or JSON Schema definitions from a JSON sample.',
  category: 'JSON',
  icon: 'types',
  keywords: ['typescript', 'interface', 'zod', 'schema', 'python', 'go', 'struct', 'typeddict', 'codegen'],
  emptyHint: 'Paste JSON to generate type definitions. Pick the target language in the header.',
  sample:
    '{"id":1,"name":"Ada","score":9.5,"active":true,"nickname":null,"createdAt":"2024-01-02T03:04:05Z","tags":["a","b"],"address":{"city":"London","zip":"N1"},"items":[{"sku":"A","qty":1},{"sku":"B","qty":2,"note":"gift"}],"empty":[]}',
  outputLanguage: (ctx) => ({ typescript: 'typescript', zod: 'typescript', python: 'python', go: 'go', jsonschema: 'json' } as const)[String(ctx.options['target'] ?? 'typescript')],
  supportsPretty: false,
  controls: [
    {
      kind: 'select',
      key: 'target',
      label: 'Target',
      default: 'typescript',
      options: [
        { value: 'typescript', label: 'TypeScript' },
        { value: 'zod', label: 'Zod' },
        { value: 'python', label: 'Python TypedDict' },
        { value: 'go', label: 'Go' },
        { value: 'jsonschema', label: 'JSON Schema' },
      ],
    },
    { kind: 'text', key: 'rootName', label: 'Root name', placeholder: 'Root', default: 'Root' },
    { kind: 'toggle', key: 'optionalMissing', label: 'Missing keys optional', default: true },
  ],
  run: runJsonToTypes,
};
