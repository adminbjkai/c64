import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHtml } from '../src/lib/html.js';
import { htmlToMarkdown } from '../src/lib/html-to-markdown.js';
import { parseMarkdown, toHtml } from '../src/lib/markdown.js';
import { runHtmlToMarkdown, htmlToMarkdownMode } from '../src/modes/html-to-markdown.js';

const ctx = (options: Record<string, unknown> = {}) => ({ pretty: false, options });
const md = (html: string, opts: Record<string, unknown> = {}) => runHtmlToMarkdown(html, ctx(opts)).output;

test('empty input is empty', () => {
  assert.deepEqual(runHtmlToMarkdown('', ctx()), { output: '', status: '' });
  assert.deepEqual(runHtmlToMarkdown('  \n', ctx()), { output: '', status: '' });
});

test('sample converts without error and reports blocks and links', () => {
  const r = runHtmlToMarkdown(htmlToMarkdownMode.sample, ctx());
  assert.equal(r.error, undefined);
  assert.match(r.output, /^# Release notes\n\nVersion \*\*2\.0\*\* is \*out\* — see the \[changelog\]\(https:\/\/example\.com\/changelog "Changelog"\)\./);
  assert.match(r.status!, /^\d+ blocks · 1 link · 1 image$/);
});

test('headings: ATX by default, setext for h1/h2 when atxHeadings is off', () => {
  const html = '<h1>Title</h1><h2>Sub</h2><h3>Third</h3><h6>Six</h6>';
  assert.equal(md(html), '# Title\n\n## Sub\n\n### Third\n\n###### Six');
  assert.equal(md(html, { atxHeadings: false }), 'Title\n=====\n\nSub\n---\n\n### Third\n\n###### Six');
});

test('inline formatting: strong, em, del, code, br, emphasis marker option', () => {
  assert.equal(md('<p>a <strong>b</strong> <b>c</b> <em>d</em> <i>e</i> <del>f</del> <s>g</s> <code>h()</code></p>'), 'a **b** **c** *d* *e* ~~f~~ ~~g~~ `h()`');
  assert.equal(md('<p><em>x</em></p>', { emphasis: '_' }), '_x_');
  assert.equal(md('<p>line one<br>line two<br/>three</p>'), 'line one  \nline two  \nthree');
  // Whitespace inside emphasis moves outside the delimiters.
  assert.equal(md('<p>a<strong> b </strong>c</p>'), 'a **b** c');
  // Backticks inside code spans grow the fence.
  assert.equal(md('<p><code>a ` b</code></p>'), '``a ` b``');
});

test('links: inline with title, reference style, bare href when empty text', () => {
  const html = '<p>See <a href="https://x.io/a" title="A">A</a> and <a href="https://x.io/b">B</a> and <a href="https://x.io/a" title="A">A again</a>.</p>';
  assert.equal(md(html), 'See [A](https://x.io/a "A") and [B](https://x.io/b) and [A again](https://x.io/a "A").');
  assert.equal(md(html, { referenceLinks: true }), 'See [A][1] and [B][2] and [A again][1].\n\n[1]: https://x.io/a "A"\n[2]: https://x.io/b');
  assert.equal(md('<p><a href="https://x.io">https://x.io</a></p>'), '[https://x.io](https://x.io)');
  assert.equal(md('<p><a name="anchor">plain</a></p>'), 'plain');
  assert.equal(md('<p><a href="/a b">sp</a></p>'), '[sp](</a b>)');
});

test('images with alt and title; images inside links', () => {
  assert.equal(md('<p><img src="/logo.png" alt="Logo" title="The logo"></p>'), '![Logo](/logo.png "The logo")');
  assert.equal(md('<p><a href="/"><img src="/l.png" alt="L"></a></p>'), '[![L](/l.png)](/)');
  assert.equal(md('<p><img alt="no src"></p>'), 'no src');
  const r = runHtmlToMarkdown('<p><img src="/a.png" alt="a"><img src="/b.png" alt="b"></p>', ctx());
  assert.match(r.status!, /2 images/);
});

test('lists: nested, ordered with start, bullet option, tight vs loose', () => {
  const html = '<ul><li>one<ul><li>one.a</li><li>one.b</li></ul></li><li>two</li></ul>';
  assert.equal(md(html), '- one\n  - one.a\n  - one.b\n- two');
  assert.equal(md(html, { bullet: '*' }), '* one\n  * one.a\n  * one.b\n* two');
  assert.equal(md(html, { bullet: '+' }), '+ one\n  + one.a\n  + one.b\n+ two');
  assert.equal(md('<ol start="3"><li>c</li><li>d</li></ol>'), '3. c\n4. d');
  assert.equal(md('<ol><li>a<ol><li>a.1</li></ol></li></ol>'), '1. a\n   1. a.1');
  assert.equal(md('<ul><li><p>para one</p><p>para two</p></li><li><p>second</p></li></ul>'), '- para one\n\n  para two\n\n- second');
});

test('task list checkboxes', () => {
  assert.equal(md('<ul><li><input type="checkbox" checked> done</li><li><input type="checkbox"> todo</li></ul>'), '- [x] done\n- [ ] todo');
  assert.equal(md('<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" disabled="" checked="">Shipped</li></ul>'), '- [x] Shipped');
});

test('blockquotes nest and hold multiple blocks', () => {
  assert.equal(md('<blockquote><p>one</p><p>two</p></blockquote>'), '> one\n>\n> two');
  assert.equal(md('<blockquote><p>outer</p><blockquote><p>inner</p></blockquote></blockquote>'), '> outer\n>\n> > inner');
  assert.equal(md('<blockquote>bare text</blockquote>'), '> bare text');
});

test('code blocks: fenced with language from class, entities decoded, verbatim whitespace', () => {
  assert.equal(md('<pre><code class="language-js">const x = 1;\n  if (x &lt; 2) {}\n</code></pre>'), '```js\nconst x = 1;\n  if (x < 2) {}\n```');
  assert.equal(md('<pre><code class="lang-python">print(1)</code></pre>'), '```python\nprint(1)\n```');
  assert.equal(md('<pre>plain   pre\n\ttab</pre>'), '```\nplain   pre\n\ttab\n```');
  // Content with a triple backtick gets a longer fence.
  assert.equal(md('<pre><code>```\nx\n```</code></pre>'), '````\n```\nx\n```\n````');
  assert.equal(md("<pre><code class='highlight language-c++'>int</code></pre>"), '```c++\nint\n```');
});

test('tables: GFM with alignment from align attribute and style, newlines become <br>, pipes escaped', () => {
  const html = '<table><thead><tr><th>Name</th><th align="right">Size</th><th style="text-align:center">Note</th></tr></thead><tbody><tr><td>a.txt</td><td align="right">12 KB</td><td style="text-align: center">x | y</td></tr><tr><td>b</td><td>1</td><td>line<br>two</td></tr></tbody></table>';
  assert.equal(md(html), ['| Name  | Size  | Note        |', '| ----- | ----: | :---------: |', '| a.txt | 12 KB | x \\| y      |', '| b     | 1     | line<br>two |'].join('\n'));
  // No thead: first row becomes the header.
  assert.equal(md('<table><tr><td>h1</td><td>h2</td></tr><tr><td>1</td><td>2</td></tr></table>'), '| h1  | h2  |\n| --- | --- |\n| 1   | 2   |');
  assert.equal(md('<table></table>'), '');
});

test('definition lists, horizontal rules, containers unwrapped, dropped elements', () => {
  assert.equal(md('<dl><dt>Term</dt><dd>Definition one</dd><dt>Other</dt><dd>Def two</dd></dl>'), '**Term**  \n  Definition one  \n**Other**  \n  Def two');
  assert.equal(md('<p>a</p><hr><p>b</p>'), 'a\n\n---\n\nb');
  assert.equal(md('<html><head><title>T</title><style>p{}</style></head><body><nav>menu</nav><div><section><p>content</p></section></div><aside>side</aside><script>x()</script></body></html>'), 'content');
  assert.equal(md('<div>loose text<p>para</p>more</div>'), 'loose text\n\npara\n\nmore');
  assert.equal(md('<!-- comment --><!doctype html><p>x</p>'), 'x');
});

test('unknown elements: unwrapped by default, kept as raw HTML with keepUnknownHtml', () => {
  const html = '<custom-block data-x="1"><p>inner</p></custom-block><p>a <kbd>Ctrl</kbd> <mark>hi</mark> <foo>bar</foo></p>';
  assert.equal(md(html), 'inner\n\na `Ctrl` hi bar');
  assert.equal(md(html, { keepUnknownHtml: true }), '<custom-block data-x="1">\ninner\n</custom-block>\n\na `Ctrl` hi <foo>bar</foo>');
});

test('entities are decoded and markdown-significant characters escaped', () => {
  assert.equal(md('<p>Fish &amp; chips &lt; 5&euro; &copy; &#169; &#x1F600;</p>'), 'Fish & chips < 5€ © © 😀');
  assert.equal(md('<p>2 * 3 = 6, a_b, _c_, [x], `y`, ~~z~~</p>'), '2 \\* 3 = 6, a_b, \\_c\\_, \\[x\\], \\`y\\`, \\~~z\\~~');
  assert.equal(md('<p># not a heading</p><p>- not a list</p><p>1. nor this</p><p>&gt; nor a quote</p>'), '\\# not a heading\n\n\\- not a list\n\n\\1. nor this\n\n\\> nor a quote');
  assert.equal(md('<p><a href="/x?a=1&amp;b=2">q</a></p>'), '[q](/x?a=1&b=2)');
});

test('whitespace collapses like a browser', () => {
  assert.equal(md('<p>\n   hello\n\n   <b>big</b>   world \t !\n</p>'), 'hello **big** world !');
  assert.equal(md('<ul>\n  <li>\n    one\n  </li>\n  <li>two</li>\n</ul>'), '- one\n- two');
  assert.equal(md('<p>a</p>\n\n\n\n<p>b</p>'), 'a\n\nb');
  assert.equal(md('<div>\n  <span> x </span>\n</div>'), 'x');
  assert.equal(md('<p>tabs\t\tand\nnewlines</p>'), 'tabs and newlines');
});

test('notes surface parser tolerance (unclosed tags) without failing', () => {
  const r = runHtmlToMarkdown('<p>open <b>bold', ctx());
  assert.equal(r.error, undefined);
  assert.equal(r.output, 'open **bold**');
  assert.ok(r.notes?.some((n) => /Unclosed <b>/.test(n)));
});

test('round trip: markdown → toHtml → html-to-markdown reproduces the fixture', () => {
  const fixture = [
    '# Title',
    '',
    'Intro with **bold**, *em*, ~~del~~, `code` and a [link](https://x.io "T") plus ![img](https://x.io/i.png).',
    '',
    '## Lists',
    '',
    '- one',
    '- two',
    '  - nested',
    '- [x] done',
    '- [ ] todo',
    '',
    '3. three',
    '4. four',
    '',
    '> quoted text',
    '',
    '```js',
    'const a = 1;',
    '```',
    '',
    '| Col | Num |',
    '| --- | --: |',
    '| a   |   1 |',
    '',
    '---',
    '',
    'Last line  ',
    'after break.',
  ].join('\n');
  const html = toHtml(parseMarkdown(fixture).blocks);
  const back = htmlToMarkdown(parseHtml(html)).markdown;
  const norm = (s: string) => s.replace(/[ \t]+$/gm, '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').replace(/\| -+ \| -+: \|/, '|---|---:|').replace(/\|\s*/g, '|').replace(/\s*\|/g, '|').trim();
  assert.equal(norm(back), norm(fixture));
  // And it is stable: converting the round-tripped markdown again yields the same text.
  const again = htmlToMarkdown(parseHtml(toHtml(parseMarkdown(back).blocks))).markdown;
  assert.equal(again, back);
});
