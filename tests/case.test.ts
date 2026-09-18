import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitWords, convertCase, CASE_STYLES } from '../src/lib/case.js';
import { runCase, caseMode, type CaseAllData } from '../src/modes/case.js';

const ctx = (options: Record<string, unknown> = {}) => ({ pretty: false, options });

test('empty input is empty', () => {
  assert.deepEqual(runCase('', ctx()), { output: '', status: '' });
  assert.deepEqual(runCase('  \n ', ctx()), { output: '', status: '' });
});

test('word splitting handles camel, acronyms, digits, separators', () => {
  assert.deepEqual(splitWords('userAccountID'), ['user', 'Account', 'ID']);
  assert.deepEqual(splitWords('HTTPServerConfig'), ['HTTP', 'Server', 'Config']);
  assert.deepEqual(splitWords('parse XML-document v2'), ['parse', 'XML', 'document', 'v2']);
  assert.deepEqual(splitWords('max_retry_count'), ['max', 'retry', 'count']);
  assert.deepEqual(splitWords('  __foo.bar/baz--qux  '), ['foo', 'bar', 'baz', 'qux']);
  assert.deepEqual(splitWords('utf8Decoder v2Beta'), ['utf8', 'Decoder', 'v2', 'Beta']);
  assert.deepEqual(splitWords('crèmeBrûlée'), ['crème', 'Brûlée']);
  assert.deepEqual(splitWords(''), []);
});

test('every style converts a mixed identifier', () => {
  const s = 'HTTPServer maxRetry_count';
  const expected: Record<string, string> = {
    camel: 'httpServerMaxRetryCount',
    pascal: 'HttpServerMaxRetryCount',
    snake: 'http_server_max_retry_count',
    screaming: 'HTTP_SERVER_MAX_RETRY_COUNT',
    kebab: 'http-server-max-retry-count',
    title: 'Http Server Max Retry Count',
    sentence: 'Http server max retry count',
    lower: 'httpserver maxretry_count',
    upper: 'HTTPSERVER MAXRETRY_COUNT',
    dot: 'http.server.max.retry.count',
    path: 'http/server/max/retry/count',
    header: 'Http-Server-Max-Retry-Count',
    alternating: 'hTtP sErVeR mAx ReTrY cOuNt',
  };
  for (const { value } of CASE_STYLES) assert.equal(convertCase(s, value), expected[value], value);
});

test('sample converts per line and produces the case-all view', () => {
  const r = runCase(caseMode.sample, ctx());
  assert.equal(r.error, undefined);
  assert.equal(r.output, 'userAccountId\nhttpServerConfig\nparseXmlDocumentV2\nmaxRetryCount');
  assert.equal(r.status, 'camelCase · 4 lines');
  assert.equal(r.view?.kind, 'case-all');
  const d = r.view!.data as CaseAllData;
  assert.equal(d.source, 'userAccountID');
  assert.equal(d.variants.length, CASE_STYLES.length);
  assert.deepEqual(d.variants.find((v) => v.name === 'snake_case'), { name: 'snake_case', value: 'user_account_id' });
  assert.deepEqual(d.variants.find((v) => v.name === 'kebab-case'), { name: 'kebab-case', value: 'user-account-id' });
});

test('the `to` control selects the style; unknown falls back to camel', () => {
  assert.equal(runCase('hello world', ctx({ to: 'snake' })).output, 'hello_world');
  assert.equal(runCase('hello world', ctx({ to: 'screaming' })).output, 'HELLO_WORLD');
  assert.equal(runCase('hello world', ctx({ to: 'pascal' })).output, 'HelloWorld');
  assert.equal(runCase('hello world', ctx({ to: 'nope' })).output, 'helloWorld');
});

test('perLine false treats the whole input as one identifier', () => {
  const r = runCase('foo bar\nbaz', ctx({ to: 'kebab', perLine: false }));
  assert.equal(r.output, 'foo-bar-baz');
  assert.match(r.status!, /whole input/);
  assert.equal((r.view!.data as CaseAllData).source, 'foo bar\nbaz');
});

test('blank lines are preserved and skipped in the count; first non-empty line feeds the view', () => {
  const r = runCase('\n\nFoo Bar\n\nbaz', ctx({ to: 'snake' }));
  assert.equal(r.output, '\n\nfoo_bar\n\nbaz');
  assert.equal(r.status, 'snake_case · 2 lines');
  assert.equal((r.view!.data as CaseAllData).source, 'Foo Bar');
});
