import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities, encodeEntities, NAMED_ENTITIES, looksLikeEntities } from '../src/lib/html-entities.js';
import { runHtmlEntities, htmlEntitiesMode } from '../src/modes/html-entities.js';

const ctx = (options: Record<string, unknown> = {}) => ({ pretty: false, options });

test('empty input is empty', () => {
  assert.deepEqual(runHtmlEntities('', ctx()), { output: '', status: '' });
});

test('sample decodes named, decimal and hex references', () => {
  const r = runHtmlEntities(htmlEntitiesMode.sample, ctx());
  assert.equal(r.error, undefined);
  assert.equal(r.output, '<p class="note">Café & crème — © 2026 😀 €5 …</p>');
  assert.match(r.status!, /^Decoded · 14 entities$/);
});

test('entity table covers the HTML4 set and common extras', () => {
  assert.ok(NAMED_ENTITIES.size >= 250, `only ${NAMED_ENTITIES.size} entities`);
  for (const name of ['nbsp', 'amp', 'lt', 'gt', 'quot', 'apos', 'copy', 'reg', 'trade', 'hellip', 'mdash', 'ndash', 'laquo', 'raquo', 'euro', 'pound', 'yen', 'cent', 'deg', 'plusmn', 'times', 'divide', 'micro', 'para', 'sect', 'middot', 'bull', 'larr', 'rarr', 'uarr', 'darr', 'harr', 'eacute', 'Uuml', 'szlig', 'alpha', 'Omega', 'sum', 'infin', 'ne', 'le', 'ge', 'rArr', 'hearts', 'check']) {
    assert.ok(NAMED_ENTITIES.has(name), `missing &${name};`);
  }
  assert.equal(decodeEntities('&alpha;&beta;&Omega; &sum;&infin; &larr;&rarr; &frac12;&deg;').text, 'αβΩ ∑∞ ←→ ½°');
});

test('numeric edge cases: cp1252 remap, out of range, surrogates, missing semicolon', () => {
  assert.equal(decodeEntities('&#150;&#8212;&#x2014;').text, '–——');
  assert.equal(decodeEntities('&#0;&#1114112;&#xD800;').text, '���');
  assert.equal(decodeEntities('&#65 &#x41').text, '&#65 &#x41');
});

test('unknown entities are left as-is and noted; legacy ones work without semicolon', () => {
  const r = runHtmlEntities('&bogus; &amp &lt;x&gt; &nbsp', ctx({ direction: 'decode' }));
  assert.equal(r.output, '&bogus; & <x> \u00a0');
  assert.match(r.notes![0]!, /&bogus;/);
  assert.equal(decodeEntities('&copy 2026').text, '© 2026');
  assert.equal(decodeEntities('&eacute 2026').text, '&eacute 2026');
});

test('encode scopes', () => {
  const s = 'a < b & "c" \'d\' — café €';
  assert.equal(encodeEntities(s, 'minimal').text, 'a &lt; b &amp; &quot;c&quot; &#39;d&#39; — café €');
  assert.equal(encodeEntities(s, 'named').text, 'a &lt; b &amp; &quot;c&quot; &#39;d&#39; &mdash; caf&eacute; &euro;');
  assert.equal(encodeEntities(s, 'all-non-ascii').text, 'a &lt; b &amp; &quot;c&quot; &#39;d&#39; &#x2014; caf&#xE9; &#x20AC;');
  // named scope falls back to decimal for unknown code points, incl. astral ones
  assert.equal(encodeEntities('😀 ‽', 'named').text, '&#128512; &#8253;');
  assert.equal(encodeEntities('😀', 'all-non-ascii').text, '&#x1F600;');
});

test('mode encode via options and status', () => {
  const r = runHtmlEntities('x < y & z', ctx({ direction: 'encode', scope: 'minimal' }));
  assert.equal(r.output, 'x &lt; y &amp; z');
  assert.match(r.status!, /^Encoded · 2 characters escaped · minimal$/);
  assert.equal(runHtmlEntities('é', ctx({ direction: 'encode', scope: 'named' })).output, '&eacute;');
  assert.equal(runHtmlEntities('é', ctx({ direction: 'encode', scope: 'bogus' })).output, 'é');
});

test('auto direction', () => {
  assert.equal(looksLikeEntities('a &amp; b'), true);
  assert.equal(looksLikeEntities('a & b'), false);
  assert.equal(looksLikeEntities('&#x41;'), true);
  assert.equal(runHtmlEntities('a & b', ctx()).output, 'a &amp; b');
  assert.equal(runHtmlEntities('a &amp; b', ctx()).output, 'a & b');
  assert.equal(runHtmlEntities('a &amp; b', ctx({ direction: 'encode' })).output, 'a &amp;amp; b');
});

test('encode → decode round-trips', () => {
  const s = '<script>alert("x & y")</script> ünïcödé 日本 🚀';
  for (const scope of ['minimal', 'named', 'all-non-ascii'] as const) {
    assert.equal(decodeEntities(encodeEntities(s, scope).text).text, s, scope);
  }
});
