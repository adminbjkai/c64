/**
 * Lightweight syntax highlighting for the text output. Regex tokenisers,
 * one per language, emitting <span class="hl-…"> nodes. Deliberately small:
 * good enough to make structure scannable, never a full grammar. Inputs
 * above HIGHLIGHT_MAX characters are left plain to keep rendering instant.
 */

export type Language = 'json' | 'xml' | 'html' | 'yaml' | 'css' | 'sql' | 'toml' | 'markdown' | 'typescript' | 'python' | 'go';

export const HIGHLIGHT_MAX = 300_000;

interface Rule {
  cls: string;
  re: RegExp;
}

// Every rule regex is sticky ('y') and tried in order at the current position.
const RULES: Record<Language, Rule[]> = {
  json: [
    { cls: 'key', re: /"(?:[^"\\]|\\.)*"(?=\s*:)/y },
    { cls: 'str', re: /"(?:[^"\\]|\\.)*"/y },
    { cls: 'num', re: /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y },
    { cls: 'kw', re: /\b(?:true|false|null)\b/y },
    { cls: 'pun', re: /[{}[\]:,]/y },
  ],
  xml: [
    { cls: 'cmt', re: /<!--[\s\S]*?-->/y },
    { cls: 'cdata', re: /<!\[CDATA\[[\s\S]*?\]\]>/y },
    { cls: 'decl', re: /<[?!][^>]*>/y },
    { cls: 'tag', re: /<\/?[\w:.-]+/y },
    { cls: 'tag', re: /\/?>/y },
    { cls: 'attr', re: /[\w:.-]+(?==)/y },
    { cls: 'str', re: /"[^"]*"|'[^']*'/y },
  ],
  html: [
    { cls: 'cmt', re: /<!--[\s\S]*?-->/y },
    { cls: 'decl', re: /<![^>]*>/y },
    { cls: 'tag', re: /<\/?[\w:-]+/y },
    { cls: 'tag', re: /\/?>/y },
    { cls: 'attr', re: /[\w:-]+(?=\s*=)/y },
    { cls: 'str', re: /"[^"]*"|'[^']*'/y },
  ],
  yaml: [
    { cls: 'cmt', re: /#[^\n]*/y },
    { cls: 'key', re: /[\w.$/@-]+(?=\s*:(?:\s|$))/y },
    { cls: 'pun', re: /^(?:---|\.\.\.)|[:\-[\]{},|>&*!]/y },
    { cls: 'str', re: /"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'/y },
    { cls: 'num', re: /\b-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y },
    { cls: 'kw', re: /\b(?:true|false|null|~|yes|no|on|off)\b/y },
  ],
  css: [
    { cls: 'cmt', re: /\/\*[\s\S]*?\*\//y },
    { cls: 'at', re: /@[\w-]+/y },
    { cls: 'str', re: /"[^"]*"|'[^']*'/y },
    { cls: 'prop', re: /[\w-]+(?=\s*:)/y },
    { cls: 'num', re: /-?\d*\.?\d+(?:%|[a-z]+)?/y },
    { cls: 'sel', re: /[.#]?[\w-]+(?=[^{}]*\{)/y },
    { cls: 'pun', re: /[{}:;,]/y },
  ],
  sql: [
    { cls: 'cmt', re: /--[^\n]*|\/\*[\s\S]*?\*\//y },
    { cls: 'str', re: /'(?:[^']|'')*'/y },
    { cls: 'kw', re: /\b(?:select|from|where|and|or|not|in|is|null|as|join|inner|left|right|full|outer|on|group|by|order|having|limit|offset|insert|into|values|update|set|delete|create|table|alter|drop|with|union|all|distinct|case|when|then|else|end|like|between|exists|asc|desc|primary|key|default|index|view|returning|using|cross)\b/iy },
    { cls: 'num', re: /\b\d+(?:\.\d+)?\b/y },
    { cls: 'pun', re: /[(),;]/y },
  ],
  toml: [
    { cls: 'cmt', re: /#[^\n]*/y },
    { cls: 'sec', re: /^\s*\[\[?[^\]]+\]\]?/my },
    { cls: 'key', re: /[\w.-]+(?=\s*=)|"[^"]*"(?=\s*=)/y },
    { cls: 'str', re: /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\]|\\.)*"|'[^']*'/y },
    { cls: 'num', re: /[+-]?(?:0x[0-9a-f_]+|0o[0-7_]+|0b[01_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?|inf|nan)\b/iy },
    { cls: 'kw', re: /\b(?:true|false)\b/y },
    { cls: 'pun', re: /[=[\]{},]/y },
  ],
  markdown: [
    { cls: 'cmt', re: /```[\s\S]*?```/y },
    { cls: 'sec', re: /^#{1,6} [^\n]*/my },
    { cls: 'kw', re: /\*\*[^*\n]+\*\*|__[^_\n]+__/y },
    { cls: 'str', re: /`[^`\n]+`/y },
    { cls: 'attr', re: /\[[^\]\n]*\]\([^)\n]*\)/y },
    { cls: 'pun', re: /^(?:[-*+]|\d+\.|>)\s/my },
  ],
  typescript: [
    { cls: 'cmt', re: /\/\/[^\n]*|\/\*[\s\S]*?\*\//y },
    { cls: 'str', re: /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/y },
    { cls: 'kw', re: /\b(?:export|import|interface|type|enum|const|let|var|function|class|extends|implements|readonly|string|number|boolean|null|undefined|unknown|any|never|void|object|Array|Record|Date|from|as|return|new|true|false|z)\b/y },
    { cls: 'num', re: /\b\d+(?:\.\d+)?\b/y },
    { cls: 'pun', re: /[{}[\]();:,<>=|?&]/y },
  ],
  python: [
    { cls: 'cmt', re: /#[^\n]*/y },
    { cls: 'str', re: /"""[\s\S]*?"""|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/y },
    { cls: 'kw', re: /\b(?:from|import|class|def|return|None|True|False|str|int|float|bool|list|dict|Optional|List|Dict|TypedDict|NotRequired|Any|Union)\b/y },
    { cls: 'num', re: /\b\d+(?:\.\d+)?\b/y },
    { cls: 'pun', re: /[{}[\]():,=]/y },
  ],
  go: [
    { cls: 'cmt', re: /\/\/[^\n]*|\/\*[\s\S]*?\*\//y },
    { cls: 'str', re: /"(?:[^"\\]|\\.)*"|`[^`]*`/y },
    { cls: 'kw', re: /\b(?:package|import|type|struct|string|int|int64|float64|bool|interface|map|any|func|return|nil|true|false)\b/y },
    { cls: 'num', re: /\b\d+(?:\.\d+)?\b/y },
    { cls: 'pun', re: /[{}[\]();:,*]/y },
  ],
};

/** Highlight `text` into `host` (emptied first). Falls back to plain text when too large. */
export function highlightInto(host: HTMLElement, text: string, lang: Language | undefined): void {
  host.replaceChildren();
  if (!lang || text.length > HIGHLIGHT_MAX) {
    host.textContent = text;
    return;
  }
  const rules = RULES[lang];
  const frag = document.createDocumentFragment();
  let pos = 0;
  let plainStart = 0;
  const flushPlain = (to: number) => {
    if (to > plainStart) frag.append(text.slice(plainStart, to));
  };
  while (pos < text.length) {
    let matched = false;
    for (const r of rules) {
      r.re.lastIndex = pos;
      const m = r.re.exec(text);
      if (m && m.index === pos && m[0].length > 0) {
        flushPlain(pos);
        const span = document.createElement('span');
        span.className = `hl-${r.cls}`;
        span.textContent = m[0];
        frag.append(span);
        pos += m[0].length;
        plainStart = pos;
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Skip a whole run of "boring" characters at once for speed.
      const boring = /[^"'<>#{}[\]:,;()=`*@\-\d\w\/\\|>&!?.]+|./y;
      boring.lastIndex = pos;
      const m = boring.exec(text);
      pos += m ? Math.max(1, m[0].length) : 1;
    }
  }
  flushPlain(text.length);
  host.append(frag);
}
