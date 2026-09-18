import { test } from 'node:test';
import assert from 'node:assert/strict';
import { percentEncode, percentDecode, PercentError } from '../src/lib/percent.js';
import { runUrl, urlMode, urlBreakdown } from '../src/modes/url.js';

const ctx = (options: Record<string, unknown> = {}) => ({ pretty: false, options });

test('empty input is empty', () => {
  assert.deepEqual(runUrl('', ctx()), { output: '', status: '' });
});

test('sample decodes and yields a url view', () => {
  const r = runUrl(urlMode.sample, ctx());
  assert.equal(r.error, undefined);
  assert.equal(r.output, 'https://example.com/search?q=café au lait&lang=en&page=2#results');
  assert.match(r.status!, /^Decoded · \d+ chars → \d+ chars$/);
  assert.equal(r.view?.kind, 'url');
  const d = r.view!.data as ReturnType<typeof urlBreakdown>;
  assert.equal(d!.hostname, 'example.com');
  assert.equal(d!.pathname, '/search');
  assert.equal(d!.hash, '#results');
  assert.deepEqual(d!.params, [['q', 'café au lait'], ['lang', 'en'], ['page', '2']]);
});

test('component encoding escapes reserved chars; uri keeps them', () => {
  assert.equal(percentEncode('a b&c=d/e?f', 'component'), 'a%20b%26c%3Dd%2Fe%3Ff');
  assert.equal(percentEncode('https://x.io/a b?q=1&r=é', 'uri'), 'https://x.io/a%20b?q=1&r=%C3%A9');
  assert.equal(percentEncode("a b!'()~*", 'form'), 'a+b%21%27%28%29%7E*');
});

test('auto direction encodes plain text and decodes percent sequences', () => {
  const enc = runUrl('hello world', ctx());
  assert.equal(enc.output, 'hello%20world');
  assert.match(enc.status!, /^Encoded · 11 chars → 13 chars$/);
  const dec = runUrl('hello%20world', ctx());
  assert.equal(dec.output, 'hello world');
  // '+' only means space in form mode
  assert.equal(runUrl('a+b', ctx()).output, 'a%2Bb');
  assert.equal(runUrl('a+b', ctx({ component: 'form' })).output, 'a b');
});

test('forced direction is honoured', () => {
  assert.equal(runUrl('hello%20world', ctx({ direction: 'encode' })).output, 'hello%2520world');
  assert.equal(runUrl('plain', ctx({ direction: 'decode' })).output, 'plain');
});

test('uri decoding leaves reserved characters encoded', () => {
  assert.equal(percentDecode('a%2Fb%20c%C3%A9', 'uri'), 'a%2Fb cé');
  assert.equal(percentDecode('a%2Fb%20c', 'component'), 'a/b c');
});

test('multi-byte UTF-8 round-trips', () => {
  const s = '日本語 🚀 café';
  assert.equal(percentDecode(percentEncode(s, 'component'), 'component'), s);
  assert.equal(percentDecode(percentEncode(s, 'form'), 'form'), s);
});

test('malformed percent sequence reports line/col and a hint', () => {
  assert.throws(() => percentDecode('ab%zz', 'component'), (e: unknown) => e instanceof PercentError && e.offset === 2);
  const r = runUrl('ok\nbad%4', ctx({ direction: 'decode' }));
  assert.equal(r.output, '');
  assert.equal(r.error?.line, 2);
  assert.equal(r.error?.col, 4);
  assert.match(r.error!.hint!, /two hex digits/);
  assert.match(r.status!, /line 2, col 4/);
});

test('invalid UTF-8 bytes are reported', () => {
  const r = runUrl('x%FF%FEy', ctx({ direction: 'decode' }));
  assert.match(r.error!.message, /not valid UTF-8/);
  assert.equal(r.error?.col, 2);
});

test('urlBreakdown only accepts full URLs', () => {
  assert.equal(urlBreakdown('hello world'), null);
  assert.equal(urlBreakdown('/path?x=1'), null);
  const d = urlBreakdown('https://user:pw@host.example:8443/p/a?x=1&x=2&y=#frag')!;
  assert.equal(d.port, '8443');
  assert.equal(d.username, 'user');
  assert.equal(d.password, 'pw');
  assert.equal(d.origin, 'https://host.example:8443');
  assert.deepEqual(d.params, [['x', '1'], ['x', '2'], ['y', '']]);
  // encoding a URL still exposes the breakdown of the input
  assert.equal(runUrl('https://a.io/x y', ctx({ direction: 'encode' })).view?.kind, 'url');
  assert.equal(runUrl('just text', ctx()).view, undefined);
});
