import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, toHtml, toPlain, minifyHtml, safeHref, safeSrc, type Block } from '../src/lib/markdown.js';
import { runMarkdown, markdownMode, countWords } from '../src/modes/markdown.js';

const html = (md: string) => toHtml(parseMarkdown(md).blocks);
const ctx = (pretty = true, options: Record<string, unknown> = {}) => ({ pretty, options });

test('ATX and setext headings', () => {
  assert.equal(html('# One'), '<h1>One</h1>');
  assert.equal(html('### Three ###'), '<h3>Three</h3>');
  assert.equal(html('####### seven'), '<p>####### seven</p>');
  assert.equal(html('Title\n====='), '<h1>Title</h1>');
  assert.equal(html('Sub\n---'), '<h2>Sub</h2>');
});

test('paragraphs, soft and hard breaks', () => {
  assert.equal(html('a\nb'), '<p>a\nb</p>');
  assert.equal(html('a  \nb'), '<p>a<br>\nb</p>');
  assert.equal(html('a\\\nb'), '<p>a<br>\nb</p>');
  assert.equal(html('p1\n\np2'), '<p>p1</p>\n<p>p2</p>');
});

test('emphasis, strong, strikethrough, mixed and underscores', () => {
  assert.equal(html('*em* _em_ **st** __st__ ~~del~~'), '<p><em>em</em> <em>em</em> <strong>st</strong> <strong>st</strong> <del>del</del></p>');
  assert.equal(html('***both***'), '<p><em><strong>both</strong></em></p>');
  assert.equal(html('snake_case_word'), '<p>snake_case_word</p>');
  assert.equal(html('a * b * c'), '<p>a * b * c</p>');
  assert.equal(html('**bold *nested em* bold**'), '<p><strong>bold <em>nested em</em> bold</strong></p>');
});

test('inline code and escapes', () => {
  assert.equal(html('use `a*b`'), '<p>use <code>a*b</code></p>');
  assert.equal(html('`` a`b ``'), '<p><code>a`b</code></p>');
  assert.equal(html('\\*not em\\*'), '<p>*not em*</p>');
  assert.equal(html('unclosed `tick'), '<p>unclosed `tick</p>');
});

test('fenced and indented code blocks', () => {
  assert.equal(html('```js\nlet x = 1 < 2;\n```'), '<pre><code class="language-js">let x = 1 &lt; 2;\n</code></pre>');
  assert.equal(html('~~~\nplain\n~~~'), '<pre><code>plain\n</code></pre>');
  assert.equal(html('    indented\n    code'), '<pre><code>indented\ncode\n</code></pre>');
  assert.equal(html('```\nunterminated'), '<pre><code>unterminated\n</code></pre>');
});

test('blockquotes nest and accept lazy continuation', () => {
  assert.equal(html('> a\n> b'), '<blockquote>\n<p>a\nb</p>\n</blockquote>');
  assert.equal(html('> outer\n>> inner'), '<blockquote>\n<p>outer</p>\n<blockquote>\n<p>inner</p>\n</blockquote>\n</blockquote>');
  assert.equal(html('> lazy\ncontinued'), '<blockquote>\n<p>lazy\ncontinued</p>\n</blockquote>');
});

test('unordered, ordered (with start), nested and task lists', () => {
  assert.equal(html('- a\n- b'), '<ul>\n<li>a</li>\n<li>b</li>\n</ul>');
  assert.equal(html('3. a\n4. b'), '<ol start="3">\n<li>a</li>\n<li>b</li>\n</ol>');
  assert.equal(html('- a\n  - b\n- c'), '<ul>\n<li>a\n<ul>\n<li>b</li>\n</ul></li>\n<li>c</li>\n</ul>');
  assert.equal(html('- [x] done\n- [ ] todo'), '<ul>\n<li class="task"><input type="checkbox" disabled checked> done</li>\n<li class="task"><input type="checkbox" disabled> todo</li>\n</ul>');
  // loose list wraps items in <p>
  assert.equal(html('- a\n\n- b'), '<ul>\n<li>\n<p>a</p>\n</li>\n<li>\n<p>b</p>\n</li>\n</ul>');
  // "* * *" is a rule, not a list
  assert.equal(html('* * *'), '<hr>');
  assert.equal(html('a\n---\nb'), '<h2>a</h2>\n<p>b</p>');
});

test('links, titles, autolinks and images', () => {
  assert.equal(html('[t](https://x.y "T")'), '<p><a href="https://x.y" title="T" rel="noopener">t</a></p>');
  assert.equal(html('<https://a.b/c?d=1>'), '<p><a href="https://a.b/c?d=1" rel="noopener">https://a.b/c?d=1</a></p>');
  assert.equal(html('<me@example.com>'), '<p><a href="mailto:me@example.com" rel="noopener">me@example.com</a></p>');
  assert.equal(html('![alt *x*](https://i.mg/p.png "cap")'), '<p><img src="https://i.mg/p.png" alt="alt x" title="cap"></p>');
  assert.equal(html('[not a link]'), '<p>[not a link]</p>');
  assert.equal(html('[**b**](mailto:a@b.c)'), '<p><a href="mailto:a@b.c" rel="noopener"><strong>b</strong></a></p>');
});

test('unsafe schemes are dropped: javascript:, data: on links, non-image data: on images', () => {
  assert.equal(html('[x](javascript:alert(1))'), '<p>x</p>');
  assert.equal(html('[x](data:text/html,hi)'), '<p>x</p>');
  assert.equal(html('![a](javascript:alert(1))'), '<p>a</p>');
  assert.equal(html('![a](data:image/png;base64,AAAA)'), '<p><img src="data:image/png;base64,AAAA" alt="a"></p>');
  assert.equal(safeHref(' JAVASCRIPT:x'), null);
  assert.equal(safeHref('https://ok'), 'https://ok');
  assert.equal(safeSrc('http://ok/i.png'), 'http://ok/i.png');
  assert.equal(safeSrc('data:text/html,x'), null);
});

test('raw HTML and <script> are escaped as text, and noted', () => {
  const doc = parseMarkdown('hi <script>alert(1)</script> <b>x</b>');
  const out = toHtml(doc.blocks);
  assert.equal(out, '<p>hi &lt;script&gt;alert(1)&lt;/script&gt; &lt;b&gt;x&lt;/b&gt;</p>');
  assert.ok(!out.includes('<script'));
  assert.ok(doc.notes.some((n) => n.includes('<script>')));
  assert.equal(html('a "quoted" & <'), '<p>a &quot;quoted&quot; &amp; &lt;</p>');
  assert.equal(html('[x](https://a.b/?q="><img>)'), '<p>x</p>');
});

test('GFM tables with alignment, escaped pipes and ragged rows', () => {
  const out = html('| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |\n| x \\| y | *e* |');
  assert.equal(
    out,
    '<table>\n<thead>\n<tr><th align="left">a</th><th align="center">b</th><th align="right">c</th></tr>\n</thead>\n<tbody>\n<tr><td align="left">1</td><td align="center">2</td><td align="right">3</td></tr>\n<tr><td align="left">x | y</td><td align="center"><em>e</em></td><td align="right"></td></tr>\n</tbody>\n</table>',
  );
  assert.equal(html('a | b\n--|--'), '<table>\n<thead>\n<tr><th>a</th><th>b</th></tr>\n</thead>\n</table>');
  assert.equal(html('a | b\nc | d'), '<p>a | b\nc | d</p>');
});

test('horizontal rules', () => {
  assert.equal(html('---'), '<hr>');
  assert.equal(html('___'), '<hr>');
  assert.equal(html('- - -'), '<hr>');
});

test('toPlain', () => {
  const blocks = parseMarkdown('# T\n\nHello **world** [l](https://x)\n\n- a\n- [x] b\n\n> q\n\n| h | i |\n|--|--|\n| 1 | 2 |').blocks;
  assert.equal(toPlain(blocks), 'T\n\nHello world l\n\n- a\n- [x] b\n\n> q\n\nh | i\n1 | 2');
});

test('minifyHtml collapses between tags but keeps <pre> content', () => {
  const src = '<h1>a</h1>\n<pre><code>x\n  y\n</code></pre>\n<p>b\nc</p>';
  assert.equal(minifyHtml(src), '<h1>a</h1><pre><code>x\n  y\n</code></pre><p>b c</p>');
});

test('runMarkdown: sample, pretty/raw, status, notes, showHtml, empty', () => {
  assert.deepEqual(runMarkdown('', ctx()), { output: '', status: '' });
  const r = runMarkdown(markdownMode.sample, ctx());
  assert.equal(r.error, undefined);
  assert.equal(r.view?.kind, 'markdown');
  assert.match(r.status ?? '', /^\d+ blocks · 2 headings · \d+ words$/);
  assert.ok(r.notes?.some((n) => n.includes('<div>')));
  assert.ok(r.output.includes('\n'));
  const raw = runMarkdown(markdownMode.sample, ctx(false));
  assert.ok(!raw.output.replace(/<pre>[\s\S]*?<\/pre>/g, '').includes('\n'));
  assert.equal((raw.view?.data as { showHtml: boolean }).showHtml, false);
  assert.equal((runMarkdown('x', ctx(true, { showHtml: true })).view?.data as { showHtml: boolean }).showHtml, true);
  assert.equal(runMarkdown('one two', ctx()).status, '1 block · 0 headings · 2 words');
});

test('countWords and AST shape', () => {
  assert.equal(countWords("it's a well-known thing, 3.14 times"), 6);
  const b = parseMarkdown('## x').blocks[0] as Block;
  assert.deepEqual(b, { type: 'heading', level: 2, children: [{ type: 'text', text: 'x' }] });
});
