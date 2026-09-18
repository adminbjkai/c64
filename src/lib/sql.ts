/**
 * sql.ts — dependency-free SQL tokenizer, beautifier and minifier.
 *
 * Subset implemented
 * ------------------
 * - Tokens: words (identifiers/keywords, incl. `@var` and `:param`), numbers,
 *   strings (`'…'` with `''`/`\'` escapes, `"…"`, `` `…` ``, Postgres
 *   `$$…$$`/`$tag$…$tag$`), `--` line comments, `/* … *​/` block comments and
 *   punctuation/operators (multi-char ones like `<>`, `::`, `->>`, `||`).
 *   String and quoted-identifier contents are never touched.
 * - Keywords are matched as phrases (longest first) so `GROUP BY`, `LEFT OUTER
 *   JOIN`, `INSERT INTO`, `CREATE TABLE IF NOT EXISTS` are single units.
 *
 * Formatting rules (best effort — never throws on odd SQL)
 * --------------------------------------------------------
 * - "Block" clauses (SELECT, FROM, WHERE, GROUP BY, HAVING, ORDER BY, SET,
 *   VALUES, RETURNING, WITH, WINDOW) go on their own line; their contents are
 *   indented one level with one item per line at each comma.
 * - "Top-level" clauses (JOIN variants, UNION, INSERT INTO, UPDATE, DELETE
 *   FROM, CREATE/ALTER/DROP TABLE, LIMIT, OFFSET, ON CONFLICT, …) start a new
 *   line and keep their contents on it. ON / USING go on a new indented line.
 * - AND / OR start a new line at the content indent (except the AND of
 *   BETWEEN … AND … and inside plain parentheses).
 * - `(` followed by SELECT/WITH opens a subquery: contents are indented one
 *   level, `)` returns to the opening line's indent. The column list of
 *   CREATE TABLE is laid out the same way. Every other parenthesis (function
 *   calls, IN lists, VALUES tuples) stays inline.
 * - CASE … WHEN … END: WHEN/ELSE on their own lines, END back at CASE level.
 * - Statements are separated by `;` and a blank line.
 *
 * The only hard errors are an unterminated string or block comment; they
 * throw `SqlParseError` with a 1-based line/col and a hint.
 */

export class SqlParseError extends Error {
  constructor(
    message: string,
    public line: number,
    public col: number,
    public hint?: string,
  ) {
    super(message);
    this.name = 'SqlParseError';
  }
}

export type SqlTokenType = 'word' | 'string' | 'number' | 'punct' | 'lineComment' | 'blockComment';

export interface SqlToken {
  type: SqlTokenType;
  text: string;
  /** Whitespace between this token and the previous one in the source. */
  wsBefore: boolean;
  line: number;
  col: number;
}

const OPERATORS = ['<=>', '->>', '#>>', '!~*', '::', '<>', '!=', '<=', '>=', '||', '->', '**', '<<', '>>', '~*', '!~', '@>', '<@', '#>', '?|', '?&', '=>', ':='];

const KEYWORDS = new Set(
  `ADD ALL ALTER AND ANY AS ASC AUTOINCREMENT AUTO_INCREMENT BEGIN BETWEEN BIGINT BOOLEAN BY CASCADE CASE CAST CHAR CHECK COLLATE COLUMN COMMIT CONFLICT CONSTRAINT CREATE CROSS CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP DATABASE DATE DECIMAL DEFAULT DELETE DESC DISTINCT DO DOUBLE DROP DUPLICATE ELSE END ESCAPE EXCEPT EXISTS EXPLAIN FALSE FETCH FILTER FIRST FLOAT FOLLOWING FOR FOREIGN FROM FULL GROUP HAVING IF IGNORE ILIKE IN INDEX INNER INSERT INT INTEGER INTERSECT INTERVAL INTO IS JOIN JSON JSONB KEY LAST LATERAL LEFT LIKE LIMIT NATURAL NEXT NO NOT NOTHING NULL NULLS NUMERIC OFFSET ON ONLY OR ORDER OUTER OVER PARTITION PRECEDING PRIMARY RANGE RECURSIVE REFERENCES REPLACE RESTRICT RETURNING RIGHT ROLLBACK ROW ROWS SELECT SERIAL SET SMALLINT TABLE TEMP TEMPORARY TEXT THEN TIME TIMESTAMP TO TRUE TRUNCATE UNBOUNDED UNION UNIQUE UPDATE USING VALUES VARCHAR VIEW WHEN WHERE WINDOW WITH WITHIN`.split(/\s+/),
);

const BLOCK_CLAUSES = ['GROUP BY', 'ORDER BY', 'WITH RECURSIVE', 'SELECT', 'FROM', 'WHERE', 'HAVING', 'SET', 'VALUES', 'RETURNING', 'WITH', 'WINDOW'];

const TOP_CLAUSES = [
  'CREATE TABLE IF NOT EXISTS', 'DROP TABLE IF EXISTS', 'CREATE OR REPLACE VIEW', 'ON DUPLICATE KEY UPDATE', 'CREATE TEMPORARY TABLE', 'NATURAL LEFT JOIN', 'NATURAL RIGHT JOIN', 'CREATE UNIQUE INDEX', 'LEFT OUTER JOIN', 'RIGHT OUTER JOIN', 'FULL OUTER JOIN', 'CREATE TEMP TABLE', 'INSERT IGNORE INTO', 'INSERT INTO', 'REPLACE INTO', 'DELETE FROM', 'CREATE TABLE', 'CREATE INDEX', 'CREATE VIEW', 'ALTER TABLE', 'DROP TABLE', 'DROP INDEX', 'DROP VIEW', 'TRUNCATE TABLE', 'ON CONFLICT', 'FETCH FIRST', 'FETCH NEXT', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'INNER JOIN', 'CROSS JOIN', 'NATURAL JOIN', 'UNION ALL', 'ADD COLUMN', 'DROP COLUMN', 'ADD CONSTRAINT', 'ALTER COLUMN', 'RENAME TO', 'STRAIGHT_JOIN', 'UPDATE', 'DELETE', 'UNION', 'INTERSECT', 'EXCEPT', 'LIMIT', 'OFFSET', 'JOIN', 'EXPLAIN', 'BEGIN', 'COMMIT', 'ROLLBACK',
];

const SUB_CLAUSES = ['ON', 'USING'];

/* ------------------------------------------------------------- tokenizer */

export function tokenizeSql(src: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  let lineStart = 0;
  let ws = false;
  const push = (type: SqlTokenType, text: string, start: number): void => {
    tokens.push({ type, text, wsBefore: ws, line, col: start - lineStart + 1 });
    ws = false;
  };
  const advance = (to: number): void => {
    for (let k = i; k < to; k++) {
      if (src.charCodeAt(k) === 10) {
        line++;
        lineStart = k + 1;
      }
    }
    i = to;
  };
  while (i < n) {
    const c = src[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f') {
      ws = true;
      advance(i + 1);
      continue;
    }
    if (c === '-' && src[i + 1] === '-') {
      let end = src.indexOf('\n', i);
      if (end < 0) end = n;
      push('lineComment', src.slice(i, end).replace(/\r$/, ''), i);
      advance(end);
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) throw new SqlParseError('Unterminated block comment', line, i - lineStart + 1, 'Add the closing */.');
      push('blockComment', src.slice(i, end + 2), i);
      advance(end + 2);
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      let k = i + 1;
      let closed = false;
      while (k < n) {
        const d = src[k]!;
        if (d === '\\' && c === "'" && k + 1 < n) {
          k += 2;
          continue;
        }
        if (d === c) {
          if (src[k + 1] === c) {
            k += 2;
            continue;
          }
          closed = true;
          break;
        }
        k++;
      }
      if (!closed) throw new SqlParseError(`Unterminated ${c === "'" ? 'string' : 'quoted identifier'}`, line, i - lineStart + 1, `Add the closing ${c}.`);
      push('string', src.slice(i, k + 1), i);
      advance(k + 1);
      continue;
    }
    if (c === '$') {
      const dm = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(src.slice(i, i + 64));
      if (dm) {
        const end = src.indexOf(dm[0], i + dm[0].length);
        if (end < 0) throw new SqlParseError('Unterminated dollar-quoted string', line, i - lineStart + 1, `Add the closing ${dm[0]}.`);
        push('string', src.slice(i, end + dm[0].length), i);
        advance(end + dm[0].length);
        continue;
      }
    }
    const num = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i, i + 64));
    if (num) {
      push('number', num[0], i);
      advance(i + num[0].length);
      continue;
    }
    const word = /^(:[A-Za-z_]|[A-Za-z_@#$])[A-Za-z0-9_$#@]*/.exec(src.slice(i, i + 256));
    if (word) {
      push('word', word[0], i);
      advance(i + word[0].length);
      continue;
    }
    let op = OPERATORS.find((o) => src.startsWith(o, i));
    if (!op) op = c;
    push('punct', op, i);
    advance(i + op.length);
  }
  return tokens;
}

/* ------------------------------------------------------------- formatter */

export interface SqlFormatOptions {
  indent?: string;
  /** true → keywords uppercased; false → lowercased. */
  uppercase?: boolean;
  commaStyle?: 'end' | 'start';
}

type Ctx = { type: 'paren' } | { type: 'subquery' | 'block'; close: number; savedBase: number; savedList: number } | { type: 'case'; indent: number };

/** Longest keyword phrase starting at token `i`; returns [phrase, wordCount] or null. */
function matchPhrase(tokens: SqlToken[], i: number, phrases: string[]): [string, number] | null {
  const words: string[] = [];
  for (let k = i; k < tokens.length && words.length < 5; k++) {
    const t = tokens[k]!;
    if (t.type !== 'word') break;
    words.push(t.text.toUpperCase());
  }
  for (const phrase of phrases) {
    const parts = phrase.split(' ');
    if (parts.length <= words.length && parts.every((p, k) => words[k] === p)) return [phrase, parts.length];
  }
  return null;
}

const NO_SPACE_BEFORE = new Set([',', ')', ';', '.', '::', ']']);
const NO_SPACE_AFTER = new Set(['(', '.', '::', '[']);

function spaceBefore(prev: SqlToken | undefined, tok: SqlToken, prevWasKeyword: boolean): boolean {
  if (!prev) return false;
  if (tok.type === 'punct' && NO_SPACE_BEFORE.has(tok.text)) return false;
  if (prev.type === 'punct' && NO_SPACE_AFTER.has(prev.text)) return false;
  if (tok.type === 'punct' && tok.text === '(') {
    if (prev.type === 'word') return prevWasKeyword || tok.wsBefore;
    return prev.type !== 'punct' || prev.text === ')' || tok.wsBefore;
  }
  if (prev.type === 'punct' && (prev.text === '-' || prev.text === '+')) return !isUnaryContext(prev);
  return true;
}

// A `-`/`+` is unary (no space after) when the token before it cannot end an operand.
const unaryFlags = new WeakSet<SqlToken>();
function isUnaryContext(tok: SqlToken): boolean {
  return unaryFlags.has(tok);
}

function caseWord(text: string, uppercase: boolean): string {
  const up = text.toUpperCase();
  if (!KEYWORDS.has(up)) return text;
  return uppercase ? up : text.toLowerCase();
}

function casePhrase(phrase: string, uppercase: boolean): string {
  return uppercase ? phrase : phrase.toLowerCase();
}

function markUnary(tokens: SqlToken[]): void {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.type !== 'punct' || (t.text !== '-' && t.text !== '+')) continue;
    const prev = tokens[i - 1];
    const operandBefore = prev && (prev.type === 'number' || prev.type === 'string' || (prev.type === 'word' && !KEYWORDS.has(prev.text.toUpperCase())) || (prev.type === 'punct' && (prev.text === ')' || prev.text === ']')));
    if (!operandBefore) unaryFlags.add(t);
  }
}

class Writer {
  lines: string[] = [];
  cur = '';
  pending: number | null = 0;
  curIndent = 0;
  constructor(private indent: string) {}
  newline(indent: number): void {
    if (this.cur.trim() !== '') this.lines.push(this.cur);
    this.cur = '';
    this.pending = indent;
    this.curIndent = indent;
  }
  blank(): void {
    this.newline(0);
    this.lines.push('');
  }
  write(text: string, space: boolean): void {
    if (this.pending !== null) {
      this.cur = this.indent.repeat(this.pending) + text;
      this.pending = null;
    } else {
      this.cur += (space && this.cur !== '' ? ' ' : '') + text;
    }
  }
  result(): string {
    this.newline(0);
    while (this.lines.length && this.lines[this.lines.length - 1] === '') this.lines.pop();
    return this.lines.join('\n');
  }
}

export function formatSql(src: string, opts: SqlFormatOptions = {}): string {
  const indent = opts.indent ?? '  ';
  const uppercase = opts.uppercase !== false;
  const commaStart = opts.commaStyle === 'start';
  const tokens = tokenizeSql(src);
  markUnary(tokens);
  const w = new Writer(indent);
  const stack: Ctx[] = [];
  let base = 0;
  let listIndent = 1;
  let afterBetween = false;
  let forceNewline = false;
  let stmtHead = '';
  let prev: SqlToken | undefined;
  let prevWasKeyword = false;

  const top = (): Ctx | undefined => stack[stack.length - 1];
  const inPlainParen = (): boolean => top()?.type === 'paren';

  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i]!;
    if (tok.type === 'lineComment') {
      w.write(tok.text, true);
      forceNewline = true;
      prev = tok;
      i++;
      continue;
    }
    let brokeForComment = false;
    if (forceNewline) {
      w.newline(w.pending ?? w.curIndent);
      forceNewline = false;
      brokeForComment = true;
    }
    if (tok.type === 'blockComment') {
      w.write(tok.text, true);
      prev = tok;
      prevWasKeyword = false;
      i++;
      continue;
    }
    const sp = spaceBefore(prev, tok, prevWasKeyword);

    if (tok.type === 'word') {
      const upper = tok.text.toUpperCase();
      const block = matchPhrase(tokens, i, BLOCK_CLAUSES);
      const topc = block ? null : matchPhrase(tokens, i, TOP_CLAUSES);
      const sub = block || topc ? null : matchPhrase(tokens, i, SUB_CLAUSES);
      if (block) {
        if (!stmtHead) stmtHead = block[0];
        w.newline(base);
        w.write(casePhrase(block[0], uppercase), false);
        i += block[1];
        // Keep SELECT DISTINCT / SELECT ALL / SELECT TOP n on the keyword line.
        const nxt = tokens[i];
        if (block[0] === 'SELECT' && nxt?.type === 'word' && ['DISTINCT', 'ALL'].includes(nxt.text.toUpperCase())) {
          w.write(caseWord(nxt.text, uppercase), true);
          i++;
        }
        listIndent = base + 1;
        w.newline(base + 1);
        prev = tokens[i - 1];
        prevWasKeyword = true;
        continue;
      }
      if (topc) {
        if (!stmtHead) stmtHead = topc[0];
        w.newline(base);
        w.write(casePhrase(topc[0], uppercase), false);
        listIndent = base + 1;
        i += topc[1];
        prev = tokens[i - 1];
        prevWasKeyword = true;
        continue;
      }
      if (sub) {
        if (!inPlainParen()) w.newline(base + 1);
        w.write(casePhrase(sub[0], uppercase), true);
        i += sub[1];
        prev = tokens[i - 1];
        prevWasKeyword = true;
        continue;
      }
      if (upper === 'AND' || upper === 'OR') {
        if (afterBetween && upper === 'AND') {
          afterBetween = false;
          w.write(caseWord(tok.text, uppercase), true);
        } else {
          if (!inPlainParen()) w.newline(listIndent);
          w.write(caseWord(tok.text, uppercase), true);
        }
        prev = tok;
        prevWasKeyword = true;
        i++;
        continue;
      }
      if (upper === 'BETWEEN') afterBetween = true;
      if (upper === 'CASE') {
        w.write(caseWord(tok.text, uppercase), sp);
        stack.push({ type: 'case', indent: w.curIndent + 1 });
        prev = tok;
        prevWasKeyword = true;
        i++;
        continue;
      }
      const t = top();
      if (t?.type === 'case' && (upper === 'WHEN' || upper === 'ELSE')) {
        w.newline(t.indent);
        w.write(caseWord(tok.text, uppercase), false);
        prev = tok;
        prevWasKeyword = true;
        i++;
        continue;
      }
      if (t?.type === 'case' && upper === 'END') {
        stack.pop();
        w.newline(t.indent - 1);
        w.write(caseWord(tok.text, uppercase), false);
        prev = tok;
        prevWasKeyword = true;
        i++;
        continue;
      }
      w.write(caseWord(tok.text, uppercase), sp);
      prevWasKeyword = KEYWORDS.has(upper);
      prev = tok;
      i++;
      continue;
    }

    if (tok.type === 'punct') {
      prevWasKeyword = false;
      if (tok.text === ',') {
        if (inPlainParen() || top()?.type === 'case') {
          w.write(',', false);
        } else if (brokeForComment) {
          // A line comment already ended the previous line: keep the comma with the next item.
          w.write(',', false);
        } else if (commaStart) {
          w.newline(listIndent);
          w.write(',', false);
        } else {
          w.write(',', false);
          w.newline(listIndent);
        }
        prev = tok;
        i++;
        continue;
      }
      if (tok.text === ';') {
        w.write(';', false);
        w.blank();
        base = 0;
        listIndent = 1;
        stack.length = 0;
        stmtHead = '';
        afterBetween = false;
        prev = tok;
        i++;
        continue;
      }
      if (tok.text === '(') {
        let k = i + 1;
        while (k < tokens.length && (tokens[k]!.type === 'lineComment' || tokens[k]!.type === 'blockComment')) k++;
        const nxt = tokens[k];
        const isSubquery = nxt?.type === 'word' && ['SELECT', 'WITH'].includes(nxt.text.toUpperCase());
        const isBlock = !isSubquery && stack.length === 0 && /^CREATE (TEMP|TEMPORARY )?TABLE/.test(stmtHead) && nxt?.type !== 'punct';
        if (isSubquery || isBlock) {
          w.write('(', sp);
          const L = w.curIndent;
          stack.push({ type: isSubquery ? 'subquery' : 'block', close: L, savedBase: base, savedList: listIndent });
          base = L + 1;
          listIndent = L + 1;
          w.newline(L + 1);
        } else {
          w.write('(', sp);
          stack.push({ type: 'paren' });
        }
        prev = tok;
        i++;
        continue;
      }
      if (tok.text === ')') {
        const t = stack.pop();
        if (t && (t.type === 'subquery' || t.type === 'block')) {
          w.newline(t.close);
          w.write(')', false);
          base = t.savedBase;
          listIndent = t.savedList;
        } else {
          w.write(')', false);
        }
        prev = tok;
        i++;
        continue;
      }
      w.write(tok.text, sp);
      prev = tok;
      i++;
      continue;
    }

    // strings, numbers
    w.write(tok.text, sp);
    prevWasKeyword = false;
    prev = tok;
    i++;
  }
  return w.result();
}

export interface SqlMinifyOptions {
  uppercase?: boolean;
}

/** One single-spaced line per statement. Line comments become block comments. */
export function minifySql(src: string, opts: SqlMinifyOptions = {}): string {
  const uppercase = opts.uppercase !== false;
  const tokens = tokenizeSql(src);
  markUnary(tokens);
  const lines: string[] = [];
  let cur = '';
  let prev: SqlToken | undefined;
  let prevWasKeyword = false;
  for (const tok of tokens) {
    let text = tok.text;
    if (tok.type === 'lineComment') text = `/* ${tok.text.replace(/^--\s?/, '').trim()} */`;
    else if (tok.type === 'word') text = caseWord(tok.text, uppercase);
    const sp = tok.type === 'lineComment' || tok.type === 'blockComment' ? true : spaceBefore(prev, tok, prevWasKeyword);
    cur += (sp && cur !== '' ? ' ' : '') + text;
    if (tok.type === 'punct' && tok.text === ';') {
      lines.push(cur);
      cur = '';
      prev = undefined;
      prevWasKeyword = false;
      continue;
    }
    prev = tok;
    prevWasKeyword = tok.type === 'word' && KEYWORDS.has(tok.text.toUpperCase());
  }
  if (cur.trim()) lines.push(cur);
  return lines.join('\n');
}

/** Number of statements: `;` separators plus a trailing unterminated one. */
export function countStatements(src: string): number {
  const tokens = tokenizeSql(src);
  let n = 0;
  let pending = false;
  for (const t of tokens) {
    if (t.type === 'lineComment' || t.type === 'blockComment') continue;
    if (t.type === 'punct' && t.text === ';') {
      if (pending) n++;
      pending = false;
    } else pending = true;
  }
  return n + (pending ? 1 : 0);
}
