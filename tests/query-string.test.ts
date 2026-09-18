import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQueryString, stringifyQuery, extractQuery } from '../src/lib/query-string.js';
import { runQueryString, queryStringMode } from '../src/modes/query-string.js';

const ctx = (options: Record<string, unknown> = {}, pretty = false) => ({ pretty, options });

test('empty input is empty', () => {
  assert.deepEqual(runQueryString('', ctx()), { output: '', status: '' });
  assert.deepEqual(runQueryString('  \n', ctx()), { output: '', status: '' });
});

test('sample runs and parses a full URL', () => {
  const r = runQueryString(queryStringMode.sample, ctx());
  assert.equal(r.error, undefined);
  assert.deepEqual(JSON.parse(r.output), {
    page: '2',
    sort: 'name',
    tag: ['a', 'b'],
    filter: { status: 'open', owner: 'me' },
    ids: ['7', '9'],
    q: 'hello world',
    empty: '',
  });
  assert.match(r.status!, /^JSON · 10 pairs → 7 keys$/);
});

test('extractQuery handles URL, ?-prefixed, bare and fragments', () => {
  assert.equal(extractQuery('https://x.io/p?a=1&b=2#h'), 'a=1&b=2');
  assert.equal(extractQuery('?a=1'), 'a=1');
  assert.equal(extractQuery('a=1&b=2'), 'a=1&b=2');
  assert.equal(extractQuery('https://x.io/p'), '');
});

test('repeated keys, brackets, empty brackets and empty values', () => {
  const v = parseQueryString('a=1&b=x&b=y&c[k]=v&c[j][z]=w&arr[]=1&arr[]=2&e=&f').value;
  assert.deepEqual(v, { a: '1', b: ['x', 'y'], c: { k: 'v', j: { z: 'w' } }, arr: ['1', '2'], e: '', f: '' });
});

test('numbers stay strings unless typed', () => {
  assert.deepEqual(parseQueryString('n=42&t=true&z=null&s=007').value, { n: '42', t: 'true', z: 'null', s: '007' });
  assert.deepEqual(parseQueryString('n=42&f=-1.5&t=true&z=null&s=007', { typed: true }).value, { n: 42, f: -1.5, t: true, z: null, s: '007' });
  const r = runQueryString('n=1', ctx({ typed: true }));
  assert.equal(r.output, '{"n":1}');
  assert.match(r.status!, /typed/);
});

test('pretty vs raw JSON output', () => {
  assert.equal(runQueryString('a=1', ctx({}, true)).output, '{\n  "a": "1"\n}');
  assert.equal(runQueryString('a=1', ctx({}, false)).output, '{"a":"1"}');
});

test('plus and percent decoding of keys and values', () => {
  assert.deepEqual(parseQueryString('first+name=John+Doe&caf%C3%A9=%2B1&bad=%zz').value, { 'first name': 'John Doe', café: '+1', bad: '%zz' });
});

test('JSON → query string with bracket notation', () => {
  const qs = stringifyQuery({ a: '1', b: ['x', 'y'], c: { k: 'v', j: { z: 'w' } }, e: '', s: 'hello world', n: 5, t: true, nil: null });
  assert.equal(qs, 'a=1&b[]=x&b[]=y&c[k]=v&c[j][z]=w&e=&s=hello+world&n=5&t=true&nil=');
  assert.equal(stringifyQuery({ items: [{ id: '1' }, { id: '2' }] }), 'items[0][id]=1&items[1][id]=2');
  // round trip
  assert.deepEqual(parseQueryString(qs).value, { a: '1', b: ['x', 'y'], c: { k: 'v', j: { z: 'w' } }, e: '', s: 'hello world', n: '5', t: 'true', nil: '' });
});

test('auto-detects JSON input and honours forced direction', () => {
  const r = runQueryString('{"a": 1, "b": ["x", "y"]}', ctx());
  assert.equal(r.output, 'a=1&b[]=x&b[]=y');
  assert.match(r.status!, /^Query string · 3 pairs$/);
  assert.equal(runQueryString('{"a":1}', ctx({ direction: 'toJson' })).output, '{"{\\"a\\":1}":""}');
  assert.equal(runQueryString('{}', ctx({ direction: 'toQuery' })).output, '');
});

test('invalid JSON and non-object JSON are errors', () => {
  const bad = runQueryString('{"a": ', ctx({ direction: 'toQuery' }));
  assert.ok(bad.error);
  assert.equal(bad.output, '');
  const arr = runQueryString('[1,2]', ctx({ direction: 'toQuery' }));
  assert.match(arr.error!.message, /JSON object/);
  assert.ok(arr.error!.hint);
});
