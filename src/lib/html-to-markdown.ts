/**
 * html-to-markdown.ts — walks the tree from html.ts and emits GitHub
 * Flavored Markdown.
 *
 * What it implements
 * ------------------
 * - Blocks: h1–h6 (ATX, or setext for h1/h2), p, pre>code (fenced, language
 *   from `class="language-x"`), blockquote (nested), ul/ol (nested with
 *   marker-width indentation, `start`, task checkboxes from
 *   `<input type=checkbox>`), hr, table (GFM pipe table; alignment from
 *   `align` or `style="text-align:…"`; multi-line cells use `<br>`),
 *   dl (bold term, indented definition).
 * - Inlines: strong/b, em/i, del/s/strike, code (backtick run grows when the
 *   content has backticks), a (inline or reference-style), img, br (two
 *   trailing spaces). Other inline elements are unwrapped.
 * - Containers (div, section, article, main, header, footer, figure,
 *   details, body, html, …) are unwrapped. script/style/nav/aside/head/
 *   noscript/template/iframe are dropped entirely. Unknown elements are
 *   unwrapped unless `keepUnknownHtml`, in which case they are re-emitted as
 *   raw HTML around the converted content.
 * - Whitespace collapses like a browser (runs → one space, trimmed at block
 *   edges); entities are decoded via html-entities.ts; Markdown-significant
 *   characters in text are backslash-escaped.
 */

import { type HtmlDoc, type HtmlNode, type HtmlElement } from './html.js';
import { decodeEntities } from './html-entities.js';

export interface HtmlToMarkdownOptions {
  bullet?: '-' | '*' | '+';
  emphasis?: '*' | '_';
  atxHeadings?: boolean;
  referenceLinks?: boolean;
  keepUnknownHtml?: boolean;
}

export interface HtmlToMarkdownResult {
  markdown: string;
  blocks: number;
  links: number;
  images: number;
}

const DROP = new Set(['script', 'style', 'nav', 'aside', 'head', 'noscript', 'template', 'iframe', 'title', 'meta', 'link', 'base']);
const CONTAINERS = new Set([
  'html', 'body', 'div', 'section', 'article', 'main', 'header', 'footer', 'figure', 'figcaption', 'details', 'summary', 'form', 'fieldset', 'center', 'address', 'hgroup', 'menu', 'label',
]);
const INLINE_UNWRAP = new Set(['span', 'u', 'mark', 'small', 'big', 'sub', 'sup', 'abbr', 'cite', 'dfn', 'q', 'time', 'var', 'font', 'ins', 'bdi', 'bdo', 'data', 'ruby', 'rt', 'rp', 'wbr', 'button', 'label', 'select', 'option', 'textarea']);
const INLINE_KNOWN = new Set(['a', 'strong', 'b', 'em', 'i', 'del', 's', 'strike', 'code', 'kbd', 'samp', 'tt', 'img', 'br', 'input', ...INLINE_UNWRAP]);
const HEADINGS: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };

/** Sentinel for a hard line break inside an inline run; resolved by finishInline. */
const BR = '\u0001';

function attr(el: HtmlElement, name: string): string | null {
  const a = el.attrs.find((x) => x.name.toLowerCase() === name);
  return a ? (a.value === null ? '' : decodeEntities(a.value).text) : null;
}

function isInline(node: HtmlNode, keepUnknown: boolean): boolean {
  if (node.type === 'text') return true;
  if (node.type !== 'element') return false; // comments / directives are dropped; treat as block boundaries
  if (INLINE_KNOWN.has(node.name)) return true;
  if (HEADINGS[node.name] || CONTAINERS.has(node.name) || DROP.has(node.name)) return false;
  if (['p', 'pre', 'blockquote', 'ul', 'ol', 'li', 'hr', 'table', 'dl', 'dt', 'dd'].includes(node.name)) return false;
  // Unknown element: inline unless it contains block children.
  return node.children.every((c) => isInline(c, keepUnknown));
}

function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/([*`[\]])/g, '\\$1')
    .replace(/(^|[^\w])_|_(?=[^\w]|$)/g, (m) => m.replace('_', '\\_'))
    .replace(/~~/g, '\\~~')
    .replace(/<(?=[a-zA-Z/!])/g, '\\<');
}

function escapeLineStart(line: string): string {
  return /^(#{1,6}(\s|$)|>|[-+*](\s|$)|\d{1,9}[.)](\s|$)|\||(?:-{3,}|\*{3,}|_{3,})\s*$|=+\s*$)/.test(line) ? '\\' + line : line;
}

function serializeOpen(el: HtmlElement): string {
  let s = '<' + el.name;
  for (const a of el.attrs) s += a.value === null ? ` ${a.name}` : ` ${a.name}="${a.value.replace(/"/g, '&quot;')}"`;
  return s + '>';
}

export function htmlToMarkdown(doc: HtmlDoc, opts: HtmlToMarkdownOptions = {}): HtmlToMarkdownResult {
  const bullet = opts.bullet ?? '-';
  const em = opts.emphasis ?? '*';
  const atx = opts.atxHeadings !== false;
  const refLinks = opts.referenceLinks === true;
  const keepUnknown = opts.keepUnknownHtml === true;
  const refs: { href: string; title: string | null }[] = [];
  let blocks = 0;
  let links = 0;
  let images = 0;

  /* ------------------------------------------------------------ inline */

  const wrap = (inner: string, open: string, close = open): string => {
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
    const core = m[2]!;
    if (core === '') return inner;
    return `${m[1]}${open}${core}${close}${m[3]}`;
  };

  const codeSpan = (text: string): string => {
    const t = text.replace(/\s+/g, ' ');
    const runs = t.match(/`+/g) ?? [];
    const longest = runs.reduce((n, r) => Math.max(n, r.length), 0);
    const fence = '`'.repeat(longest + 1);
    const pad = t.startsWith('`') || t.endsWith('`') || (t.startsWith(' ') && t.endsWith(' ') && t.trim() !== '') ? ' ' : '';
    return `${fence}${pad}${t}${pad}${fence}`;
  };

  const inlineEl = (el: HtmlElement): string => {
    switch (el.name) {
      case 'br':
        return BR;
      case 'strong':
      case 'b':
        return wrap(inline(el.children), '**');
      case 'em':
      case 'i':
        return wrap(inline(el.children), em);
      case 'del':
      case 's':
      case 'strike':
        return wrap(inline(el.children), '~~');
      case 'code':
      case 'kbd':
      case 'samp':
      case 'tt':
        return codeSpan(rawInlineText(el.children));
      case 'a': {
        const href = attr(el, 'href');
        const inner = inline(el.children);
        if (href === null || href.trim() === '') return inner;
        links++;
        const title = attr(el, 'title');
        const text = inner.trim() === '' ? href : inner;
        if (refLinks) {
          let idx = refs.findIndex((r) => r.href === href && r.title === title);
          if (idx < 0) idx = refs.push({ href, title }) - 1;
          return wrap(text, '[', `][${idx + 1}]`);
        }
        return wrap(text, '[', `](${linkDest(href)}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`);
      }
      case 'img': {
        const src = attr(el, 'src') ?? '';
        const alt = attr(el, 'alt') ?? '';
        if (src === '') return escapeText(alt);
        images++;
        const title = attr(el, 'title');
        return `![${alt.replace(/([[\]])/g, '\\$1')}](${linkDest(src)}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`;
      }
      case 'input': {
        if ((attr(el, 'type') ?? '').toLowerCase() === 'checkbox') return attr(el, 'checked') !== null ? '[x] ' : '[ ] ';
        return '';
      }
      default:
        if (INLINE_UNWRAP.has(el.name) || !keepUnknown) return inline(el.children);
        return serializeOpen(el) + inline(el.children) + `</${el.name}>`;
    }
  };

  const linkDest = (url: string): string => {
    const u = url.trim();
    return /[\s()]/.test(u) ? `<${u}>` : u;
  };

  /** Text content only (for code spans): entities decoded, no escaping. */
  const rawInlineText = (nodes: HtmlNode[]): string => {
    let s = '';
    for (const n of nodes) {
      if (n.type === 'text') s += decodeEntities(n.text).text;
      else if (n.type === 'element') s += n.rawText !== undefined ? decodeEntities(n.rawText).text : rawInlineText(n.children);
    }
    return s;
  };

  const inline = (nodes: HtmlNode[]): string => {
    let s = '';
    for (const n of nodes) {
      if (n.type === 'text') s += escapeText(decodeEntities(n.text).text.replace(/[ \t\r\n\f]+/g, ' '));
      else if (n.type === 'element') {
        if (DROP.has(n.name)) continue;
        s += inlineEl(n);
      }
    }
    return s.replace(/ {2,}/g, ' ');
  };

  /** Finish an inline run into paragraph text: trim, resolve <br>, escape line starts. */
  const finishInline = (s: string): string => {
    const t = s.replace(/ {2,}/g, ' ').replace(/ *\u0001 */g, BR).replace(/^[ \u0001]+|[ \u0001]+$/g, '');
    return t
      .split(BR)
      .map((line) => escapeLineStart(line.trim()))
      .join('  \n');
  };

  /* ------------------------------------------------------------ blocks */

  const indentLines = (text: string, first: string, rest: string): string =>
    text
      .split('\n')
      .map((l, i) => (i === 0 ? first + l : l === '' ? '' : rest + l))
      .join('\n');

  const renderPre = (el: HtmlElement): string => {
    let text = el.rawText ?? rawInlineText(el.children);
    let lang = '';
    const m = /^\s*<code\b([^>]*)>([\s\S]*?)<\/code>\s*$/i.exec(text);
    if (m) {
      const cls = /class\s*=\s*["']?([^"'>]*)/i.exec(m[1]!);
      const lm = cls ? /(?:^|\s)(?:language|lang)-([\w+#.-]+)/.exec(cls[1]!) : null;
      lang = lm ? lm[1]! : '';
      text = m[2]!;
    } else {
      const cls = attr(el, 'class') ?? '';
      const lm = /(?:^|\s)(?:language|lang)-([\w+#.-]+)/.exec(cls);
      lang = lm ? lm[1]! : '';
    }
    text = decodeEntities(text).text.replace(/\r\n?/g, '\n').replace(/^\n/, '').replace(/\n$/, '');
    const runs = text.match(/`{3,}/g) ?? [];
    const fence = '`'.repeat(Math.max(3, ...runs.map((r) => r.length + 1)));
    return `${fence}${lang}\n${text}\n${fence}`;
  };

  const listItems = (list: HtmlElement, ordered: boolean): string => {
    const items = list.children.filter((c): c is HtmlElement => c.type === 'element' && c.name === 'li');
    const startAttr = attr(list, 'start');
    const start = ordered && startAttr !== null && /^\d+$/.test(startAttr) ? Number(startAttr) : 1;
    const tight = !items.some((li) => li.children.some((c) => c.type === 'element' && c.name === 'p'));
    const out: string[] = [];
    items.forEach((li, i) => {
      const marker = ordered ? `${start + i}. ` : `${bullet} `;
      const pad = ' '.repeat(marker.length);
      const body = renderBlocks(li.children, tight ? '\n' : '\n\n');
      out.push(indentLines(body === '' ? '' : body, marker, pad).replace(/\s+$/, ''));
    });
    return out.join(tight ? '\n' : '\n\n');
  };

  const cellText = (cell: HtmlElement): string => {
    const saved = blocks;
    const t = renderBlocks(cell.children, '\n');
    blocks = saved;
    return t.replace(/ {2}\n|\n/g, '<br>').replace(/\|/g, '\\|');
  };

  const cellAlign = (cell: HtmlElement): 'left' | 'center' | 'right' | null => {
    const a = (attr(cell, 'align') ?? '').toLowerCase();
    if (a === 'left' || a === 'center' || a === 'right') return a;
    const m = /text-align\s*:\s*(left|center|right)/i.exec(attr(cell, 'style') ?? '');
    return m ? (m[1]!.toLowerCase() as 'left' | 'center' | 'right') : null;
  };

  const renderTable = (table: HtmlElement): string => {
    const rows: HtmlElement[] = [];
    const collect = (nodes: HtmlNode[]) => {
      for (const n of nodes) {
        if (n.type !== 'element') continue;
        if (n.name === 'tr') rows.push(n);
        else if (n.name === 'thead' || n.name === 'tbody' || n.name === 'tfoot') collect(n.children);
      }
    };
    collect(table.children);
    if (rows.length === 0) return '';
    const cellsOf = (tr: HtmlElement) => tr.children.filter((c): c is HtmlElement => c.type === 'element' && (c.name === 'td' || c.name === 'th'));
    const grid = rows.map(cellsOf).filter((r) => r.length > 0);
    if (grid.length === 0) return '';
    const cols = Math.max(...grid.map((r) => r.length));
    const align: ('left' | 'center' | 'right' | null)[] = [];
    for (let c = 0; c < cols; c++) {
      let a: 'left' | 'center' | 'right' | null = null;
      for (const r of grid) {
        const cell = r[c];
        if (cell) {
          a = cellAlign(cell);
          if (a) break;
        }
      }
      align.push(a);
    }
    const text = grid.map((r) => Array.from({ length: cols }, (_, c) => (r[c] ? cellText(r[c]!) : '')));
    const widths = Array.from({ length: cols }, (_, c) => Math.max(3, ...text.map((r) => r[c]!.length)));
    const line = (cells: string[]) => '| ' + cells.map((t, c) => t.padEnd(widths[c]!)).join(' | ') + ' |';
    const sep = '| ' + align.map((a, c) => {
      const w = widths[c]!;
      if (a === 'center') return ':' + '-'.repeat(w - 2) + ':';
      if (a === 'right') return '-'.repeat(w - 1) + ':';
      if (a === 'left') return ':' + '-'.repeat(w - 1);
      return '-'.repeat(w);
    }).join(' | ') + ' |';
    return [line(text[0]!), sep, ...text.slice(1).map(line)].join('\n');
  };

  const renderDl = (dl: HtmlElement): string => {
    const parts: string[] = [];
    for (const c of dl.children) {
      if (c.type !== 'element') continue;
      if (c.name === 'dt') parts.push(`**${finishInline(inline(c.children))}**`);
      else if (c.name === 'dd') parts.push(indentLines(renderBlocks(c.children, '\n'), '  ', '  '));
    }
    return parts.join('  \n');
  };

  const renderBlockEl = (el: HtmlElement): string | null => {
    if (DROP.has(el.name)) return null;
    const level = HEADINGS[el.name];
    if (level) {
      blocks++;
      const text = finishInline(inline(el.children)).replace(/ {2}\n/g, ' ');
      if (!atx && level <= 2) return `${text}\n${(level === 1 ? '=' : '-').repeat(Math.max(3, text.length))}`;
      return `${'#'.repeat(level)} ${text}`;
    }
    switch (el.name) {
      case 'p': {
        const t = finishInline(inline(el.children));
        if (t === '') return null;
        blocks++;
        return t;
      }
      case 'pre':
        blocks++;
        return renderPre(el);
      case 'blockquote': {
        blocks++;
        const inner = renderBlocks(el.children, '\n\n');
        return inner.split('\n').map((l) => (l === '' ? '>' : '> ' + l)).join('\n');
      }
      case 'ul':
      case 'ol':
        blocks++;
        return listItems(el, el.name === 'ol');
      case 'hr':
        blocks++;
        return '---';
      case 'table': {
        const t = renderTable(el);
        if (t) blocks++;
        return t || null;
      }
      case 'dl':
        blocks++;
        return renderDl(el);
      case 'li':
      case 'dt':
      case 'dd':
      case 'td':
      case 'th':
      case 'tr':
      case 'thead':
      case 'tbody':
      case 'tfoot':
      case 'caption':
        return renderBlocks(el.children, '\n\n') || null;
      default:
        if (CONTAINERS.has(el.name) || !keepUnknown) return renderBlocks(el.children, '\n\n') || null;
        return `${serializeOpen(el)}\n${renderBlocks(el.children, '\n\n')}\n</${el.name}>`;
    }
  };

  const renderBlocks = (nodes: HtmlNode[], joiner: string): string => {
    const out: string[] = [];
    let run: HtmlNode[] = [];
    const flush = () => {
      if (run.length) {
        const t = finishInline(inline(run));
        if (t !== '') {
          blocks++;
          out.push(t);
        }
        run = [];
      }
    };
    for (const n of nodes) {
      if (n.type === 'comment' || n.type === 'directive') continue;
      if (n.type === 'text' && n.text.trim() === '' && run.length === 0) continue;
      if (isInline(n, keepUnknown)) run.push(n);
      else {
        flush();
        const b = renderBlockEl(n as HtmlElement);
        if (b !== null && b !== '') out.push(b);
      }
    }
    flush();
    return out.join(joiner);
  };

  let markdown = renderBlocks(doc.children, '\n\n');
  if (refs.length) {
    markdown += '\n\n' + refs.map((r, i) => `[${i + 1}]: ${linkDest(r.href)}${r.title ? ` "${r.title.replace(/"/g, '\\"')}"` : ''}`).join('\n');
  }
  return { markdown: markdown.replace(/\n{3,}/g, '\n\n').trim(), blocks, links, images };
}
