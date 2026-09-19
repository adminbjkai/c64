import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSchema, checkFormat, resolvePointer, deepEqual } from '../src/lib/json-schema.js';
import { runJsonSchema, jsonSchemaMode, formatSchemaErrors } from '../src/modes/json-schema.js';

const ctx = (inputB: string, pretty = true, options: Record<string, unknown> = {}) => ({ pretty, options, inputB });
const v = (schema: unknown, inst: unknown) => validateSchema(schema, inst);
const keywords = (schema: unknown, inst: unknown) => v(schema, inst).errors.map((e) => e.keyword);

test('sample runs and reports errors with pointers', () => {
  const r = runJsonSchema(jsonSchemaMode.sample, ctx(jsonSchemaMode.sampleB!));
  assert.equal(r.error, undefined);
  assert.match(r.status!, /^\d+ errors$/);
  assert.equal(r.view?.kind, 'schema-errors');
  assert.ok(r.output.includes('✗ /id: must be >= 1 (got 0)'));
  assert.ok(r.output.includes('✗ /items/1/price: must be number (got string)'));
  assert.ok(r.output.includes('✗ /email: must be a valid email'));
  assert.ok(r.output.includes('unexpected property "extra"'));
  assert.ok(r.output.includes('missing required property "address"'));
});

test('empty schema returns empty result; empty instance waits', () => {
  assert.deepEqual(runJsonSchema('', ctx('{}')), { output: '', status: '' });
  assert.match(runJsonSchema('{}', ctx('')).status!, /waiting/);
});

test('valid instance: Pretty says ✓ Valid, Raw is []', () => {
  const r = runJsonSchema('{"type":"object"}', ctx('{"a":1}'));
  assert.equal(r.output, '✓ Valid');
  assert.equal(r.status, 'Valid');
  assert.equal(runJsonSchema('{"type":"object"}', ctx('{"a":1}', false)).output, '[]');
});

test('Raw output is the JSON error array', () => {
  const r = runJsonSchema('{"type":"string"}', ctx('5', false));
  const arr = JSON.parse(r.output) as { instancePath: string; keyword: string }[];
  assert.equal(arr.length, 1);
  assert.equal(arr[0]!.keyword, 'type');
  assert.equal(arr[0]!.instancePath, '');
});

test('parse errors are attributed to Schema / Instance', () => {
  const s = runJsonSchema('{"type":', ctx('{}'));
  assert.match(s.error!.message, /^Schema:/);
  assert.ok(s.error!.line);
  const i = runJsonSchema('{}', ctx('{"a":'));
  assert.match(i.error!.message, /^Instance:.*line \d+/);
  assert.equal(i.error!.line, undefined);
});

test('type: single, array of types, integer vs number', () => {
  assert.deepEqual(keywords({ type: 'string' }, 5), ['type']);
  assert.deepEqual(keywords({ type: ['string', 'null'] }, null), []);
  assert.deepEqual(keywords({ type: 'integer' }, 1.5), ['type']);
  assert.deepEqual(keywords({ type: 'number' }, 2), []);
  assert.equal(v({ type: 'integer' }, 1.5).errors[0]!.message, 'must be integer (got number)');
});

test('enum and const', () => {
  assert.deepEqual(keywords({ enum: ['a', 1, null] }, 1), []);
  assert.deepEqual(keywords({ enum: ['a', 1] }, 'b'), ['enum']);
  assert.deepEqual(keywords({ const: { a: [1] } }, { a: [1] }), []);
  assert.deepEqual(keywords({ const: 1 }, 2), ['const']);
});

test('properties / required / additionalProperties false', () => {
  const schema = { properties: { a: { type: 'string' } }, required: ['a', 'b'], additionalProperties: false };
  const r = v(schema, { a: 1, c: 2 });
  assert.deepEqual(
    r.errors.map((e) => [e.instancePath, e.keyword]),
    [
      ['', 'required'],
      ['/a', 'type'],
      ['/c', 'additionalProperties'],
    ],
  );
  assert.equal(r.errors[2]!.message, 'unexpected property "c"');
});

test('additionalProperties schema and patternProperties', () => {
  const schema = { patternProperties: { '^x_': { type: 'number' } }, additionalProperties: { type: 'string' } };
  assert.deepEqual(keywords(schema, { x_1: 1, other: 's' }), []);
  assert.deepEqual(keywords(schema, { x_1: 's', other: 1 }), ['type', 'type']);
});

test('minProperties / maxProperties / propertyNames', () => {
  assert.deepEqual(keywords({ minProperties: 2 }, { a: 1 }), ['minProperties']);
  assert.deepEqual(keywords({ maxProperties: 1 }, { a: 1, b: 2 }), ['maxProperties']);
  const r = v({ propertyNames: { pattern: '^[a-z]+$' } }, { ok: 1, 'Not OK': 2 });
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0]!.message, /property name "Not OK"/);
});

test('items schema, tuple items with additionalItems, prefixItems + items', () => {
  assert.deepEqual(keywords({ items: { type: 'number' } }, [1, 'x']), ['type']);
  assert.equal(v({ items: { type: 'number' } }, [1, 'x']).errors[0]!.instancePath, '/1');
  const tuple = { items: [{ type: 'string' }, { type: 'number' }], additionalItems: false };
  assert.deepEqual(keywords(tuple, ['a', 1]), []);
  assert.deepEqual(keywords(tuple, ['a', 'b', 3]), ['type', 'additionalItems']);
  const prefix = { prefixItems: [{ type: 'string' }], items: { type: 'boolean' } };
  assert.deepEqual(keywords(prefix, ['a', true, false]), []);
  assert.deepEqual(keywords(prefix, ['a', 1]), ['type']);
  assert.deepEqual(keywords({ prefixItems: [{}], items: false }, [1, 2]), ['items']);
});

test('contains / minContains / maxContains', () => {
  assert.deepEqual(keywords({ contains: { type: 'number' } }, ['a']), ['contains']);
  assert.deepEqual(keywords({ contains: { type: 'number' }, minContains: 2 }, [1, 'a']), ['minContains']);
  assert.deepEqual(keywords({ contains: { type: 'number' }, maxContains: 1 }, [1, 2]), ['maxContains']);
});

test('minItems / maxItems / uniqueItems', () => {
  assert.deepEqual(keywords({ minItems: 2 }, [1]), ['minItems']);
  assert.deepEqual(keywords({ maxItems: 1 }, [1, 2]), ['maxItems']);
  assert.deepEqual(keywords({ uniqueItems: true }, [{ a: 1 }, { a: 1 }]), ['uniqueItems']);
  assert.deepEqual(keywords({ uniqueItems: true }, [1, '1']), []);
});

test('minLength / maxLength count code points; pattern', () => {
  assert.deepEqual(keywords({ minLength: 2 }, '💩'), ['minLength']);
  assert.deepEqual(keywords({ maxLength: 1 }, '💩'), []);
  assert.deepEqual(keywords({ pattern: '^a+$' }, 'aaa'), []);
  assert.deepEqual(keywords({ pattern: '^a+$' }, 'bab'), ['pattern']);
});

test('formats: date, date-time, time, email, uuid, uri, ipv4, ipv6, hostname', () => {
  assert.equal(checkFormat('date', '2024-02-29'), true);
  assert.equal(checkFormat('date', '2023-02-29'), false);
  assert.equal(checkFormat('date-time', '2024-01-02T03:04:05.123Z'), true);
  assert.equal(checkFormat('date-time', '2024-01-02 03:04:05+02:00'), true);
  assert.equal(checkFormat('date-time', '2024-01-02'), false);
  assert.equal(checkFormat('time', '23:59:60Z'), true);
  assert.equal(checkFormat('time', '24:00:00Z'), false);
  assert.equal(checkFormat('email', 'a@b.co'), true);
  assert.equal(checkFormat('email', 'nope'), false);
  assert.equal(checkFormat('uuid', '123e4567-e89b-12d3-a456-426614174000'), true);
  assert.equal(checkFormat('uuid', 'x'), false);
  assert.equal(checkFormat('uri', 'https://example.com/a?b=1'), true);
  assert.equal(checkFormat('uri', '/relative'), false);
  assert.equal(checkFormat('ipv4', '192.168.0.1'), true);
  assert.equal(checkFormat('ipv4', '256.1.1.1'), false);
  assert.equal(checkFormat('ipv6', '::1'), true);
  assert.equal(checkFormat('ipv6', '2001:db8::ff00:42:8329'), true);
  assert.equal(checkFormat('ipv6', '2001:db8:::1'), false);
  assert.equal(checkFormat('hostname', 'api.example.com'), true);
  assert.equal(checkFormat('hostname', '-bad.com'), false);
  assert.equal(checkFormat('bogus', 'x'), undefined);
});

test('unknown format is ignored with a note; format errors carry the keyword', () => {
  const r = v({ format: 'regex' }, 'x');
  assert.equal(r.valid, true);
  assert.ok(r.notes.some((n) => /format "regex" is not checked/.test(n)));
  assert.deepEqual(keywords({ format: 'ipv4' }, 'nope'), ['format']);
});

test('numeric bounds: numeric and draft-04 boolean exclusive forms, multipleOf', () => {
  assert.deepEqual(keywords({ minimum: 1 }, 0), ['minimum']);
  assert.deepEqual(keywords({ minimum: 1 }, 1), []);
  assert.deepEqual(keywords({ minimum: 1, exclusiveMinimum: true }, 1), ['minimum']);
  assert.deepEqual(keywords({ exclusiveMinimum: 1 }, 1), ['exclusiveMinimum']);
  assert.deepEqual(keywords({ maximum: 5, exclusiveMaximum: true }, 5), ['maximum']);
  assert.deepEqual(keywords({ exclusiveMaximum: 5 }, 4.9), []);
  assert.deepEqual(keywords({ multipleOf: 0.1 }, 0.3), []);
  assert.deepEqual(keywords({ multipleOf: 3 }, 10), ['multipleOf']);
});

test('$ref: local pointers, root #, definitions and $defs, unresolvable', () => {
  const s = { definitions: { pos: { type: 'integer', minimum: 0 } }, properties: { n: { $ref: '#/definitions/pos' } } };
  assert.deepEqual(keywords(s, { n: -1 }), ['minimum']);
  assert.equal(v(s, { n: -1 }).errors[0]!.schemaPath, '/definitions/pos/minimum');
  const tree = { type: 'object', properties: { kids: { type: 'array', items: { $ref: '#' } } } };
  assert.deepEqual(keywords(tree, { kids: [{ kids: ['x'] }] }), ['type']);
  assert.equal(v(tree, { kids: [{ kids: ['x'] }] }).errors[0]!.instancePath, '/kids/0/kids/0');
  assert.deepEqual(keywords({ $ref: '#/$defs/missing' }, 1), ['$ref']);
  assert.deepEqual(resolvePointer({ a: { 'b/c': [1, 2] } }, '#/a/b~1c/1'), 2);
});

test('allOf / anyOf / oneOf / not', () => {
  assert.deepEqual(keywords({ allOf: [{ type: 'string' }, { minLength: 3 }] }, 'ab'), ['minLength']);
  assert.deepEqual(keywords({ anyOf: [{ type: 'string' }, { type: 'number' }] }, true), ['anyOf']);
  assert.deepEqual(keywords({ anyOf: [{ type: 'string' }, { type: 'number' }] }, 1), []);
  assert.deepEqual(keywords({ oneOf: [{ type: 'number' }, { minimum: 0 }] }, 1), ['oneOf']);
  assert.equal(v({ oneOf: [{ type: 'number' }, { minimum: 0 }] }, 1).errors[0]!.message, 'must match exactly one schema in oneOf (matched 2 of 2)');
  assert.deepEqual(keywords({ oneOf: [{ type: 'number' }, { type: 'string' }] }, 'x'), []);
  assert.deepEqual(keywords({ not: { type: 'null' } }, null), ['not']);
});

test('if / then / else', () => {
  const s = { if: { properties: { kind: { const: 'a' } } }, then: { required: ['x'] }, else: { required: ['y'] } };
  assert.deepEqual(keywords(s, { kind: 'a', x: 1 }), []);
  assert.deepEqual(keywords(s, { kind: 'a' }), ['required']);
  assert.deepEqual(keywords(s, { kind: 'b' }), ['required']);
  assert.match(v(s, { kind: 'b' }).errors[0]!.message, /"y"/);
});

test('dependentRequired, dependentSchemas and draft-07 dependencies', () => {
  assert.deepEqual(keywords({ dependentRequired: { card: ['cvv'] } }, { card: 1 }), ['dependentRequired']);
  assert.deepEqual(keywords({ dependencies: { card: ['cvv'] } }, { card: 1, cvv: 2 }), []);
  assert.deepEqual(keywords({ dependencies: { card: { properties: { cvv: { type: 'string' } } } } }, { card: 1, cvv: 2 }), ['type']);
  assert.deepEqual(keywords({ dependentSchemas: { a: { required: ['b'] } } }, { a: 1 }), ['required']);
});

test('boolean schemas and $comment', () => {
  assert.deepEqual(keywords(true, 'anything'), []);
  assert.deepEqual(keywords(false, 'anything'), ['false']);
  assert.deepEqual(keywords({ properties: { a: false }, $comment: 'x' }, { a: 1 }), ['false']);
  assert.deepEqual(keywords({ properties: { a: false } }, {}), []);
});

test('pointer escaping in instance paths', () => {
  const r = v({ properties: { 'a/b': { type: 'number' }, 'c~d': { type: 'number' } } }, { 'a/b': 'x', 'c~d': 'y' });
  assert.deepEqual(
    r.errors.map((e) => e.instancePath),
    ['/a~1b', '/c~0d'],
  );
});

test('collects all errors, not just the first', () => {
  const r = v({ type: 'object', properties: { a: { type: 'string', minLength: 2, pattern: '^x' } } }, { a: 5 });
  assert.equal(r.errors.length, 1); // string keywords do not apply to a number
  const r2 = v({ properties: { a: { minLength: 2, pattern: '^x' } } }, { a: 'a' });
  assert.deepEqual(
    r2.errors.map((e) => e.keyword),
    ['minLength', 'pattern'],
  );
});

test('deepEqual is order-insensitive for keys but not arrays', () => {
  assert.equal(deepEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }), true);
  assert.equal(deepEqual([1, 2], [2, 1]), false);
});

test('formatSchemaErrors renders the readable list', () => {
  const s = formatSchemaErrors([{ instancePath: '/items/2/price', schemaPath: '/x', keyword: 'type', message: 'must be number (got string)' }]);
  assert.equal(s, '✗ /items/2/price: must be number (got string)  [type]');
});
