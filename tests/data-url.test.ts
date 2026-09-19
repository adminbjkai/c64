import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDataUrl, buildDataUrl, sniffBytes, isTextLike, extensionFor } from '../src/lib/data-url.js';
import { runDataUrl, dataUrlMode, type DataUrlData } from '../src/modes/data-url.js';

const ctx = (options: Record<string, unknown> = {}) => ({ pretty: false, options });
const view = (r: ReturnType<typeof runDataUrl>) => r.view!.data as DataUrlData;

test('empty input is empty', () => {
  assert.deepEqual(runDataUrl('', ctx()), { output: '', status: '' });
});

test('sample PNG decodes to a hex dump with PNG detected and an image view', () => {
  const r = runDataUrl(dataUrlMode.sample, ctx());
  assert.equal(r.error, undefined);
  assert.match(r.output, /^image\/png · 165 bytes · PNG\n00000000: 89 50 4e 47 0d 0a 1a 0a/);
  assert.equal(r.status, 'image/png · 165 B · PNG · base64');
  assert.equal(r.view?.kind, 'data-url');
  const d = view(r);
  assert.equal(d.direction, 'decode');
  assert.equal(d.isImage, true);
  assert.equal(d.mismatch, false);
  assert.equal(d.detected?.label, 'PNG');
  assert.equal(d.filename, 'file.png');
  assert.equal(d.size, 165);
  assert.equal(d.text, null);
});

test('encode → decode round trip for UTF-8 text (base64)', () => {
  const e = runDataUrl('héllo wörld — ✓', ctx());
  assert.equal(e.output, 'data:text/plain;charset=utf-8;base64,aMOpbGxvIHfDtnJsZCDigJQg4pyT');
  assert.equal(view(e).direction, 'encode');
  const d = runDataUrl(e.output, ctx());
  assert.equal(d.output, 'héllo wörld — ✓');
  assert.equal(d.status, 'text/plain;charset=utf-8 · 21 B · text · base64');
  assert.equal(view(d).text, 'héllo wörld — ✓');
  assert.equal(view(d).charset, 'utf-8');
});

test('encode with base64 off produces a percent-encoded URL that decodes back', () => {
  const e = runDataUrl('a b&c=d/é', ctx({ base64: false, mime: 'text/plain' }));
  assert.equal(e.output, 'data:text/plain,a%20b%26c%3Dd%2F%C3%A9');
  assert.equal(runDataUrl(e.output, ctx()).output, 'a b&c=d/é');
});

test('percent-encoded data URL with the default media type', () => {
  const r = runDataUrl('data:,A%20brief%20note', ctx());
  assert.equal(r.output, 'A brief note');
  assert.equal(view(r).mime, 'text/plain');
  assert.equal(view(r).charset, 'US-ASCII');
  assert.equal(view(r).base64, false);
  const p = parseDataUrl('data:text/html;charset=utf-8,%3Ch1%3EHi%3C%2Fh1%3E');
  assert.equal(new TextDecoder().decode(p.bytes), '<h1>Hi</h1>');
  assert.equal(p.mediaType, 'text/html;charset=utf-8');
});

test('JSON and SVG data URLs are shown as text', () => {
  const r = runDataUrl('data:application/json;base64,eyJhIjoxfQ==', ctx());
  assert.equal(r.output, '{"a":1}');
  assert.ok(isTextLike('image/svg+xml'));
  assert.ok(isTextLike('application/ld+json'));
  assert.ok(!isTextLike('image/png'));
  assert.ok(!isTextLike('application/octet-stream'));
});

test('magic bytes: PNG, JPEG, GIF, WebP, PDF, ZIP, gzip', () => {
  const b = (...xs: (number | string)[]) => Uint8Array.from(xs.flatMap((x) => (typeof x === 'string' ? [...x].map((c) => c.charCodeAt(0)) : [x])));
  assert.equal(sniffBytes(b(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0))?.label, 'PNG');
  assert.equal(sniffBytes(b(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 'JFIF'))?.label, 'JPEG');
  assert.equal(sniffBytes(b('GIF89a', 0, 0))?.label, 'GIF');
  assert.equal(sniffBytes(b('GIF87a'))?.label, 'GIF');
  assert.equal(sniffBytes(b('RIFF', 0, 0, 0, 0, 'WEBPVP8 '))?.label, 'WebP');
  assert.equal(sniffBytes(b('RIFF', 0, 0, 0, 0, 'WAVEfmt '))?.label, undefined);
  assert.equal(sniffBytes(b('%PDF-1.7'))?.mime, 'application/pdf');
  assert.equal(sniffBytes(b('PK', 3, 4, 0))?.mime, 'application/zip');
  assert.equal(sniffBytes(b(0x1f, 0x8b, 8))?.label, 'gzip');
  assert.equal(sniffBytes(b('hello')), null);
  assert.equal(sniffBytes(new Uint8Array(0)), null);
});

test('declared MIME vs sniffed type mismatch is noted', () => {
  // A PNG header labelled as JPEG.
  const png = buildDataUrl(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]), 'image/jpeg', true);
  const r = runDataUrl(png, ctx());
  assert.equal(r.error, undefined);
  assert.equal(view(r).mismatch, true);
  assert.deepEqual(r.notes, ['Declared image/jpeg but the bytes look like PNG (image/png).']);
  assert.match(r.status!, /looks like PNG/);
  assert.equal(view(r).filename, 'file.png', 'download extension follows the real type');
  // Binary bytes declared as text/plain: hex dump, not garbage text.
  const t = runDataUrl(buildDataUrl(Uint8Array.from([0x1f, 0x8b, 8, 0, 0]), 'text/plain', true), ctx());
  assert.match(t.output, /^text\/plain · 5 bytes · gzip\n00000000: 1f 8b 08 00 00/);
  assert.equal(view(t).text, null);
});

test('long binary payloads dump only the first 256 bytes', () => {
  const bytes = new Uint8Array(1000).map((_, i) => i & 0xff);
  const r = runDataUrl(buildDataUrl(bytes, 'application/octet-stream', true), ctx());
  assert.match(r.output, /· 1000 bytes · first 256 bytes\n/);
  assert.equal(r.output.split('\n').length, 1 + 16);
  assert.equal(view(r).size, 1000);
  assert.equal(view(r).filename, 'file.bin');
});

test('encode: base64 input for a binary MIME is wrapped as-is', () => {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const r = runDataUrl(b64, ctx({ mime: 'image/png' }));
  assert.equal(r.output, `data:image/png;base64,${b64}`);
  assert.equal(view(r).detected?.label, 'PNG');
  assert.equal(view(r).isImage, true);
  assert.ok(r.notes?.[0]?.includes('wrapped as-is'));
  // Text MIME never re-interprets input as base64.
  const t = runDataUrl('SGVsbG8=', ctx({ mime: 'text/plain' }));
  assert.equal(t.output, 'data:text/plain;base64,U0dWc2JHOD0=');
});

test('direction control overrides auto-detection', () => {
  const forced = runDataUrl('data:,x', ctx({ direction: 'encode', mime: 'text/plain' }));
  assert.equal(forced.output, 'data:text/plain;base64,ZGF0YTosZA=='.replace('ZGF0YTosZA==', 'ZGF0YToseA=='));
  const dec = runDataUrl('not a url', ctx({ direction: 'decode' }));
  assert.equal(dec.error?.col, 1);
  assert.match(dec.error!.message, /Not a data URL/);
  assert.match(dec.error!.hint!, /starts with `data:`/);
});

test('bad input: missing comma, bad base64, bad percent escape, bad MIME', () => {
  const a = runDataUrl('data:text/plain;base64', ctx());
  assert.match(a.error!.message, /no comma/);
  const b = runDataUrl('data:text/plain;base64,SGVs!bG8=', ctx());
  assert.match(b.error!.message, /Invalid base64 payload/);
  assert.equal(b.error?.line, 1);
  assert.equal(b.error?.col, 28, 'column points at the bad character');
  const c = runDataUrl('data:text/plain,abc%2', ctx());
  assert.match(c.error!.message, /Bad percent-escape/);
  const d = runDataUrl('data:nonsense;base64,SGVsbG8=', ctx());
  assert.match(d.error!.message, /not a media type/);
  const e = runDataUrl('hello', ctx({ mime: 'plain' }));
  assert.match(e.error!.message, /not a media type/);
  assert.equal(e.status, 'Invalid MIME type');
});

test('extension mapping', () => {
  assert.equal(extensionFor('image/svg+xml'), 'svg');
  assert.equal(extensionFor('application/x-tar'), 'tar');
  assert.equal(extensionFor('audio/ogg'), 'ogg');
  assert.equal(extensionFor('text/plain'), 'txt');
});
