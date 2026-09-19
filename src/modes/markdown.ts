/**
 * Markdown Preview mode. Pretty = the rendered HTML (indented, one block per
 * line); Raw = the same HTML minified onto one line. The view renders the
 * preview from the HTML our own escaping renderer produced, re-sanitised.
 */

import { type ToolMode, type ModeResult, type RunContext } from './types.js';
import { parseMarkdown, toHtml, toPlain, minifyHtml, countBlocks } from '../lib/markdown.js';

export interface MarkdownData {
  html: string;
  showHtml: boolean;
}

export function countWords(text: string): number {
  return (text.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu) ?? []).length;
}

export function runMarkdown(input: string, ctx: RunContext): ModeResult {
  if (input.trim() === '') return { output: '', status: '' };
  try {
    const doc = parseMarkdown(input);
    const html = toHtml(doc.blocks);
    const { blocks, headings } = countBlocks(doc.blocks);
    const words = countWords(toPlain(doc.blocks));
    const data: MarkdownData = { html, showHtml: ctx.options['showHtml'] === true };
    return {
      output: ctx.pretty ? html : minifyHtml(html),
      status: `${blocks} block${blocks === 1 ? '' : 's'} · ${headings} heading${headings === 1 ? '' : 's'} · ${words} word${words === 1 ? '' : 's'}`,
      notes: doc.notes.length ? doc.notes : undefined,
      view: { kind: 'markdown', data },
    };
  } catch (e) {
    return { output: '', error: { message: (e as Error).message }, status: 'Could not render Markdown' };
  }
}

export const markdownMode: ToolMode = {
  id: 'markdown',
  label: 'Markdown Preview',
  description: 'Render Markdown (CommonMark plus GFM tables and task lists) to a live preview and clean HTML.',
  category: 'Text',
  icon: 'markdown',
  keywords: ['md', 'commonmark', 'gfm', 'html', 'preview', 'render'],
  emptyHint: 'Paste Markdown to preview it. Pretty shows the HTML; Raw minifies it onto one line.',
  sample: `# Release notes

Shipped **2026-09-18** by the _tools_ team. See <https://example.com/changelog> or [the docs](https://example.com/docs "Documentation").

## Changes

- Faster \`diff\` engine
- Regex tester with named groups
  - nested item
- ~~Old exporter~~ removed

1. Unpack
2. Run \`npm test\`

- [x] Tests green
- [ ] Docs updated

> **Note:** raw HTML like <div> is shown as text.

| Feature | Status | Size |
|:--------|:------:|-----:|
| Diff    | done   | 4 KB |
| Regex   | done   | 3 KB |

\`\`\`ts
export const answer = 42;
\`\`\`

---

Line one with a hard break\\
line two.
`,
  outputLanguage: 'html',
  supportsPretty: true,
  controls: [{ kind: 'toggle', key: 'showHtml', label: 'Show HTML', default: false }],
  run: runMarkdown,
};
