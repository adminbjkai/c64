import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateTypes, inferShape, pascalCase, singularize } from '../src/lib/json-types.js';
import { runJsonToTypes, jsonToTypesMode } from '../src/modes/json-to-types.js';

const ctx = (options: Record<string, unknown> = {}) => ({ pretty: true, options });

const FIXTURE = {
  id: 1,
  name: 'Ada',
  score: 9.5,
  active: true,
  nickname: null,
  createdAt: '2024-01-02T03:04:05Z',
  tags: ['a', 'b'],
  address: { city: 'London', zip: 'N1' },
  items: [
    { sku: 'A', qty: 1 },
    { sku: 'B', qty: 2, note: 'gift' },
  ],
  empty: [],
};
const FIXTURE_TEXT = JSON.stringify(FIXTURE);

test('sample runs and reports the type count', () => {
  const r = runJsonToTypes(jsonToTypesMode.sample, ctx());
  assert.equal(r.error, undefined);
  assert.equal(r.status, '3 types generated');
});

test('empty input returns empty output and status', () => {
  assert.deepEqual(runJsonToTypes('', ctx()), { output: '', status: '' });
});

test('typescript output is exact for the nested fixture', () => {
  const expected = [
    'export interface Root {',
    '  id: number;',
    '  name: string;',
    '  score: number;',
    '  active: boolean;',
    '  nickname: null;',
    '  createdAt: string; // ISO-8601 date',
    '  tags: string[];',
    '  address: Address;',
    '  items: Item[];',
    '  empty: unknown[];',
    '}',
    '',
    'export interface Address {',
    '  city: string;',
    '  zip: string;',
    '}',
    '',
    'export interface Item {',
    '  sku: string;',
    '  qty: number;',
    '  note?: string;',
    '}',
    '',
  ].join('\n');
  assert.equal(runJsonToTypes(FIXTURE_TEXT, ctx({ target: 'typescript' })).output, expected);
});

test('jsonschema output is exact for the nested fixture', () => {
  const expected = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Root',
    type: 'object',
    properties: {
      id: { type: 'integer' },
      name: { type: 'string' },
      score: { type: 'number' },
      active: { type: 'boolean' },
      nickname: { type: 'null' },
      createdAt: { type: 'string', format: 'date-time' },
      tags: { type: 'array', items: { type: 'string' } },
      address: { $ref: '#/$defs/Address' },
      items: { type: 'array', items: { $ref: '#/$defs/Item' } },
      empty: { type: 'array', items: {} },
    },
    required: ['id', 'name', 'score', 'active', 'nickname', 'createdAt', 'tags', 'address', 'items', 'empty'],
    additionalProperties: false,
    $defs: {
      Address: { type: 'object', properties: { city: { type: 'string' }, zip: { type: 'string' } }, required: ['city', 'zip'], additionalProperties: false },
      Item: { type: 'object', properties: { sku: { type: 'string' }, qty: { type: 'integer' }, note: { type: 'string' } }, required: ['sku', 'qty'], additionalProperties: false },
    },
  };
  assert.equal(runJsonToTypes(FIXTURE_TEXT, ctx({ target: 'jsonschema' })).output, JSON.stringify(expected, null, 2) + '\n');
});

test('zod output defines nested schemas before the root and marks optional fields', () => {
  const out = runJsonToTypes(FIXTURE_TEXT, ctx({ target: 'zod' })).output;
  assert.ok(out.startsWith('import { z } from "zod";'));
  assert.ok(out.indexOf('ItemSchema = z.object') < out.indexOf('RootSchema = z.object'));
  assert.ok(out.includes('note: z.string().optional(),'));
  assert.ok(out.includes('items: z.array(ItemSchema),'));
  assert.ok(out.includes('createdAt: z.string(), // ISO-8601 date'));
  assert.ok(out.includes('empty: z.array(z.unknown()),'));
  assert.ok(out.includes('export type Root = z.infer<typeof RootSchema>;'));
});

test('python TypedDict output: int vs float, NotRequired, list[...], definitions before use', () => {
  const out = runJsonToTypes(FIXTURE_TEXT, ctx({ target: 'python' })).output;
  assert.ok(out.startsWith('from typing import Any, NotRequired, TypedDict'));
  assert.ok(out.indexOf('class Item(TypedDict):') < out.indexOf('class Root(TypedDict):'));
  assert.ok(out.includes('    id: int\n'));
  assert.ok(out.includes('    score: float\n'));
  assert.ok(out.includes('    note: NotRequired[str]'));
  assert.ok(out.includes('    items: list[Item]'));
  assert.ok(out.includes('    empty: list[Any]'));
  assert.ok(out.includes('    createdAt: str  # ISO-8601 date'));
});

test('go output: json tags, omitempty, int64/float64, exported names with initialisms', () => {
  const out = runJsonToTypes(FIXTURE_TEXT, ctx({ target: 'go' })).output;
  assert.ok(out.startsWith('type Root struct {'));
  assert.match(out, /\tID\s+int64\s+`json:"id"`/);
  assert.match(out, /\tScore\s+float64\s+`json:"score"`/);
  assert.match(out, /\tItems\s+\[\]Item\s+`json:"items"`/);
  assert.match(out, /\tNote\s+string\s+`json:"note,omitempty"`/);
  assert.match(out, /`json:"createdAt"` \/\/ ISO-8601 date/);
});

test('optionalMissing=false keeps merged keys required', () => {
  const out = runJsonToTypes('{"a":[{"b":1},{"c":2}]}', ctx({ optionalMissing: false })).output;
  assert.ok(out.includes('  b: number;\n  c: number;\n'));
  const opt = runJsonToTypes('{"a":[{"b":1},{"c":2}]}', ctx()).output;
  assert.ok(opt.includes('  b?: number;\n  c?: number;\n'));
});

test('rootName control is PascalCased and used for root and array items', () => {
  const out = runJsonToTypes('[{"x":1}]', ctx({ rootName: 'api response' })).output;
  assert.equal(out, 'export type ApiResponse = ApiResponseItem[];\n\nexport interface ApiResponseItem {\n  x: number;\n}\n');
});

test('mixed arrays become unions with null last; null unified with a type is T | null', () => {
  const out = runJsonToTypes('{"m":[1,"a",null],"n":[null,{"k":true}]}', ctx()).output;
  assert.ok(out.includes('  m: (number | string | null)[];'));
  assert.ok(out.includes('  n: (N | null)[];'));
  const zod = runJsonToTypes('{"v":[null,"a"]}', ctx({ target: 'zod' })).output;
  assert.ok(zod.includes('v: z.array(z.string().nullable()),'));
  const go = runJsonToTypes('{"v":null,"w":[1,null]}', ctx({ target: 'go' })).output;
  assert.match(go, /V\s+any/);
  assert.match(go, /W\s+\[\]\*int64/);
});

test('name collisions get a numeric suffix', () => {
  const out = runJsonToTypes('{"item":{"a":1},"items":[{"b":2}]}', ctx()).output;
  assert.ok(out.includes('export interface Item {'));
  assert.ok(out.includes('export interface Item2 {'));
  assert.ok(out.includes('  items: Item2[];'));
});

test('primitive root and non-identifier keys', () => {
  assert.equal(runJsonToTypes('"x"', ctx()).output, 'export type Root = string;\n');
  assert.equal(runJsonToTypes('"x"', ctx()).status, '1 type generated');
  const out = runJsonToTypes('{"my-key": 1, "2nd": "b"}', ctx()).output;
  assert.ok(out.includes('  "my-key": number;'));
  assert.ok(out.includes('  "2nd": string;'));
});

test('tolerant JSON parsing is surfaced as notes; invalid JSON is an error with position', () => {
  const ok = runJsonToTypes('{"a": 1,}', ctx());
  assert.equal(ok.error, undefined);
  assert.ok((ok.notes?.length ?? 0) > 0);
  const bad = runJsonToTypes('{"a": }', ctx());
  assert.ok(bad.error);
  assert.equal(bad.error?.line, 1);
  assert.ok(typeof bad.error?.col === 'number');
});

test('helpers: pascalCase, singularize and inferShape basics', () => {
  assert.equal(pascalCase('user_profile-data'), 'UserProfileData');
  assert.equal(pascalCase('camelCase'), 'CamelCase');
  assert.equal(singularize('entries'), 'entry');
  assert.equal(singularize('boxes'), 'box');
  assert.equal(singularize('address'), 'address');
  assert.equal(singularize('items'), 'item');
  const s = inferShape([1, 2.5]);
  assert.deepEqual(s, { kind: 'array', elem: { kind: 'number', int: false } });
  assert.equal(generateTypes({ a: [] }, { target: 'typescript', rootName: 'R' }).typeCount, 1);
});
