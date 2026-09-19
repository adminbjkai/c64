/**
 * HTML → Markdown mode: parses HTML with the tolerant parser from
 * src/lib/html.ts and emits GitHub Flavored Markdown.
 */

import { type ToolMode, type ModeResult, type RunContext } from './types.js';
import { parseHtml } from '../lib/html.js';
import { htmlToMarkdown, type HtmlToMarkdownOptions } from '../lib/html-to-markdown.js';

export function runHtmlToMarkdown(input: string, ctx: RunContext): ModeResult {
  if (input.trim() === '') return { output: '', status: '' };
  const o = ctx.options;
  const opts: HtmlToMarkdownOptions = {
    bullet: o['bullet'] === '*' || o['bullet'] === '+' ? o['bullet'] : '-',
    emphasis: o['emphasis'] === '_' ? '_' : '*',
    atxHeadings: o['atxHeadings'] !== false,
    referenceLinks: o['referenceLinks'] === true,
    keepUnknownHtml: o['keepUnknownHtml'] === true,
  };
  try {
    const doc = parseHtml(input);
    const r = htmlToMarkdown(doc, opts);
    const parts = [`${r.blocks} block${r.blocks === 1 ? '' : 's'}`, `${r.links} link${r.links === 1 ? '' : 's'}`];
    if (r.images) parts.push(`${r.images} image${r.images === 1 ? '' : 's'}`);
    return { output: r.markdown, status: parts.join(' · '), notes: doc.notes.length ? doc.notes : undefined };
  } catch (e) {
    return { output: '', error: { message: (e as Error).message ?? String(e) }, status: 'Conversion failed' };
  }
}

export const htmlToMarkdownMode: ToolMode = {
  id: 'html-to-markdown',
  label: 'HTML → Markdown',
  description: 'Convert HTML to GitHub Flavored Markdown — headings, lists, tables, code blocks, links and images.',
  category: 'Text',
  icon: 'markdown',
  keywords: ['html', 'markdown', 'md', 'convert', 'gfm', 'turndown', 'export'],
  emptyHint: 'Paste HTML — a fragment or a whole page — to get GitHub Flavored Markdown.',
  sample: `<article>
  <h1>Release notes</h1>
  <p>Version <strong>2.0</strong> is <em>out</em> &mdash; see the <a href="https://example.com/changelog" title="Changelog">changelog</a>.</p>
  <h2>Highlights</h2>
  <ul>
    <li>Faster <code>parse()</code></li>
    <li>Nested lists
      <ol start="3">
        <li>third</li>
        <li>fourth</li>
      </ol>
    </li>
    <li><input type="checkbox" checked> Task done</li>
  </ul>
  <pre><code class="language-js">const x = 1;
console.log(x);</code></pre>
  <table>
    <thead><tr><th>Name</th><th align="right">Size</th></tr></thead>
    <tbody><tr><td>a.txt</td><td align="right">12 KB</td></tr></tbody>
  </table>
  <blockquote><p>Line one<br>line two</p></blockquote>
  <hr>
  <p><img src="https://example.com/logo.png" alt="Logo"></p>
</article>`,
  supportsPretty: false,
  controls: [
    {
      kind: 'select',
      key: 'bullet',
      label: 'Bullet',
      default: '-',
      options: [
        { value: '-', label: '-' },
        { value: '*', label: '*' },
        { value: '+', label: '+' },
      ],
    },
    {
      kind: 'select',
      key: 'emphasis',
      label: 'Emphasis',
      default: '*',
      options: [
        { value: '*', label: '*em*' },
        { value: '_', label: '_em_' },
      ],
    },
    { kind: 'toggle', key: 'atxHeadings', label: 'ATX headings', default: true },
    { kind: 'toggle', key: 'referenceLinks', label: 'Reference links', default: false },
    { kind: 'toggle', key: 'keepUnknownHtml', label: 'Keep unknown HTML', default: false },
  ],
  run: runHtmlToMarkdown,
};
