import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explain } from '../src/explain.js';
import { jwtMode } from '../src/modes/jwt.js';
import { encodeBase64 } from '../src/lib/base64.js';

test('recognises a JWT and suggests the JWT mode', () => {
  const e = explain(jwtMode.sample);
  assert.equal(e.shape, 'JSON Web Token (JWT)');
  assert.equal(e.confidence, 'high');
  assert.ok(e.reasons.some((r) => /alg=HS256/.test(r)));
  assert.equal(e.suggestions[0]!.mode, 'jwt');
});

test('recognises minified JSON and flat records', () => {
  const e = explain('[{"id":1,"name":"a"},{"id":2,"name":"b"},{"id":3,"name":"c"},{"id":4,"name":"d"}]');
  assert.match(e.shape, /JSON array \(4 items\), minified/);
  assert.ok(e.suggestions.some((s) => s.mode === 'convert' && s.options?.['to'] === 'csv'));
});

test('sees through Base64 to the JSON inside', () => {
  const e = explain(encodeBase64('{"token":"abc","n":42}'));
  assert.equal(e.shape, 'Base64-encoded JSON');
  assert.equal(e.suggestions[0]!.mode, 'base64');
  assert.equal(e.suggestions[0]!.options?.['direction'], 'decode');
});

test('recognises XML, CSS, CSV and YAML', () => {
  assert.equal(explain('<a><b>1</b></a>').shape, 'XML');
  assert.equal(explain('.a { color: red; }').shape, 'CSS');
  assert.equal(explain('id,name\n1,a\n2,b').shape, 'CSV');
  assert.equal(explain('id\tname\n1\ta\n2\tb').shape, 'TSV (tab-separated values)');
  assert.equal(explain('service: api\nreplicas: 3\n').shape, 'YAML mapping');
});

test('falls back gracefully', () => {
  assert.equal(explain('').shape, 'Nothing to look at yet');
  assert.equal(explain('deadbeefcafe').shape, 'Hex-encoded bytes');
  assert.equal(explain('a=1&b=2').shape, 'URL query string');
  const plain = explain('Just some words here.');
  assert.equal(plain.shape, 'Plain text');
  assert.equal(plain.confidence, 'low');
  assert.equal(explain('<a><b></a>').confidence, 'medium');
});
