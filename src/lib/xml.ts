/**
 * XML: a small, strict, dependency-free parser plus pretty-printer, minifier
 * and JSON <-> XML converters.
 *
 * Approach
 * --------
 * `parseXml` is a hand-written single-pass scanner over the source string. It
 * uses an explicit element stack instead of recursion, so deeply nested input
 * cannot overflow the call stack. Every well-formedness problem is reported as
 * an `XmlParseError` with a 1-based line/column and a plain-English hint.
 * Line endings are normalized (`\r\n` and lone `\r` become `\n`) before
 * scanning, as the XML spec requires, and a leading BOM is ignored.
 *
 * Checks performed: unclosed tags, mismatched closing tags, unquoted /
 * valueless / duplicate attributes, missing whitespace between attributes,
 * `<` in text or attribute values, bare `&`, unknown entities, invalid
 * character references, `]]>` in text, `--` in comments, unterminated
 * comments / CDATA / PIs / DOCTYPEs / attribute values, misplaced XML
 * declaration or DOCTYPE, multiple root elements and junk after the root.
 *
 * Entities: the five predefined entities (&amp; &lt; &gt; &quot; &apos;) and
 * numeric character references (&#65; &#x41;) are decoded in text and
 * attribute values. Literal tabs/newlines in attribute values are normalized
 * to spaces (XML attribute-value normalization).
 *
 * JSON convention (`xmlToJson` / `jsonToXml`)
 * ------------------------------------------
 *   - The document becomes `{ <rootName>: <root value> }`.
 *   - An element becomes an object. Attributes are `"@name"` keys.
 *   - An element with no attributes and no child elements becomes its text
 *     as a plain string (`<a>hi</a>` -> `"hi"`, `<a/>` -> `""`).
 *   - Text next to attributes or child elements goes under `"#text"`
 *     (whitespace-only text is ignored; several text runs are trimmed and
 *     joined with a single space).
 *   - Repeated child elements with the same name become an array.
 *   - Comments, PIs, the DOCTYPE and the declaration are dropped.
 *   - All values are strings; no number/boolean guessing is done.
 * `jsonToXml` applies the inverse: objects -> elements, arrays -> repeated
 * elements, `@key` -> attribute, `#text` -> text, primitives -> text,
 * `null` -> empty element. A top-level object with exactly one (non-array,
 * non-`@`/`#`) key uses that key as the root; anything else is wrapped in
 * `<root>` (or `opts.rootName`). An array nested directly in an array becomes
 * an element whose items are named `item`. Keys that are not valid XML names
 * are sanitized (invalid chars -> `_`, `_` prefixed if needed).
 *
 * Limitations
 * -----------
 *   - No DTD processing: internal-subset entity declarations are preserved
 *     verbatim in the DOCTYPE node but not expanded (their use is an error).
 *   - Namespaces are not resolved; `a:b` is just a name.
 *   - Name-character validation is simplified (any non-ASCII char is allowed).
 *   - The declaration's `encoding` is recorded, not applied (input is already
 *     a JS string).
 *   - `formatXml` renders an element whose children include any non-blank
 *     text (or CDATA) inline, exactly as parsed, so mixed content is never
 *     altered; empty elements are written self-closing (`<a/>`).
 */

export class XmlParseError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly col: number,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = 'XmlParseError';
  }
}

export interface XmlAttr {
  name: string;
  value: string;
}

export interface XmlElement {
  type: 'element';
  name: string;
  attrs: XmlAttr[];
  children: XmlNode[];
}

export type XmlNode =
  | XmlElement
  | { type: 'text'; value: string }
  | { type: 'cdata'; value: string }
  | { type: 'comment'; value: string }
  | { type: 'pi'; target: string; value: string }
  | { type: 'doctype'; value: string };

export interface XmlDeclaration {
  version?: string;
  encoding?: string;
  standalone?: string;
}

export interface XmlDocument {
  declaration?: XmlDeclaration;
  children: XmlNode[];
}

/* ------------------------------------------------------------------------ */
/* Parsing                                                                   */
/* ------------------------------------------------------------------------ */

const PREDEFINED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Common HTML entities people paste into XML, mapped to their code points (for hints only). */
const HTML_ENTITY_HINTS: Record<string, number> = {
  nbsp: 160, copy: 169, reg: 174, trade: 8482, mdash: 8212, ndash: 8211,
  hellip: 8230, euro: 8364, pound: 163, laquo: 171, raquo: 187, deg: 176,
  lsquo: 8216, rsquo: 8217, ldquo: 8220, rdquo: 8221, bull: 8226, times: 215,
};

const NAME_RE = /[A-Za-z_:À-￿][\w.:·À-￿-]*/y;
const ENTITY_RE = /&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z_:][\w.:-]*);/y;

const isWs = (c: number): boolean => c === 32 || c === 9 || c === 10 || c === 13;
const isNameStart = (c: number): boolean =>
  (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 58 || c >= 0xc0;
const isBlank = (s: string): boolean => /^[ \t\r\n]*$/.test(s);

const isXmlChar = (cp: number): boolean =>
  cp === 9 || cp === 10 || cp === 13 ||
  (cp >= 0x20 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff);

interface Frame {
  el: XmlElement;
  start: number; // offset of the `<` of the start tag
}

class Parser {
  private readonly s: string;
  private readonly n: number;
  private i = 0;
  private lineStarts: number[] | null = null;
  /** Name/offset of the tag currently being read (for attribute error messages). */
  private tagName = '';
  private tagStart = 0;

  constructor(text: string) {
    this.s = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    this.n = this.s.length;
  }

  /* ---- position & error helpers ---- */

  private lineCol(off: number): [number, number] {
    if (!this.lineStarts) {
      const starts = [0];
      for (let k = 0; k < this.n; k++) if (this.s.charCodeAt(k) === 10) starts.push(k + 1);
      this.lineStarts = starts;
    }
    const starts = this.lineStarts;
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= off) lo = mid;
      else hi = mid - 1;
    }
    return [lo + 1, off - starts[lo]! + 1];
  }

  private where(off: number): string {
    const [l, c] = this.lineCol(off);
    return `line ${l}, col ${c}`;
  }

  private fail(message: string, off: number, hint?: string): never {
    const [line, col] = this.lineCol(off);
    throw new XmlParseError(message, line, col, hint);
  }

  private describe(off: number): string {
    if (off >= this.n) return 'end of input';
    const ch = this.s[off]!;
    return ch === '\n' ? 'line break' : `\`${ch}\``;
  }

  /* ---- low-level readers ---- */

  /** Skips whitespace; returns true if any was consumed. */
  private skipWs(): boolean {
    const from = this.i;
    while (this.i < this.n && isWs(this.s.charCodeAt(this.i))) this.i++;
    return this.i > from;
  }

  /** Reads an XML name at the cursor, or returns '' if there is none. */
  private readName(): string {
    NAME_RE.lastIndex = this.i;
    const m = NAME_RE.exec(this.s);
    if (!m) return '';
    this.i += m[0].length;
    return m[0];
  }

  /** Reads an entity or character reference starting at `&`; returns its decoded text. */
  private readEntity(): string {
    const start = this.i;
    ENTITY_RE.lastIndex = start;
    const m = ENTITY_RE.exec(this.s);
    if (!m) {
      if (this.s[start + 1] === '#') {
        this.fail('Malformed character reference', start, 'Write character references as `&#65;` (decimal) or `&#x41;` (hex), ending with `;`.');
      }
      this.fail('Unescaped `&`', start, 'A literal ampersand must be written as `&amp;`.');
    }
    const ref = m[1]!;
    this.i += m[0].length;
    if (ref[0] === '#') {
      const cp = ref[1] === 'x' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!isXmlChar(cp)) {
        this.fail(`Invalid character reference \`${m[0]}\``, start, 'That code point is not an allowed XML character.');
      }
      return String.fromCodePoint(cp);
    }
    const known = PREDEFINED[ref];
    if (known !== undefined) return known;
    const cp = HTML_ENTITY_HINTS[ref];
    return this.fail(
      `Unknown entity \`&${ref};\``,
      start,
      cp !== undefined
        ? `\`&${ref};\` is an HTML entity, not XML. Use the numeric reference \`&#${cp};\` instead.`
        : 'XML only predefines &amp; &lt; &gt; &quot; &apos;. Use a numeric reference (e.g. `&#160;`), or `&amp;` for a literal ampersand.',
    );
  }

  /* ---- document ---- */

  parseDocument(): XmlDocument {
    const { s } = this;
    const doc: XmlDocument = { children: [] };
    if (s.startsWith('<?xml') && (isWs(s.charCodeAt(5)) || s.startsWith('?>', 5))) {
      doc.declaration = this.parseDeclaration();
    }

    let root: XmlElement | null = null;
    let sawDoctype = false;
    for (;;) {
      this.skipWs();
      if (this.i >= this.n) break;
      const start = this.i;

      if (s.startsWith('<!--', start)) {
        doc.children.push(this.parseComment());
      } else if (s.startsWith('<?', start)) {
        doc.children.push(this.parsePI());
      } else if (s.startsWith('<!DOCTYPE', start)) {
        if (root) this.fail('DOCTYPE after the root element', start, 'The `<!DOCTYPE …>` must come before the root element.');
        if (sawDoctype) this.fail('Duplicate DOCTYPE', start, 'A document can only have one `<!DOCTYPE …>`.');
        sawDoctype = true;
        doc.children.push(this.parseDoctype());
      } else if (s.startsWith('<![CDATA[', start)) {
        this.fail('CDATA section outside the root element', start, 'CDATA sections must be inside an element.');
      } else if (s.startsWith('</', start)) {
        this.i += 2;
        const name = this.readName();
        this.fail(
          `Unexpected closing tag </${name}>`,
          start,
          root
            ? `The root element <${root.name}> is already closed; this closing tag has no matching opening tag.`
            : 'There is no open element for this closing tag to close.',
        );
      } else if (s[start] === '<' && isNameStart(s.charCodeAt(start + 1))) {
        if (root) {
          this.i++;
          const name = this.readName();
          this.fail(
            `Multiple root elements: <${name}> follows </${root.name}>`,
            start,
            'An XML document must have exactly one root element. Wrap everything in a single parent element.',
          );
        }
        root = this.parseElement();
        doc.children.push(root);
      } else if (root) {
        this.fail(
          `Unexpected content after the root element`,
          start,
          `Only comments, processing instructions and whitespace may follow </${root.name}>.`,
        );
      } else if (s[start] === '<') {
        this.fail(`Unexpected ${this.describe(start + 1)} after \`<\``, start, 'A tag name must follow `<`. Write a literal less-than sign as `&lt;`.');
      } else {
        this.fail('Text outside the root element', start, 'All text must be inside a root element, e.g. `<root>…</root>`.');
      }
    }

    if (!root) {
      this.fail(
        doc.children.length === 0 ? 'Document is empty' : 'No root element',
        this.n,
        'An XML document needs exactly one root element, e.g. `<root/>`.',
      );
    }
    return doc;
  }

  private parseDeclaration(): XmlDeclaration {
    this.tagName = '?xml';
    this.tagStart = 0;
    this.i = 5;
    const decl: XmlDeclaration = {};
    const { attrs } = this.parseAttributes('decl');
    for (const { name, value, pos } of attrs) {
      if (name === 'version' || name === 'encoding' || name === 'standalone') decl[name] = value;
      else this.fail(`Unknown XML declaration attribute \`${name}\``, pos, 'The XML declaration only allows `version`, `encoding` and `standalone`.');
    }
    return decl;
  }

  /**
   * Reads attributes up to the end of a start tag (`>` or `/>`) or of the XML
   * declaration (`?>`). The cursor must sit right after the tag name.
   */
  private parseAttributes(mode: 'tag' | 'decl'): { attrs: (XmlAttr & { pos: number })[]; selfClosing: boolean } {
    const { s } = this;
    const attrs: (XmlAttr & { pos: number })[] = [];
    const seen = new Map<string, number>();
    for (;;) {
      const hadWs = this.skipWs();
      if (this.i >= this.n) {
        this.fail(
          mode === 'tag' ? `Tag <${this.tagName}> is never closed` : 'XML declaration is never closed',
          this.tagStart,
          mode === 'tag' ? 'Add `>` to finish the start tag.' : 'Add `?>` to finish the declaration.',
        );
      }
      if (mode === 'tag') {
        if (s[this.i] === '>') {
          this.i++;
          return { attrs, selfClosing: false };
        }
        if (s.startsWith('/>', this.i)) {
          this.i += 2;
          return { attrs, selfClosing: true };
        }
      } else if (s.startsWith('?>', this.i)) {
        this.i += 2;
        return { attrs, selfClosing: false };
      }

      const pos = this.i;
      if (!isNameStart(s.charCodeAt(pos))) {
        if (s[pos] === '<') {
          this.fail(`Tag <${this.tagName}> is missing its closing \`>\``, pos, 'Add `>` at the end of the start tag.');
        }
        this.fail(
          `Unexpected ${this.describe(pos)} in <${this.tagName}>`,
          pos,
          mode === 'tag' ? 'Expected an attribute name, `>` or `/>`.' : 'Expected an attribute name or `?>`.',
        );
      }
      if (!hadWs) this.fail('Missing whitespace before attribute', pos, 'Separate attributes with a space.');

      const name = this.readName();
      const prev = seen.get(name);
      if (prev !== undefined) {
        this.fail(`Duplicate attribute \`${name}\``, pos, `\`${name}\` is already set at ${this.where(prev)}. Remove one of them.`);
      }
      this.skipWs();
      if (s[this.i] !== '=') {
        this.fail(`Attribute \`${name}\` has no value`, this.i, `XML attributes need a quoted value, e.g. ${name}="…".`);
      }
      this.i++;
      this.skipWs();
      const q = s[this.i];
      if (q !== '"' && q !== "'") {
        const bare = /^[^\s>/]*/.exec(s.slice(this.i, this.i + 40))?.[0] ?? '';
        this.fail(`Value of attribute \`${name}\` is not quoted`, this.i, `Wrap the value in quotes: ${name}="${bare || '…'}".`);
      }
      const value = this.readAttrValue(q);
      attrs.push({ name, value, pos });
      seen.set(name, pos);
    }
  }

  /** Reads a quoted attribute value (cursor on the opening quote). */
  private readAttrValue(q: string): string {
    const { s } = this;
    const open = this.i++;
    let out = '';
    let runStart = this.i;
    for (;;) {
      if (this.i >= this.n) {
        this.fail('Attribute value is never closed', open, `Add the closing ${q} quote.`);
      }
      const ch = s[this.i]!;
      if (ch === q) {
        out += s.slice(runStart, this.i);
        this.i++;
        return out;
      }
      if (ch === '<') {
        this.fail('`<` is not allowed in attribute values', this.i, `Escape it as \`&lt;\` — or is the closing ${q} quote missing?`);
      }
      if (ch === '&') {
        out += s.slice(runStart, this.i) + this.readEntity();
        runStart = this.i;
      } else if (ch === '\n' || ch === '\t') {
        out += s.slice(runStart, this.i) + ' ';
        runStart = ++this.i;
      } else {
        this.i++;
      }
    }
  }

  /** Reads a start tag at `<`. */
  private readStartTag(): Frame & { selfClosing: boolean } {
    const start = this.i;
    this.i++;
    const name = this.readName();
    this.tagName = name;
    this.tagStart = start;
    const { attrs, selfClosing } = this.parseAttributes('tag');
    const el: XmlElement = {
      type: 'element',
      name,
      attrs: attrs.map(({ name: n, value }) => ({ name: n, value })),
      children: [],
    };
    return { el, start, selfClosing };
  }

  /** Parses a whole element (cursor on its `<`) iteratively. */
  private parseElement(): XmlElement {
    const { s } = this;
    const first = this.readStartTag();
    if (first.selfClosing) return first.el;

    const stack: Frame[] = [first];
    let text = '';
    const flush = (into: XmlElement): void => {
      if (text) into.children.push({ type: 'text', value: text });
      text = '';
    };

    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      if (this.i >= this.n) {
        this.fail(`Unclosed tag <${top.el.name}>`, top.start, `Add </${top.el.name}> to close the element opened here.`);
      }
      const c = s.charCodeAt(this.i);

      if (c === 60 /* < */) {
        flush(top.el);
        const at = this.i;
        if (s.startsWith('</', at)) {
          this.i += 2;
          const name = this.readName();
          if (!name) this.fail('Closing tag has no name', at, `Expected </${top.el.name}>.`);
          if (name !== top.el.name) {
            const deeper = stack.some((f) => f.el.name === name);
            this.fail(
              `Mismatched closing tag </${name}>`,
              at,
              `Expected </${top.el.name}> to close <${top.el.name}> opened at ${this.where(top.start)}.` +
                (deeper ? ` <${top.el.name}> is probably missing its closing tag.` : ''),
            );
          }
          this.skipWs();
          if (s[this.i] !== '>') {
            this.fail(`Closing tag </${name}> is missing \`>\``, this.i, `A closing tag contains only the name: </${name}>.`);
          }
          this.i++;
          stack.pop();
        } else if (s.startsWith('<!--', at)) {
          top.el.children.push(this.parseComment());
        } else if (s.startsWith('<![CDATA[', at)) {
          top.el.children.push(this.parseCData());
        } else if (s.startsWith('<?', at)) {
          top.el.children.push(this.parsePI());
        } else if (s.startsWith('<!DOCTYPE', at)) {
          this.fail('DOCTYPE inside an element', at, 'The `<!DOCTYPE …>` must come before the root element.');
        } else if (isNameStart(s.charCodeAt(at + 1))) {
          const child = this.readStartTag();
          top.el.children.push(child.el);
          if (!child.selfClosing) stack.push(child);
        } else {
          this.fail('Unescaped `<` in text', at, 'Write a literal less-than sign as `&lt;`.');
        }
      } else if (c === 38 /* & */) {
        text += this.readEntity();
      } else {
        let j = this.i;
        while (j < this.n) {
          const d = s.charCodeAt(j);
          if (d === 60 || d === 38) break;
          j++;
        }
        const chunk = s.slice(this.i, j);
        const bad = chunk.indexOf(']]>');
        if (bad !== -1) {
          this.fail('`]]>` is not allowed in text', this.i + bad, 'Escape the `>` as `&gt;` (or close a CDATA section you meant to open).');
        }
        text += chunk;
        this.i = j;
      }
    }
    return first.el;
  }

  private parseComment(): XmlNode {
    const start = this.i;
    const end = this.s.indexOf('-->', start + 4);
    if (end === -1) this.fail('Comment is never closed', start, 'Add `-->` to close the comment.');
    const value = this.s.slice(start + 4, end);
    const dd = value.indexOf('--');
    if (dd !== -1 || value.endsWith('-')) {
      this.fail('`--` is not allowed inside a comment', dd !== -1 ? start + 4 + dd : end - 1, 'Remove the double hyphen or separate it with a space (`- -`).');
    }
    this.i = end + 3;
    return { type: 'comment', value };
  }

  private parseCData(): XmlNode {
    const start = this.i;
    const end = this.s.indexOf(']]>', start + 9);
    if (end === -1) this.fail('CDATA section is never closed', start, 'Add `]]>` to close the CDATA section.');
    this.i = end + 3;
    return { type: 'cdata', value: this.s.slice(start + 9, end) };
  }

  private parsePI(): XmlNode {
    const start = this.i;
    this.i += 2;
    const target = this.readName();
    if (!target) this.fail('Processing instruction has no target', this.i, 'Write it as `<?target data?>`.');
    if (target.toLowerCase() === 'xml') {
      this.fail(
        'XML declaration is only allowed at the very start',
        start,
        'Move `<?xml … ?>` to the first line, with nothing (not even whitespace) before it.',
      );
    }
    const end = this.s.indexOf('?>', this.i);
    if (end === -1) this.fail('Processing instruction is never closed', start, 'Add `?>` to close it.');
    const value = this.s.slice(this.i, end).replace(/^[ \t\n]+/, '');
    this.i = end + 2;
    return { type: 'pi', target, value };
  }

  private parseDoctype(): XmlNode {
    const { s } = this;
    const start = this.i;
    let j = start + 9;
    let depth = 0;
    let quote = '';
    for (; j < this.n; j++) {
      const ch = s[j]!;
      if (quote) {
        if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '[') depth++;
      else if (ch === ']') depth--;
      else if (ch === '>' && depth <= 0) break;
    }
    if (j >= this.n) this.fail('DOCTYPE is never closed', start, 'Add `>` to close the `<!DOCTYPE …>` declaration.');
    this.i = j + 1;
    return { type: 'doctype', value: s.slice(start + 9, j).trim() };
  }
}

/** Parses an XML document. Throws `XmlParseError` on malformed input. */
export function parseXml(text: string): XmlDocument {
  return new Parser(text).parseDocument();
}

/* ------------------------------------------------------------------------ */
/* Serialization                                                             */
/* ------------------------------------------------------------------------ */

const escapeText = (v: string): string => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const escapeAttr = (v: string): string =>
  v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#9;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;');

/** A CDATA section cannot contain `]]>`; split it across two sections if needed. */
const cdata = (v: string): string => `<![CDATA[${v.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

const attrsToString = (attrs: XmlAttr[]): string => attrs.map((a) => ` ${a.name}="${escapeAttr(a.value)}"`).join('');

function declToString(d: XmlDeclaration): string {
  let out = `<?xml version="${escapeAttr(d.version ?? '1.0')}"`;
  if (d.encoding !== undefined) out += ` encoding="${escapeAttr(d.encoding)}"`;
  if (d.standalone !== undefined) out += ` standalone="${escapeAttr(d.standalone)}"`;
  return out + '?>';
}

/** Removes leading/trailing whitespace runs that contain a line break (i.e. indentation). */
const trimLayout = (v: string): string => v.replace(/^[ \t]*\n[ \t\n]*/, '').replace(/[ \t\n]*\n[ \t]*$/, '');

/**
 * Serializes a node on one line. With `minify`, whitespace-only text is
 * dropped and indentation around text is trimmed; otherwise output is exact.
 */
function serializeCompact(node: XmlNode, minify: boolean): string {
  switch (node.type) {
    case 'element': {
      let inner = '';
      for (const child of node.children) inner += serializeCompact(child, minify);
      const open = `<${node.name}${attrsToString(node.attrs)}`;
      return inner === '' ? `${open}/>` : `${open}>${inner}</${node.name}>`;
    }
    case 'text':
      if (!minify) return escapeText(node.value);
      return isBlank(node.value) ? '' : escapeText(trimLayout(node.value));
    default:
      return serializeMisc(node);
  }
}

function serializeMisc(node: Exclude<XmlNode, XmlElement | { type: 'text' }>): string {
  switch (node.type) {
    case 'cdata':
      return cdata(node.value);
    case 'comment':
      return `<!--${node.value}-->`;
    case 'pi':
      return node.value ? `<?${node.target} ${node.value}?>` : `<?${node.target}?>`;
    case 'doctype':
      return `<!DOCTYPE ${node.value}>`;
  }
}

function formatNode(node: XmlNode, depth: number, indent: string, lines: string[]): void {
  const pad = indent.repeat(depth);
  if (node.type === 'text') {
    if (!isBlank(node.value)) lines.push(pad + escapeText(node.value.trim()));
    return;
  }
  if (node.type !== 'element') {
    lines.push(pad + serializeMisc(node));
    return;
  }
  const kids = node.children.filter((k) => !(k.type === 'text' && isBlank(k.value)));
  const open = `<${node.name}${attrsToString(node.attrs)}`;
  if (kids.length === 0) {
    lines.push(`${pad}${open}/>`);
    return;
  }
  // Any real text (single text child or mixed content): keep the element on
  // one line and reproduce its content exactly, so no significant whitespace
  // is added or lost.
  if (kids.some((k) => k.type === 'text' || k.type === 'cdata')) {
    lines.push(pad + serializeCompact(kids.length === 1 ? { ...node, children: kids } : node, false));
    return;
  }
  lines.push(`${pad}${open}>`);
  for (const k of kids) formatNode(k, depth + 1, indent, lines);
  lines.push(`${pad}</${node.name}>`);
}

/** Pretty-prints a document: one element per line, nested with `indent` (default 2 spaces). */
export function formatXml(doc: XmlDocument, opts: { indent?: string } = {}): string {
  const indent = opts.indent ?? '  ';
  const lines: string[] = [];
  if (doc.declaration) lines.push(declToString(doc.declaration));
  for (const child of doc.children) formatNode(child, 0, indent, lines);
  return lines.join('\n');
}

/**
 * Serializes a document with no insignificant whitespace: whitespace-only text
 * is dropped and line-break-bearing whitespace at the edges of text is removed.
 * Other text is preserved exactly.
 */
export function minifyXml(doc: XmlDocument): string {
  let out = doc.declaration ? declToString(doc.declaration) : '';
  for (const child of doc.children) out += serializeCompact(child, true);
  return out;
}

/* ------------------------------------------------------------------------ */
/* JSON conversion (see header comment for the convention)                   */
/* ------------------------------------------------------------------------ */

function elementToJson(el: XmlElement): unknown {
  const obj: Record<string, unknown> = {};
  for (const a of el.attrs) obj[`@${a.name}`] = a.value;

  const texts: string[] = [];
  let hasElements = false;
  for (const child of el.children) {
    if (child.type === 'text' || child.type === 'cdata') {
      texts.push(child.value);
    } else if (child.type === 'element') {
      hasElements = true;
      const value = elementToJson(child);
      const existing = obj[child.name];
      if (!(child.name in obj)) obj[child.name] = value;
      else if (Array.isArray(existing)) existing.push(value);
      else obj[child.name] = [existing, value];
    }
  }

  if (!hasElements && el.attrs.length === 0) return texts.join('');

  const joined = texts.join('');
  const runs = hasElements ? texts.map((t) => t.trim()).filter((t) => t !== '') : isBlank(joined) ? [] : [joined];
  if (runs.length > 0) obj['#text'] = runs.join(' ');
  return obj;
}

/** Converts a parsed document to plain JSON-compatible data. */
export function xmlToJson(doc: XmlDocument): unknown {
  const root = doc.children.find((c): c is XmlElement => c.type === 'element');
  if (!root) return null;
  return { [root.name]: elementToJson(root) };
}

/** Turns an arbitrary JSON key into a valid XML name. */
function toXmlName(key: string): string {
  let name = key.replace(/[^\w.:·À-￿-]/g, '_');
  if (!name || !isNameStart(name.charCodeAt(0))) name = `_${name}`;
  return name;
}

const toText = (v: unknown): string => (v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v));

function jsonToElement(name: string, value: unknown): XmlElement {
  const el: XmlElement = { type: 'element', name: toXmlName(name), attrs: [], children: [] };
  if (value === null || value === undefined) return el;
  if (Array.isArray(value)) {
    // Array directly inside an array: items become <item> children.
    for (const item of value) el.children.push(jsonToElement('item', item));
    return el;
  }
  if (typeof value !== 'object') {
    el.children.push({ type: 'text', value: String(value) });
    return el;
  }
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (key.startsWith('@')) {
      if (v !== null && v !== undefined) el.attrs.push({ name: toXmlName(key.slice(1)), value: toText(v) });
    } else if (key === '#text') {
      if (v !== null && v !== undefined) el.children.push({ type: 'text', value: toText(v) });
    } else {
      appendJson(el, key, v);
    }
  }
  return el;
}

/** Appends `value` under `parent` as one element, or one element per item for arrays. */
function appendJson(parent: XmlElement, key: string, value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) parent.children.push(jsonToElement(key, item));
  } else {
    parent.children.push(jsonToElement(key, value));
  }
}

/** Converts JSON-compatible data to pretty-printed XML (see convention above). */
export function jsonToXml(value: unknown, opts: { rootName?: string; indent?: string } = {}): string {
  let root: XmlElement;
  const keys = value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];
  const only = keys.length === 1 ? keys[0]! : undefined;
  if (
    only !== undefined &&
    !only.startsWith('@') &&
    only !== '#text' &&
    !Array.isArray((value as Record<string, unknown>)[only])
  ) {
    root = jsonToElement(only, (value as Record<string, unknown>)[only]);
  } else {
    const rootName = opts.rootName ?? 'root';
    if (Array.isArray(value)) {
      root = { type: 'element', name: toXmlName(rootName), attrs: [], children: [] };
      for (const item of value) root.children.push(jsonToElement('item', item));
    } else {
      root = jsonToElement(rootName, value);
    }
  }
  return formatXml({ children: [root] }, opts.indent !== undefined ? { indent: opts.indent } : {});
}
