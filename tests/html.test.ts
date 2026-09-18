import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHtml, formatHtml, minifyHtml } from '../src/lib/html.js';
import { runHtml, htmlMode } from '../src/modes/html.js';

const ctx = (options: Record<string, unknown> = {}, pretty = true) => ({ pretty, options });

test('sample runs without error in both modes and reports element count', () => {
  const pretty = runHtml(htmlMode.sample, ctx());
  assert.equal(pretty.error, undefined);
  assert.match(pretty.status ?? '', /^Formatted · 17 elements · /);
  const raw = runHtml(htmlMode.sample, ctx({}, false));
  assert.equal(raw.error, undefined);
  assert.match(raw.status ?? '', /^Minified · 17 elements · /);
  assert.ok(raw.output.length < pretty.output.length);
});

test('empty input returns empty output and status', () => {
  assert.deepEqual(runHtml('   \n', ctx()), { output: '', status: '' });
});

test('indents by nesting and keeps inline elements on the text line', () => {
  const out = formatHtml(parseHtml('<div><p>Hello <b>bold</b> and <a href="x">link</a>.</p><ul><li>a</li><li>b</li></ul></div>'));
  assert.equal(out, '<div>\n  <p>Hello <b>bold</b> and <a href="x">link</a>.</p>\n  <ul>\n    <li>a</li>\n    <li>b</li>\n  </ul>\n</div>');
});

test('indent control: 4 spaces and tab', () => {
  assert.equal(runHtml('<div><p>x</p></div>', ctx({ indent: '4' })).output, '<div>\n    <p>x</p>\n</div>');
  assert.equal(runHtml('<div><p>x</p></div>', ctx({ indent: 'tab' })).output, '<div>\n\t<p>x</p>\n</div>');
});

test('void elements take no closing tag and a stray </br> is a note', () => {
  const doc = parseHtml('<p>a<br>b<img src="x.png"><input disabled></p></br>');
  assert.equal(doc.elementCount, 4);
  assert.equal(formatHtml(doc), '<p>a<br>b<img src="x.png"><input disabled></p>');
  assert.ok(doc.notes.some((n) => /Stray closing tag <\/br>/.test(n)));
});

test('optional closing tags: <li> and <p> close implicitly without notes', () => {
  const doc = parseHtml('<ul><li>One<li>Two</ul><p>para<div>block</div>');
  assert.deepEqual(doc.notes, []);
  assert.equal(formatHtml(doc), '<ul>\n  <li>One</li>\n  <li>Two</li>\n</ul>\n<p>para</p>\n<div>block</div>');
});

test('unquoted attributes get double quotes; existing quotes are preserved', () => {
  const doc = parseHtml(`<a href=/x class='c d' data-x="1">t</a>`);
  assert.equal(formatHtml(doc), `<a href="/x" class='c d' data-x="1">t</a>`);
});

test('doctype and comments are preserved verbatim when formatting', () => {
  const out = formatHtml(parseHtml('<!DOCTYPE html><!-- hi --><div></div>'));
  assert.equal(out, '<!DOCTYPE html>\n<!-- hi -->\n<div></div>');
});

test('raw-text elements keep their contents byte for byte', () => {
  const src = '<div><pre>\n  a   <b>\n</pre><script>if (a < b && c > d) { x = "</div>" }</script><textarea>  t  </textarea><style>a{color:red}</style></div>';
  const doc = parseHtml(src);
  const out = formatHtml(doc);
  assert.ok(out.includes('<pre>\n  a   <b>\n</pre>'));
  assert.ok(out.includes('<script>if (a < b && c > d) { x = "</div>" }</script>'));
  assert.ok(out.includes('<textarea>  t  </textarea>'));
  assert.equal(minifyHtml(doc), src);
  assert.equal(doc.elementCount, 5);
});

test('minify collapses whitespace between tags and inside text', () => {
  const out = minifyHtml(parseHtml('<div>\n   <p>  some    text  </p>\n   <span> a </span>\n</div>\n'));
  assert.equal(out, '<div><p>some text</p><span> a </span></div>');
});

test('minify strips comments by default, keeps them with keepComments, always keeps conditional comments', () => {
  const src = '<!--[if IE]><p>ie</p><![endif]--><!-- gone --><div>x</div>';
  assert.equal(runHtml(src, ctx({}, false)).output, '<!--[if IE]><p>ie</p><![endif]--><div>x</div>');
  assert.equal(runHtml(src, ctx({ keepComments: true }, false)).output, src);
});

test('unclosed non-void tag and stray closing tag are notes with line numbers', () => {
  const r = runHtml('<div>\n<section>\n<p>x</p>\n</span>\n', ctx());
  assert.equal(r.error, undefined);
  assert.ok(r.notes?.some((n) => n === 'Unclosed <section> at line 2'), JSON.stringify(r.notes));
  assert.ok(r.notes?.some((n) => n === 'Unclosed <div> at line 1'));
  assert.ok(r.notes?.some((n) => /Stray closing tag <\/span> at line 4/.test(n)));
});

test('mismatched nesting is a note by default and an error with strict', () => {
  const src = '<div>\n<b><i>x</b></i>\n</div>';
  const lenient = runHtml(src, ctx());
  assert.equal(lenient.error, undefined);
  assert.ok(lenient.notes?.some((n) => /Unclosed <i> at line 2/.test(n)));
  assert.equal(lenient.output, '<div><b><i>x</i></b></div>');
  const strict = runHtml(src, ctx({ strict: true }));
  assert.ok(strict.error);
  assert.equal(strict.error?.line, 2);
  assert.equal(strict.error?.col, 8);
  assert.match(strict.error?.message ?? '', /<i>.*still open/);
  assert.match(strict.status ?? '', /^Invalid HTML · line 2, col 8/);
});

test('self-closing non-void element is treated as closed', () => {
  const doc = parseHtml('<svg><path d="M0 0"/><circle r="1" /></svg>');
  assert.deepEqual(doc.notes, []);
  assert.equal(formatHtml(doc), '<svg>\n  <path d="M0 0" />\n  <circle r="1" />\n</svg>');
});

test('formatHtml is idempotent', () => {
  const once = formatHtml(parseHtml(htmlMode.sample));
  assert.equal(formatHtml(parseHtml(once)), once);
});

test('a lone < in text and an unterminated comment are tolerated', () => {
  const doc = parseHtml('<p>1 < 2</p><!-- open');
  assert.equal(doc.elementCount, 1);
  assert.equal(formatHtml(doc), '<p>1 < 2</p>\n<!-- open-->');
  assert.ok(doc.notes.some((n) => /Unterminated comment at line 1/.test(n)));
});
