/**
 * JSON Schema Validate mode: editor A holds the schema, editor B the
 * instance. Every failing keyword is reported with an RFC 6901 pointer.
 *
 * Pretty → readable "✗ /path: message" list (or "✓ Valid") + a table view.
 * Raw    → the error array as JSON.
 */

import { type ToolMode, type ModeResult, type RunContext } from './types.js';
import { parseJson } from './json.js';
import { JsonParseError } from './json-parse.js';
import { validateSchema, type SchemaError } from '../lib/json-schema.js';

export interface SchemaErrorsData {
  valid: boolean;
  errors: SchemaError[];
}

function parseSide(label: 'Schema' | 'Instance', text: string, withPosition: boolean): { value?: unknown; notes: string[]; result?: ModeResult } {
  try {
    const { value, notes } = parseJson(text);
    return { value, notes: notes.map((n) => `${label}: ${n}`) };
  } catch (e) {
    if (e instanceof JsonParseError) {
      const where = ` (line ${e.line}, col ${e.col})`;
      return {
        notes: [],
        result: {
          output: '',
          error: withPosition ? { message: `${label}: ${e.message}`, line: e.line, col: e.col, hint: e.hint } : { message: `${label}: ${e.message}${where}`, hint: e.hint },
          status: `Invalid ${label} JSON · line ${e.line}, col ${e.col}`,
        },
      };
    }
    return { notes: [], result: { output: '', error: { message: `${label}: ${(e as Error).message}` }, status: `Invalid ${label} JSON` } };
  }
}

export function formatSchemaErrors(errors: SchemaError[]): string {
  if (errors.length === 0) return '✓ Valid';
  return errors.map((e) => `✗ ${e.instancePath || '/'}: ${e.message}  [${e.keyword}]`).join('\n');
}

export function runJsonSchema(input: string, ctx: RunContext): ModeResult {
  if (input.trim() === '') return { output: '', status: '' };
  const instanceText = ctx.inputB ?? '';
  // Schema errors carry line/col (editor A); instance positions go in the message only.
  const schema = parseSide('Schema', input, true);
  if (schema.result) return schema.result;
  if (instanceText.trim() === '') return { output: '', status: 'Schema OK · waiting for an instance in B', notes: schema.notes.length ? schema.notes : undefined };
  const instance = parseSide('Instance', instanceText, false);
  if (instance.result) return instance.result;

  const { valid, errors, notes } = validateSchema(schema.value, instance.value);
  const allNotes = [...schema.notes, ...instance.notes, ...notes];
  const output = ctx.pretty ? formatSchemaErrors(errors) : JSON.stringify(errors, null, 2);
  const result: ModeResult = {
    output,
    status: valid ? 'Valid' : `${errors.length} error${errors.length === 1 ? '' : 's'}`,
    notes: allNotes.length ? allNotes : undefined,
  };
  if (ctx.pretty) {
    const data: SchemaErrorsData = { valid, errors };
    result.view = { kind: 'schema-errors', data };
  }
  return result;
}

export const jsonSchemaMode: ToolMode = {
  id: 'json-schema',
  label: 'JSON Schema Validate',
  description: 'Validate a JSON document against a JSON Schema (draft-07 to 2020-12) and list every violation with its path.',
  category: 'JSON',
  icon: 'schema',
  keywords: ['schema', 'validate', 'validator', 'draft', 'ajv', 'required', 'properties'],
  emptyHint: 'Paste a JSON Schema in Schema and a document in Instance — every failing keyword is listed with its JSON Pointer.',
  inputs: 2,
  inputLabels: ['Schema', 'Instance'],
  sample: JSON.stringify(
    {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      required: ['id', 'email', 'items'],
      additionalProperties: false,
      properties: {
        id: { type: 'integer', minimum: 1 },
        email: { type: 'string', format: 'email' },
        role: { enum: ['admin', 'user'] },
        items: { type: 'array', minItems: 1, uniqueItems: true, items: { $ref: '#/$defs/item' } },
        shipping: {
          if: { properties: { method: { const: 'courier' } } },
          then: { required: ['address'] },
        },
      },
      $defs: {
        item: {
          type: 'object',
          required: ['sku', 'price'],
          properties: { sku: { type: 'string', pattern: '^[A-Z]-\\d+$' }, price: { type: 'number', exclusiveMinimum: 0 } },
        },
      },
    },
    null,
    2,
  ),
  sampleB: JSON.stringify(
    {
      id: 0,
      email: 'not-an-email',
      role: 'guest',
      items: [
        { sku: 'K-1', price: 99.5 },
        { sku: 'k1', price: 'free' },
      ],
      shipping: { method: 'courier' },
      extra: true,
    },
    null,
    2,
  ),
  supportsPretty: true,
  controls: [],
  run: runJsonSchema,
};
