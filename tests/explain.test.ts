import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explain, detectMode, detectedName } from '../src/explain.js';
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

test('recognises URLs, URL-encoded text, query strings and cron expressions', () => {
  const url = explain('https://example.com/search?q=caf%C3%A9%20au%20lait&lang=en');
  assert.equal(url.shape, 'URL');
  assert.equal(url.confidence, 'high');
  assert.equal(url.suggestions[0]!.mode, 'url');
  const bare = explain('api.example.com/v1/users?page=2');
  assert.equal(bare.shape, 'URL');
  assert.equal(bare.confidence, 'medium');
  const enc = explain('caf%C3%A9%20au%20lait');
  assert.equal(enc.shape, 'URL-encoded text');
  assert.equal(enc.confidence, 'high');
  assert.deepEqual(enc.suggestions[0], { label: 'Decode it', mode: 'url', options: { direction: 'decode' } });
  assert.equal(explain('caf%C3').shape, 'Plain text'); // one escape is not enough
  const qs = explain('a=1&b=2');
  assert.equal(qs.shape, 'URL query string');
  assert.equal(qs.suggestions[0]!.mode, 'query-string');
  const cron = explain('*/5 0 * * MON-FRI');
  assert.equal(cron.shape, 'Cron expression');
  assert.equal(cron.suggestions[0]!.mode, 'cron');
  assert.equal(explain('30 5 * 3 MON-FRI').shape, 'Cron expression');
  assert.equal(explain('hello there my dear friend').shape, 'Plain text');
  assert.equal(explain('1758153600').shape, 'Plain text'); // digits only: a number, not hex bytes
});

test('detectMode maps explanations to a tool, or stays in Auto', () => {
  const pick = (t: string) => detectMode(explain(t));
  assert.equal(pick(jwtMode.sample)?.mode, 'jwt');
  assert.deepEqual(pick('{"a":1}'), { mode: 'json', name: 'JSON' });
  const b64 = pick(encodeBase64('{"token":"abc","n":42}'));
  assert.equal(b64?.mode, 'base64');
  assert.deepEqual(b64?.options, { direction: 'decode', urlSafe: false });
  assert.equal(pick('<a><b>1</b></a>')?.mode, 'xml');
  assert.equal(pick('<a><b></a>')?.mode, 'xml'); // medium, dedicated tool exists
  assert.equal(pick('.a { color: red; }')?.mode, 'css');
  assert.deepEqual(pick('id;name\n1;a\n2;b')?.options, { delimiter: ';' });
  assert.equal(pick('service: api\nreplicas: 3\n')?.mode, 'yaml');
  assert.equal(pick('deadbeefcafe')?.mode, 'hex');
  assert.equal(pick('caf%C3%A9%20au%20lait')?.mode, 'url');
  assert.equal(pick('a=1&b=2')?.mode, 'query-string');
  assert.equal(pick('*/5 * * * *')?.mode, 'cron');
  assert.equal(pick('Just some words here.'), null);
  assert.equal(pick(''), null);
  assert.equal(detectedName('json'), 'JSON');
  assert.equal(detectedName('query-string'), 'Query string');
  assert.equal(detectedName('hash'), undefined);
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
