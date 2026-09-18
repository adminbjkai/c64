/**
 * html.ts — tolerant, dependency-free HTML tokenizer, tree builder,
 * beautifier and minifier.
 *
 * What it implements
 * ------------------
 * - Tags with quoted (`"`/`'`) and unquoted attribute values, boolean
 *   attributes, and `/>` self-closing syntax.
 * - Void elements (area base br col embed hr img input link meta source track
 *   wbr) never take a closing tag; a stray `</br>` is reported, not applied.
 * - Optional closing tags: opening `<li>` closes an open `<li>`, `<tr>` closes
 *   an open `<td>`/`<tr>`, a block element closes an open `<p>`, etc. Elements
 *   whose end tag the HTML spec makes optional (p, li, td, tr, html, body…)
 *   are never reported as "unclosed".
 * - Raw-text elements (script, style, pre, textarea): everything up to the
 *   matching `</name>` is kept verbatim, byte for byte.
 * - `<!doctype …>` / `<! …>` / `<? …>` directives kept verbatim, comments
 *   (`<!-- … -->`) with conditional-comment detection (`[if …]` / `[endif]`).
 *
 * Tolerance
 * ---------
 * The parser never throws. Unclosed tags, stray closing tags and unterminated
 * comments/tags are collected as plain-English `notes`; a closing tag that
 * skips over still-open elements (`<b><i>x</b></i>`) is recorded in
 * `nesting` with its line/col so the caller can choose whether that is an
 * error (strict) or merely a note.
 *
 * Formatting
 * ----------
 * `formatHtml` indents by nesting depth. Inline elements (a, span, b, em,
 * code, img, br, …) stay on the same line as their surrounding text, so
 * `<p>Hi <b>there</b>!</p>` is one line. Raw-text elements are emitted as-is.
 * `minifyHtml` collapses whitespace between tags and strips comments (unless
 * asked to keep them; conditional comments are always kept).
 */

export const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

export const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'pre', 'textarea']);

export const INLINE_ELEMENTS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'button', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'i', 'img', 'input', 'ins', 'kbd', 'label', 'mark', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'select', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr',
]);

/** Elements whose end tag is optional per the HTML spec — never "unclosed". */
const OPTIONAL_CLOSE = new Set(['html', 'head', 'body', 'p', 'li', 'dt', 'dd', 'option', 'optgroup', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot', 'colgroup', 'caption', 'rt', 'rp']);

const BLOCK_CLOSES_P = new Set([
  'address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul',
]);

/** Opening `key` implicitly closes an open element in the set. */
const IMPLICIT_CLOSERS: Record<string, Set<string>> = {
  li: new Set(['li']),
  dt: new Set(['dt', 'dd']),
  dd: new Set(['dt', 'dd']),
  option: new Set(['option']),
  optgroup: new Set(['option', 'optgroup']),
  td: new Set(['td', 'th']),
  th: new Set(['td', 'th']),
  tr: new Set(['td', 'th', 'tr']),
  thead: new Set(['td', 'th', 'tr', 'tbody', 'thead', 'tfoot']),
  tbody: new Set(['td', 'th', 'tr', 'tbody', 'thead', 'tfoot']),
  tfoot: new Set(['td', 'th', 'tr', 'tbody', 'thead', 'tfoot']),
};

export interface HtmlAttr {
  name: string;
  /** null for boolean attributes (`<input disabled>`). */
  value: string | null;
  /** The quote character used in the source, or '' when unquoted. */
  quote: string;
}

export interface HtmlElement {
  type: 'element';
  name: string;
  attrs: HtmlAttr[];
  children: HtmlNode[];
  selfClosing: boolean;
  /** Verbatim contents for raw-text elements (script/style/pre/textarea). */
  rawText?: string;
  line: number;
  col: number;
}
export interface HtmlText { type: 'text'; text: string; line: number; col: number }
export interface HtmlComment { type: 'comment'; text: string; conditional: boolean; line: number; col: number }
export interface HtmlDirective { type: 'directive'; text: string; line: number; col: number }
export type HtmlNode = HtmlElement | HtmlText | HtmlComment | HtmlDirective;

export interface HtmlIssue {
  message: string;
  line: number;
  col: number;
  hint?: string;
}

export interface HtmlDoc {
  children: HtmlNode[];
  /** Tolerated problems: unclosed / stray tags, unterminated comments. */
  notes: string[];
  /** Closing tags that skipped over still-open elements. */
  nesting: HtmlIssue[];
  elementCount: number;
}

function lineStartsOf(src: string): number[] {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function positionAt(starts: number[], offset: number): { line: number; col: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] ?? 0) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, col: offset - (starts[lo] ?? 0) + 1 };
}

const isWs = (c: string): boolean => c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f';

export function parseHtml(src: string): HtmlDoc {
  const starts = lineStartsOf(src);
  const pos = (i: number) => positionAt(starts, i);
  const root: HtmlNode[] = [];
  const stack: HtmlElement[] = [];
  const notes: string[] = [];
  const nesting: HtmlIssue[] = [];
  let elementCount = 0;
  const n = src.length;
  let i = 0;
  let textStart = 0;

  const container = (): HtmlNode[] => stack[stack.length - 1]?.children ?? root;
  const flushText = (end: number): void => {
    if (end > textStart) {
      const p = pos(textStart);
      container().push({ type: 'text', text: src.slice(textStart, end), line: p.line, col: p.col });
    }
  };

  while (i < n) {
    if (src[i] !== '<') {
      i++;
      continue;
    }
    // Comment.
    if (src.startsWith('<!--', i)) {
      flushText(i);
      const p = pos(i);
      const end = src.indexOf('-->', i + 4);
      const inner = src.slice(i + 4, end < 0 ? n : end);
      if (end < 0) notes.push(`Unterminated comment at line ${p.line} (no closing -->)`);
      const trimmed = inner.trim();
      container().push({ type: 'comment', text: inner, conditional: trimmed.startsWith('[if') || trimmed.includes('[endif]'), line: p.line, col: p.col });
      i = end < 0 ? n : end + 3;
      textStart = i;
      continue;
    }
    // Doctype / bogus directive / processing instruction.
    if (src.startsWith('<!', i) || src.startsWith('<?', i)) {
      flushText(i);
      const p = pos(i);
      const end = src.indexOf('>', i);
      if (end < 0) notes.push(`Unterminated directive at line ${p.line}`);
      container().push({ type: 'directive', text: src.slice(i, end < 0 ? n : end + 1), line: p.line, col: p.col });
      i = end < 0 ? n : end + 1;
      textStart = i;
      continue;
    }
    // Closing tag.
    if (src.startsWith('</', i)) {
      const m = /^<\/([a-zA-Z][^\s/>]*)[^>]*>/.exec(src.slice(i, Math.min(n, i + 200)));
      if (!m) {
        i++;
        continue;
      }
      flushText(i);
      const p = pos(i);
      const name = m[1]!.toLowerCase();
      if (VOID_ELEMENTS.has(name)) {
        notes.push(`Stray closing tag </${name}> at line ${p.line} — void elements have no closing tag`);
      } else {
        let idx = -1;
        for (let k = stack.length - 1; k >= 0; k--) {
          if (stack[k]!.name === name) {
            idx = k;
            break;
          }
        }
        if (idx < 0) {
          notes.push(`Stray closing tag </${name}> at line ${p.line} — no matching <${name}> is open`);
        } else {
          const target = stack[idx]!;
          for (let k = stack.length - 1; k > idx; k--) {
            const skipped = stack[k]!;
            if (OPTIONAL_CLOSE.has(skipped.name)) continue;
            nesting.push({
              message: `</${name}> at line ${p.line} closes <${name}> (line ${target.line}) while <${skipped.name}> (line ${skipped.line}) is still open`,
              line: p.line,
              col: p.col,
              hint: `Close <${skipped.name}> before </${name}>, or check that the tags are nested correctly.`,
            });
            notes.push(`Unclosed <${skipped.name}> at line ${skipped.line} (implicitly closed by </${name}> at line ${p.line})`);
          }
          stack.length = idx;
        }
      }
      i += m[0].length;
      textStart = i;
      continue;
    }
    // Opening tag.
    const om = /^<([a-zA-Z][^\s/>]*)/.exec(src.slice(i, Math.min(n, i + 200)));
    if (!om) {
      i++;
      continue;
    }
    flushText(i);
    const p = pos(i);
    const name = om[1]!.toLowerCase();
    let j = i + om[0].length;
    const attrs: HtmlAttr[] = [];
    let selfClosing = false;
    let terminated = false;
    while (j < n) {
      while (j < n && isWs(src[j]!)) j++;
      if (j >= n) break;
      const c = src[j]!;
      if (c === '>') {
        j++;
        terminated = true;
        break;
      }
      if (c === '/') {
        if (src[j + 1] === '>') {
          selfClosing = true;
          j += 2;
          terminated = true;
          break;
        }
        j++;
        continue;
      }
      const nameStart = j;
      while (j < n && !isWs(src[j]!) && src[j] !== '=' && src[j] !== '>' && src[j] !== '/') j++;
      if (j === nameStart) {
        j++;
        continue;
      }
      const attrName = src.slice(nameStart, j);
      let k = j;
      while (k < n && isWs(src[k]!)) k++;
      if (src[k] === '=') {
        k++;
        while (k < n && isWs(src[k]!)) k++;
        const q = src[k];
        if (q === '"' || q === "'") {
          const end = src.indexOf(q, k + 1);
          if (end < 0) {
            notes.push(`Unterminated attribute value for ${attrName} at line ${pos(k).line}`);
            attrs.push({ name: attrName, value: src.slice(k + 1), quote: q });
            j = n;
            break;
          }
          attrs.push({ name: attrName, value: src.slice(k + 1, end), quote: q });
          j = end + 1;
        } else {
          const vs = k;
          while (k < n && !isWs(src[k]!) && src[k] !== '>') k++;
          attrs.push({ name: attrName, value: src.slice(vs, k), quote: '' });
          j = k;
        }
      } else {
        attrs.push({ name: attrName, value: null, quote: '' });
      }
    }
    if (!terminated) notes.push(`Unterminated tag <${name}> at line ${p.line}`);

    // Optional end tags: opening this element closes some open ones.
    const closers = IMPLICIT_CLOSERS[name];
    for (;;) {
      const top = stack[stack.length - 1];
      if (!top) break;
      if ((closers && closers.has(top.name)) || (top.name === 'p' && BLOCK_CLOSES_P.has(name))) stack.pop();
      else break;
    }

    const el: HtmlElement = { type: 'element', name, attrs, children: [], selfClosing, line: p.line, col: p.col };
    elementCount++;
    container().push(el);
    i = j;
    if (RAW_TEXT_ELEMENTS.has(name) && !selfClosing && terminated) {
      const re = new RegExp(`</${name}\\s*>`, 'ig');
      re.lastIndex = j;
      const cm = re.exec(src);
      if (cm) {
        el.rawText = src.slice(j, cm.index);
        i = cm.index + cm[0].length;
      } else {
        el.rawText = src.slice(j);
        notes.push(`Unclosed <${name}> at line ${p.line}`);
        i = n;
      }
    } else if (!VOID_ELEMENTS.has(name) && !selfClosing) {
      stack.push(el);
    }
    textStart = i;
  }
  flushText(n);
  for (const el of stack) {
    if (!OPTIONAL_CLOSE.has(el.name)) notes.push(`Unclosed <${el.name}> at line ${el.line}`);
  }
  return { children: root, notes, nesting, elementCount };
}

/* ------------------------------------------------------------- rendering */

function renderOpen(el: HtmlElement): string {
  let s = '<' + el.name;
  for (const a of el.attrs) {
    if (a.value === null) {
      s += ' ' + a.name;
    } else {
      const q = a.quote || (a.value.includes('"') ? "'" : '"');
      s += ` ${a.name}=${q}${a.value}${q}`;
    }
  }
  if (el.selfClosing && !VOID_ELEMENTS.has(el.name)) s += ' /';
  return s + '>';
}

const hasCloseTag = (el: HtmlElement): boolean => !VOID_ELEMENTS.has(el.name) && !el.selfClosing;
const collapseWs = (s: string): string => s.replace(/\s+/g, ' ');

function isInlineNode(node: HtmlNode): boolean {
  if (node.type === 'text') return true;
  if (node.type !== 'element') return false;
  if (node.rawText !== undefined) return false;
  return INLINE_ELEMENTS.has(node.name) && node.children.every(isInlineNode);
}

function inlineContent(nodes: HtmlNode[]): string {
  let s = '';
  for (const node of nodes) {
    if (node.type === 'text') s += collapseWs(node.text);
    else if (node.type === 'element') s += renderOpen(node) + inlineContent(node.children) + (hasCloseTag(node) ? `</${node.name}>` : '');
  }
  return s.replace(/ {2,}/g, ' ');
}

export interface HtmlFormatOptions {
  indent?: string;
}

export function formatHtml(doc: HtmlDoc, opts: HtmlFormatOptions = {}): string {
  const indent = opts.indent ?? '  ';
  const lines: string[] = [];

  const renderChildren = (children: HtmlNode[], depth: number): void => {
    const pad = indent.repeat(depth);
    let run: HtmlNode[] = [];
    const flushRun = (): void => {
      if (run.length) {
        const s = inlineContent(run).trim();
        if (s) lines.push(pad + s);
        run = [];
      }
    };
    for (const child of children) {
      if (isInlineNode(child)) run.push(child);
      else {
        flushRun();
        renderBlock(child, depth);
      }
    }
    flushRun();
  };

  const renderBlock = (node: HtmlNode, depth: number): void => {
    const pad = indent.repeat(depth);
    switch (node.type) {
      case 'text': {
        const s = collapseWs(node.text).trim();
        if (s) lines.push(pad + s);
        return;
      }
      case 'comment':
        lines.push(pad + `<!--${node.text}-->`);
        return;
      case 'directive':
        lines.push(pad + node.text);
        return;
      case 'element': {
        const open = renderOpen(node);
        const close = hasCloseTag(node) ? `</${node.name}>` : '';
        if (node.rawText !== undefined) {
          lines.push(pad + open + node.rawText + close);
        } else if (node.children.length === 0) {
          lines.push(pad + open + close);
        } else if (node.children.every(isInlineNode)) {
          lines.push(pad + open + inlineContent(node.children).trim() + close);
        } else {
          lines.push(pad + open);
          renderChildren(node.children, depth + 1);
          lines.push(pad + close);
        }
        return;
      }
    }
  };

  renderChildren(doc.children, 0);
  return lines.join('\n');
}

export interface HtmlMinifyOptions {
  keepComments?: boolean;
}

export function minifyHtml(doc: HtmlDoc, opts: HtmlMinifyOptions = {}): string {
  const keepComments = opts.keepComments === true;
  const isBlockNode = (node: HtmlNode | undefined): boolean => node !== undefined && !isInlineNode(node);

  const render = (nodes: HtmlNode[], blockContext: boolean): string => {
    let out = '';
    for (let k = 0; k < nodes.length; k++) {
      const node = nodes[k]!;
      switch (node.type) {
        case 'text': {
          let s = collapseWs(node.text);
          if (blockContext) {
            if (k === 0 || isBlockNode(nodes[k - 1])) s = s.replace(/^ /, '');
            if (k === nodes.length - 1 || isBlockNode(nodes[k + 1])) s = s.replace(/ $/, '');
          }
          out += s;
          break;
        }
        case 'comment':
          if (keepComments || node.conditional) out += `<!--${node.text}-->`;
          break;
        case 'directive':
          out += node.text;
          break;
        case 'element': {
          const inner = node.rawText !== undefined ? node.rawText : render(node.children, !INLINE_ELEMENTS.has(node.name));
          out += renderOpen(node) + inner + (hasCloseTag(node) ? `</${node.name}>` : '');
          break;
        }
      }
    }
    return out;
  };
  return render(doc.children, true);
}
