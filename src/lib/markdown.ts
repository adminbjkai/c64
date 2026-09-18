/**
 * Hand-rolled Markdown parser + renderers. Implements a CommonMark subset
 * with a few GFM extensions:
 *
 *   Blocks: ATX headings (#..######), setext headings (=== / ---),
 *   paragraphs, fenced code (``` / ~~~ with info string), indented code
 *   (4 spaces / tab), blockquotes (nesting, lazy continuation), ordered and
 *   unordered lists (nested by indentation, GFM task items), thematic breaks,
 *   GFM tables with column alignment.
 *   Inlines: emphasis (* _), strong (** __), strikethrough (~~), inline
 *   code, links [t](u "title"), images ![a](u "title"), autolinks
 *   <http://…> / <mail@host>, hard breaks (two spaces or backslash),
 *   backslash escapes.
 *
 *   Not supported (treated as text): raw HTML, reference-style links, footnotes,
 *   HTML entities (`&amp;` is shown literally as `&amp;`).
 *
 * `toHtml` escapes every piece of text and only ever emits the tags listed
 * in SAFE_TAGS; link/image URLs are restricted to http(s)/mailto and
 * data:image respectively.
 */

/* ------------------------------------------------------------------ AST */

export type Align = 'left' | 'center' | 'right' | null;

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'em'; children: Inline[] }
  | { type: 'strong'; children: Inline[] }
  | { type: 'del'; children: Inline[] }
  | { type: 'link'; href: string; title?: string; children: Inline[] }
  | { type: 'image'; src: string; alt: string; title?: string }
  | { type: 'br' }
  | { type: 'softbreak' };

export interface ListItem {
  /** null = not a task item; true/false = checkbox state. */
  checked: boolean | null;
  children: Block[];
}

export type Block =
  | { type: 'heading'; level: number; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'blockquote'; children: Block[] }
  | { type: 'list'; ordered: boolean; start: number; tight: boolean; items: ListItem[] }
  | { type: 'hr' }
  | { type: 'table'; align: Align[]; header: Inline[][]; rows: Inline[][][] };

export interface MarkdownDoc {
  blocks: Block[];
  /** Unsupported constructs seen (raw HTML tags etc.), for the mode's notes. */
  notes: string[];
}

/* ---------------------------------------------------------------- blocks */

const RE_ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const RE_FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})[ \t]*([^`\s]*)[^`]*$/;
const RE_HR = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const RE_QUOTE = /^ {0,3}> ?/;
const RE_LIST = /^( {0,3})([-*+]|\d{1,9}[.)])( +|$)(.*)$/;
const RE_SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const RE_TABLE_DELIM = /^ {0,3}\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const RE_INDENT_CODE = /^(?: {4}|\t)/;
const RE_TASK = /^\[([ xX])\][ \t]+/;

function isBlank(l: string | undefined): boolean {
  return l === undefined || l.trim() === '';
}

function stripAtxClosing(s: string): string {
  return s.replace(/[ \t]+#+[ \t]*$/, '').replace(/^#+$/, '');
}

/** Does this line start a block that interrupts a paragraph? */
function interruptsParagraph(l: string): boolean {
  if (RE_ATX.test(l) || RE_FENCE_OPEN.test(l) || RE_HR.test(l) || RE_QUOTE.test(l)) return true;
  const m = RE_LIST.exec(l);
  if (m) {
    // Only bullets and "1." may interrupt a paragraph (CommonMark), and never an empty item.
    if (m[4] === '') return false;
    return !/\d/.test(m[2]!) || /^1[.)]$/.test(m[2]!);
  }
  return false;
}

class BlockParser {
  notes = new Set<string>();

  parse(lines: string[]): Block[] {
    const out: Block[] = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i]!;
      if (isBlank(line)) {
        i++;
        continue;
      }

      // Fenced code
      const fence = RE_FENCE_OPEN.exec(line);
      if (fence) {
        const indent = fence[1]!.length;
        const marker = fence[2]!;
        const lang = fence[3] ?? '';
        const body: string[] = [];
        i++;
        while (i < lines.length) {
          const l = lines[i]!;
          const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(l);
          if (close && close[1]![0] === marker[0] && close[1]!.length >= marker.length) {
            i++;
            break;
          }
          body.push(indent ? l.replace(new RegExp(`^ {0,${indent}}`), '') : l);
          i++;
        }
        out.push({ type: 'code', lang, text: body.join('\n') });
        continue;
      }

      // ATX heading
      const atx = RE_ATX.exec(line);
      if (atx) {
        out.push({ type: 'heading', level: atx[1]!.length, children: this.inline(stripAtxClosing(atx[2] ?? '')) });
        i++;
        continue;
      }

      // Thematic break (before list: "* * *" is an hr, not a list)
      if (RE_HR.test(line)) {
        out.push({ type: 'hr' });
        i++;
        continue;
      }

      // Blockquote
      if (RE_QUOTE.test(line)) {
        const inner: string[] = [];
        while (i < lines.length) {
          const l = lines[i]!;
          if (RE_QUOTE.test(l)) inner.push(l.replace(RE_QUOTE, ''));
          else if (!isBlank(l) && inner.length && !isBlank(inner[inner.length - 1]) && !interruptsParagraph(l)) inner.push(l); // lazy continuation
          else break;
          i++;
        }
        out.push({ type: 'blockquote', children: this.parse(inner) });
        continue;
      }

      // List
      const lm = RE_LIST.exec(line);
      if (lm) {
        const ordered = /\d/.test(lm[2]!);
        const kindOf = (mk: string) => (/\d/.test(mk) ? mk[mk.length - 1]! : mk); // ".", ")" or bullet char
        const kind = kindOf(lm[2]!);
        const items: ListItem[] = [];
        let tight = true;
        let sawBlankBetween = false;
        while (i < lines.length) {
          const m = RE_LIST.exec(lines[i]!);
          if (!m || kindOf(m[2]!) !== kind || m[1]!.length > 3) break;
          if (RE_HR.test(lines[i]!)) break;
          if (sawBlankBetween) tight = false;
          const markerWidth = m[1]!.length + m[2]!.length;
          // Content column: marker + 1..4 spaces; 5+ spaces means 1 space + indented code.
          let spaces = m[3]!.length;
          if (spaces === 0 || spaces > 4) spaces = 1;
          const contentIndent = markerWidth + spaces;
          const itemLines: string[] = [m[3]!.length > 4 ? ' '.repeat(m[3]!.length - 1) + m[4]! : m[4]!];
          i++;
          let pendingBlank = 0;
          while (i < lines.length) {
            const l = lines[i]!;
            if (isBlank(l)) {
              pendingBlank++;
              i++;
              continue;
            }
            const ind = /^[ \t]*/.exec(l)![0].replace(/\t/g, '    ').length;
            if (ind >= contentIndent) {
              for (let b = 0; b < pendingBlank; b++) itemLines.push('');
              if (pendingBlank) tight = false;
              pendingBlank = 0;
              itemLines.push(dedent(l, contentIndent));
              i++;
              continue;
            }
            if (pendingBlank === 0 && !interruptsParagraph(l) && !RE_LIST.test(l) && !isBlank(itemLines[itemLines.length - 1])) {
              itemLines.push(l.trim()); // lazy paragraph continuation
              i++;
              continue;
            }
            break;
          }
          sawBlankBetween = pendingBlank > 0;
          // Task item?
          let checked: boolean | null = null;
          const first = itemLines[0] ?? '';
          const task = RE_TASK.exec(first);
          if (task) {
            checked = task[1] !== ' ';
            itemLines[0] = first.slice(task[0].length);
          }
          items.push({ checked, children: this.parse(itemLines) });
        }
        const start = ordered ? parseInt(lm[2]!, 10) : 1;
        out.push({ type: 'list', ordered, start, tight, items });
        continue;
      }

      // Indented code (not inside a paragraph, which we are not here)
      if (RE_INDENT_CODE.test(line)) {
        const body: string[] = [];
        while (i < lines.length && (RE_INDENT_CODE.test(lines[i]!) || isBlank(lines[i]))) {
          body.push(lines[i]!.replace(/^(?: {1,4}|\t)/, ''));
          i++;
        }
        while (body.length && isBlank(body[body.length - 1])) body.pop();
        out.push({ type: 'code', lang: '', text: body.join('\n') });
        continue;
      }

      // Table
      if (line.includes('|') && i + 1 < lines.length && RE_TABLE_DELIM.test(lines[i + 1]!)) {
        const header = splitRow(line);
        const delims = splitRow(lines[i + 1]!);
        if (header.length === delims.length) {
          const align: Align[] = delims.map((d) => {
            const t = d.trim();
            const l = t.startsWith(':');
            const r = t.endsWith(':');
            return l && r ? 'center' : r ? 'right' : l ? 'left' : null;
          });
          const rows: Inline[][][] = [];
          i += 2;
          while (i < lines.length && !isBlank(lines[i]) && lines[i]!.includes('|') && !interruptsParagraph(lines[i]!)) {
            const cells = splitRow(lines[i]!);
            while (cells.length < header.length) cells.push('');
            rows.push(cells.slice(0, header.length).map((c) => this.inline(c.trim())));
            i++;
          }
          out.push({ type: 'table', align, header: header.map((c) => this.inline(c.trim())), rows });
          continue;
        }
      }

      // Paragraph (with setext lookahead)
      const para: string[] = [line.trimStart()];
      i++;
      let heading = 0;
      while (i < lines.length) {
        const l = lines[i]!;
        if (isBlank(l)) break;
        const se = RE_SETEXT.exec(l);
        if (se) {
          heading = se[1]![0] === '=' ? 1 : 2;
          i++;
          break;
        }
        if (interruptsParagraph(l)) break;
        para.push(l.trim());
        i++;
      }
      const text = para.join('\n');
      if (heading) out.push({ type: 'heading', level: heading, children: this.inline(text.trim()) });
      else out.push({ type: 'paragraph', children: this.inline(text) });
    }
    return out;
  }

  inline(text: string): Inline[] {
    const p = new InlineParser(text);
    const nodes = p.parse();
    for (const n of p.notes) this.notes.add(n);
    return nodes;
  }
}

function dedent(l: string, n: number): string {
  let i = 0;
  let col = 0;
  while (i < l.length && col < n) {
    const ch = l[i];
    if (ch === ' ') col++;
    else if (ch === '\t') col += 4;
    else break;
    i++;
  }
  return l.slice(i);
}

/** Split a table row on unescaped pipes, dropping the leading/trailing empty cells. */
function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (ch === '\\' && t[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (ch === '|') {
      cells.push(cur);
      cur = '';
    } else cur += ch;
  }
  cells.push(cur);
  return cells;
}

/* --------------------------------------------------------------- inlines */

const PUNCT = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;
const RE_AUTOLINK = /^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*)>/;
const RE_EMAIL_AUTOLINK = /^<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/;
const RE_HTML_TAG = /^<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?\/?>|^<!--[\s\S]*?-->/;

type Delim = { type: 'delim'; char: string; count: number; canOpen: boolean; canClose: boolean; origCount: number };
type Tok = Inline | Delim;

class InlineParser {
  notes = new Set<string>();
  private pos = 0;
  constructor(private src: string) {}

  parse(): Inline[] {
    const toks: Tok[] = [];
    let text = '';
    const flush = () => {
      if (text) toks.push({ type: 'text', text });
      text = '';
    };
    const s = this.src;
    while (this.pos < s.length) {
      const ch = s[this.pos]!;

      if (ch === '\\') {
        const next = s[this.pos + 1];
        if (next === '\n') {
          flush();
          toks.push({ type: 'br' });
          this.pos += 2;
          continue;
        }
        if (next !== undefined && PUNCT.test(next)) {
          text += next;
          this.pos += 2;
          continue;
        }
        text += '\\';
        this.pos++;
        continue;
      }

      if (ch === '\n') {
        const hard = /[ ]{2,}$/.test(text);
        text = text.replace(/[ \t]+$/, '');
        flush();
        toks.push(hard ? { type: 'br' } : { type: 'softbreak' });
        this.pos++;
        while (s[this.pos] === ' ') this.pos++;
        continue;
      }

      if (ch === '`') {
        let run = 0;
        while (s[this.pos + run] === '`') run++;
        const open = '`'.repeat(run);
        let j = this.pos + run;
        let found = -1;
        while (j < s.length) {
          const k = s.indexOf(open, j);
          if (k < 0) break;
          let len = 0;
          while (s[k + len] === '`') len++;
          if (len === run) {
            found = k;
            break;
          }
          j = k + len;
        }
        if (found >= 0) {
          flush();
          let code = s.slice(this.pos + run, found).replace(/\n/g, ' ');
          if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim() !== '') code = code.slice(1, -1);
          toks.push({ type: 'code', text: code });
          this.pos = found + run;
        } else {
          text += open;
          this.pos += run;
        }
        continue;
      }

      if (ch === '<') {
        const rest = s.slice(this.pos);
        const auto = RE_AUTOLINK.exec(rest);
        if (auto) {
          flush();
          toks.push({ type: 'link', href: auto[1]!, children: [{ type: 'text', text: auto[1]! }] });
          this.pos += auto[0].length;
          continue;
        }
        const mail = RE_EMAIL_AUTOLINK.exec(rest);
        if (mail) {
          flush();
          toks.push({ type: 'link', href: 'mailto:' + mail[1]!, children: [{ type: 'text', text: mail[1]! }] });
          this.pos += mail[0].length;
          continue;
        }
        const tag = RE_HTML_TAG.exec(rest);
        if (tag) {
          const name = /^<\/?([a-zA-Z][a-zA-Z0-9-]*)/.exec(tag[0])?.[1];
          this.notes.add(name ? `Raw HTML (<${name.toLowerCase()}>) is not rendered; it is shown as text.` : 'HTML comments are shown as text.');
        }
        text += '<';
        this.pos++;
        continue;
      }

      if (ch === '!' && s[this.pos + 1] === '[') {
        const link = this.tryLink(this.pos + 1);
        if (link) {
          flush();
          toks.push({ type: 'image', src: link.dest, alt: plainText(link.children), title: link.title });
          this.pos = link.end;
          continue;
        }
        text += '!';
        this.pos++;
        continue;
      }

      if (ch === '[') {
        const link = this.tryLink(this.pos);
        if (link) {
          flush();
          toks.push({ type: 'link', href: link.dest, title: link.title, children: link.children });
          this.pos = link.end;
          continue;
        }
        text += '[';
        this.pos++;
        continue;
      }

      if (ch === '*' || ch === '_' || ch === '~') {
        let run = 0;
        while (s[this.pos + run] === ch) run++;
        const before = this.pos === 0 ? ' ' : s[this.pos - 1]!;
        const after = this.pos + run >= s.length ? ' ' : s[this.pos + run]!;
        const wsB = /\s/.test(before);
        const wsA = /\s/.test(after);
        const pB = PUNCT.test(before);
        const pA = PUNCT.test(after);
        const left = !wsA && (!pA || wsB || pB);
        const right = !wsB && (!pB || wsA || pA);
        let canOpen = left;
        let canClose = right;
        if (ch === '_') {
          canOpen = left && (!right || pB);
          canClose = right && (!left || pA);
        }
        if (ch === '~' && run !== 2) {
          text += ch.repeat(run);
          this.pos += run;
          continue;
        }
        flush();
        toks.push({ type: 'delim', char: ch, count: run, origCount: run, canOpen, canClose });
        this.pos += run;
        continue;
      }

      text += ch;
      this.pos++;
    }
    flush();
    return processEmphasis(toks);
  }

  /** Parse `[text](dest "title")` starting at `[`. Returns null if not a link. */
  private tryLink(start: number): { children: Inline[]; dest: string; title?: string; end: number } | null {
    const s = this.src;
    let depth = 0;
    let i = start;
    for (; i < s.length; i++) {
      const c = s[i];
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === '`') {
        // skip code spans inside link text
        let run = 0;
        while (s[i + run] === '`') run++;
        const close = s.indexOf('`'.repeat(run), i + run);
        if (close >= 0) {
          i = close + run - 1;
          continue;
        }
      }
      if (c === '[') depth++;
      else if (c === ']') {
        depth--;
        if (depth === 0) break;
      }
    }
    if (i >= s.length || s[i] !== ']' || s[i + 1] !== '(') return null;
    const label = s.slice(start + 1, i);
    let j = i + 2;
    while (s[j] === ' ' || s[j] === '\n') j++;
    let dest = '';
    if (s[j] === '<') {
      const close = s.indexOf('>', j + 1);
      if (close < 0) return null;
      dest = s.slice(j + 1, close);
      j = close + 1;
    } else {
      let paren = 0;
      while (j < s.length) {
        const c = s[j]!;
        if (c === '\\' && j + 1 < s.length) {
          dest += s[j + 1];
          j += 2;
          continue;
        }
        if (/\s/.test(c)) break;
        if (c === '(') paren++;
        if (c === ')') {
          if (paren === 0) break;
          paren--;
        }
        dest += c;
        j++;
      }
    }
    while (s[j] === ' ' || s[j] === '\n') j++;
    let title: string | undefined;
    const q = s[j];
    if (q === '"' || q === "'" || q === '(') {
      const closeQ = q === '(' ? ')' : q;
      const close = s.indexOf(closeQ, j + 1);
      if (close < 0) return null;
      title = s.slice(j + 1, close).replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1');
      j = close + 1;
      while (s[j] === ' ' || s[j] === '\n') j++;
    }
    if (s[j] !== ')') return null;
    const sub = new InlineParser(label);
    const children = sub.parse();
    for (const n of sub.notes) this.notes.add(n);
    return { children, dest, title, end: j + 1 };
  }
}

/** CommonMark "process emphasis" over a flat token list. */
function processEmphasis(toks: Tok[]): Inline[] {
  let closerIdx = 0;
  while (closerIdx < toks.length) {
    const closer = toks[closerIdx]!;
    if (closer.type !== 'delim' || !closer.canClose) {
      closerIdx++;
      continue;
    }
    let openerIdx = closerIdx - 1;
    let matched = false;
    while (openerIdx >= 0) {
      const opener = toks[openerIdx]!;
      if (opener.type === 'delim' && opener.char === closer.char && opener.canOpen) {
        // Rule of 3: prevents "*foo**bar*" mis-nesting.
        const odd = (opener.canClose || closer.canOpen) && (opener.origCount + closer.origCount) % 3 === 0 && !(opener.origCount % 3 === 0 && closer.origCount % 3 === 0);
        if (!odd) {
          matched = true;
          break;
        }
      }
      openerIdx--;
    }
    if (!matched) {
      closerIdx++;
      continue;
    }
    const opener = toks[openerIdx] as Delim;
    const use = closer.char === '~' ? 2 : opener.count >= 2 && closer.count >= 2 ? 2 : 1;
    const type: 'em' | 'strong' | 'del' = closer.char === '~' ? 'del' : use === 2 ? 'strong' : 'em';
    const inner = toks.slice(openerIdx + 1, closerIdx).map(delimToText);
    const node: Inline = { type, children: inner };
    opener.count -= use;
    closer.count -= use;
    const removeOpener = opener.count === 0;
    const removeCloser = closer.count === 0;
    const replacement: Tok[] = [];
    if (!removeOpener) replacement.push(opener);
    replacement.push(node);
    if (!removeCloser) replacement.push(closer);
    toks.splice(openerIdx, closerIdx - openerIdx + 1, ...replacement);
    closerIdx = openerIdx + replacement.length - (removeCloser ? 0 : 1);
    if (removeCloser) closerIdx = openerIdx + replacement.length;
  }
  return mergeText(toks.map(delimToText));
}

function delimToText(t: Tok): Inline {
  if (t.type === 'delim') return { type: 'text', text: t.char.repeat(t.count) };
  return t;
}

function mergeText(nodes: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const n of nodes) {
    const last = out[out.length - 1];
    if (n.type === 'text' && last?.type === 'text') last.text += n.text;
    else if (n.type === 'text' && n.text === '') continue;
    else out.push(n);
  }
  return out;
}

/* ------------------------------------------------------------------ API */

export function parseMarkdown(src: string): MarkdownDoc {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const p = new BlockParser();
  const blocks = p.parse(lines);
  return { blocks, notes: [...p.notes] };
}

/* ------------------------------------------------------------- renderers */

export const SAFE_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'strong', 'em', 'del', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a', 'img', 'hr', 'br', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'input'] as const;
export const SAFE_ATTRS = ['href', 'src', 'alt', 'title', 'class', 'align', 'type', 'checked', 'disabled', 'rel', 'start'] as const;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function safeHref(url: string): string | null {
  const u = url.trim();
  return /^(https?:|mailto:)/i.test(u) && !/[\s<>"]/.test(u) ? u : null;
}

export function safeSrc(url: string): string | null {
  const u = url.trim();
  return /^(https?:|data:image\/)/i.test(u) && !/[\s<>"]/.test(u) ? u : null;
}

export function inlinesToHtml(nodes: Inline[]): string {
  let out = '';
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
        out += escapeHtml(n.text);
        break;
      case 'softbreak':
        out += '\n';
        break;
      case 'br':
        out += '<br>\n';
        break;
      case 'code':
        out += `<code>${escapeHtml(n.text)}</code>`;
        break;
      case 'em':
      case 'strong':
      case 'del':
        out += `<${n.type}>${inlinesToHtml(n.children)}</${n.type}>`;
        break;
      case 'link': {
        const href = safeHref(n.href);
        const inner = inlinesToHtml(n.children);
        if (!href) out += inner;
        else out += `<a href="${escapeHtml(href)}"${n.title ? ` title="${escapeHtml(n.title)}"` : ''} rel="noopener">${inner}</a>`;
        break;
      }
      case 'image': {
        const src = safeSrc(n.src);
        if (!src) out += escapeHtml(n.alt);
        else out += `<img src="${escapeHtml(src)}" alt="${escapeHtml(n.alt)}"${n.title ? ` title="${escapeHtml(n.title)}"` : ''}>`;
        break;
      }
    }
  }
  return out;
}

export function toHtml(blocks: Block[]): string {
  return blocks.map(blockToHtml).join('\n');
}

function blockToHtml(b: Block): string {
  switch (b.type) {
    case 'heading':
      return `<h${b.level}>${inlinesToHtml(b.children)}</h${b.level}>`;
    case 'paragraph':
      return `<p>${inlinesToHtml(b.children)}</p>`;
    case 'code': {
      const lang = /^[\w+#.-]+$/.test(b.lang) ? ` class="language-${escapeHtml(b.lang)}"` : '';
      return `<pre><code${lang}>${escapeHtml(b.text)}${b.text ? '\n' : ''}</code></pre>`;
    }
    case 'blockquote':
      return `<blockquote>\n${toHtml(b.children)}\n</blockquote>`;
    case 'hr':
      return '<hr>';
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      const start = b.ordered && b.start !== 1 ? ` start="${b.start}"` : '';
      const items = b.items.map((it) => {
        const box = it.checked === null ? '' : `<input type="checkbox" disabled${it.checked ? ' checked' : ''}> `;
        let inner: string;
        if (b.tight) {
          inner = it.children
            .map((c) => (c.type === 'paragraph' ? inlinesToHtml(c.children) : blockToHtml(c)))
            .join('\n');
        } else inner = '\n' + toHtml(it.children) + '\n';
        return `<li${it.checked === null ? '' : ' class="task"'}>${box}${inner}</li>`;
      });
      return `<${tag}${start}>\n${items.join('\n')}\n</${tag}>`;
    }
    case 'table': {
      const attr = (i: number) => (b.align[i] ? ` align="${b.align[i]}"` : '');
      const head = `<thead>\n<tr>${b.header.map((c, i) => `<th${attr(i)}>${inlinesToHtml(c)}</th>`).join('')}</tr>\n</thead>`;
      const body = b.rows.length ? `\n<tbody>\n${b.rows.map((r) => `<tr>${r.map((c, i) => `<td${attr(i)}>${inlinesToHtml(c)}</td>`).join('')}</tr>`).join('\n')}\n</tbody>` : '';
      return `<table>\n${head}${body}\n</table>`;
    }
  }
}

/** Collapse a rendered HTML string onto one line (whitespace between tags only). */
export function minifyHtml(html: string): string {
  // Keep <pre> content intact.
  const parts = html.split(/(<pre>[\s\S]*?<\/pre>)/);
  return parts
    .map((p, i) => (i % 2 === 1 ? p : p.replace(/>\s+</g, '><').replace(/\n+/g, ' ').trim()))
    .join('');
}

export function plainText(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case 'text':
        case 'code':
          return n.text;
        case 'softbreak':
        case 'br':
          return '\n';
        case 'image':
          return n.alt;
        case 'em':
        case 'strong':
        case 'del':
        case 'link':
          return plainText(n.children);
      }
    })
    .join('');
}

export function toPlain(blocks: Block[], indent = ''): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case 'heading':
        case 'paragraph':
          return indent + plainText(b.children).replace(/\n/g, '\n' + indent);
        case 'code':
          return b.text
            .split('\n')
            .map((l) => indent + l)
            .join('\n');
        case 'blockquote':
          return toPlain(b.children, indent + '> ');
        case 'hr':
          return indent + '---';
        case 'list':
          return b.items
            .map((it, i) => {
              const marker = b.ordered ? `${b.start + i}. ` : '- ';
              const box = it.checked === null ? '' : it.checked ? '[x] ' : '[ ] ';
              const body = toPlain(it.children, indent + ' '.repeat(marker.length));
              return indent + marker + box + body.slice(indent.length + marker.length);
            })
            .join('\n');
        case 'table': {
          const row = (cells: Inline[][]) => indent + cells.map(plainText).join(' | ');
          return [row(b.header), ...b.rows.map(row)].join('\n');
        }
      }
    })
    .join('\n\n');
}

/** Counts used for the status line. */
export function countBlocks(blocks: Block[]): { blocks: number; headings: number } {
  let n = 0;
  let headings = 0;
  const walk = (bs: Block[]) => {
    for (const b of bs) {
      n++;
      if (b.type === 'heading') headings++;
      if (b.type === 'blockquote') walk(b.children);
      if (b.type === 'list') for (const it of b.items) walk(it.children);
    }
  };
  walk(blocks);
  return { blocks: n, headings };
}
