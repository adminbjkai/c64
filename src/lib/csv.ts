/**
 * csv.ts — CSV/TSV parsing, formatting and JSON conversion.
 *
 * Approach:
 *  - `parseCsv` is a hand-rolled RFC 4180 character-by-character state machine.
 *    It supports quoted fields (with "" escapes), embedded delimiters/newlines
 *    inside quotes, and CR / LF / CRLF line endings (each treated as one row
 *    terminator; a lone CR not followed by LF still ends a row). Empty lines
 *    (no characters before the terminator, at top level) are skipped and
 *    counted. Ragged rows (field count != header/first-row count) are kept
 *    as-is and reported via `warnings`, one message per offending row.
 *  - A quote character appearing in the middle of an *unquoted* field is not
 *    fatal: RFC 4180 doesn't allow it, but real-world CSV has it. We keep it
 *    literally in the field value and emit a single warning the first time
 *    this happens (not once per occurrence, to avoid warning spam).
 *  - An unterminated quoted field (EOF reached while still inside quotes) is
 *    the one condition that throws `CsvParseError`, since there is no
 *    reasonable way to keep parsing after that.
 *  - `detectDelimiter` scores each candidate delimiter by how consistent its
 *    naive (unquoted) per-line field count is across the first ~20 non-empty
 *    lines. This is a heuristic — it does not itself run the full RFC 4180
 *    parser, so a delimiter embedded only inside quoted fields on every line
 *    could in rare cases confuse the count. Good enough for sniffing intent.
 *  - `stringifyCsv` / `csvToJson` / `jsonToCsv` / `coerceCell` are plain,
 *    dependency-free helpers with no locatable-error surface (they don't
 *    throw CsvParseError; `jsonToCsv` throws a plain `Error` for shape
 *    mismatches since there's no "line/col" in a JS value).
 *
 * Limitations:
 *  - No support for CSV dialects beyond RFC 4180 quoting (e.g. no escape-char
 *    alternative to doubled quotes).
 *  - `detectDelimiter` is heuristic, not a guarantee.
 */

export type Delimiter = ',' | '\t' | ';' | '|';

const CANDIDATE_DELIMITERS: Delimiter[] = [',', '\t', ';', '|'];

/** Thrown for CSV syntax errors that can be pinpointed to a location. */
export class CsvParseError extends Error {
  line: number;
  col: number;
  hint?: string;

  constructor(message: string, line: number, col: number, hint?: string) {
    super(message);
    this.name = 'CsvParseError';
    this.line = line;
    this.col = col;
    this.hint = hint;
  }
}

/**
 * Picks the delimiter whose per-line field count is most consistent
 * (and > 0) across the first ~20 non-empty lines of `text`. Falls back to
 * ',' if nothing better presents itself.
 *
 * This is a naive line-based scan (not RFC-4180-aware) purely for sniffing;
 * `parseCsv` does the real parsing once a delimiter is chosen.
 */
export function detectDelimiter(text: string): Delimiter {
  const lines = text
    .split(/\r\n|\r|\n/)
    .filter((l) => l.length > 0)
    .slice(0, 20);

  if (lines.length === 0) return ',';

  let best: Delimiter = ',';
  let bestScore = -1;

  for (const delim of CANDIDATE_DELIMITERS) {
    const counts = lines.map((line) => countUnquotedOccurrences(line, delim) + 1);
    const nonZero = counts.filter((c) => c > 1); // c > 1 means at least one delimiter found
    if (nonZero.length === 0) continue;

    // Consistency score: how many lines share the most common count, scaled
    // by the count itself (more columns = more informative match).
    const freq = new Map<number, number>();
    for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1);
    let modeCount = 0;
    let modeValue = 0;
    for (const [value, count] of freq) {
      if (count > modeCount) {
        modeCount = count;
        modeValue = value;
      }
    }
    // Score: fraction of lines agreeing on the mode, weighted by columns.
    const score = (modeCount / counts.length) * Math.log2(modeValue + 1);

    if (score > bestScore) {
      bestScore = score;
      best = delim;
    }
  }

  return best;
}

/** Counts occurrences of `ch` in `line` outside of quoted spans. */
function countUnquotedOccurrences(line: string, ch: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === ch && !inQuotes) {
      count++;
    }
  }
  return count;
}

export interface CsvTable {
  header: string[] | null;
  rows: string[][];
  warnings: string[];
}

/**
 * Parses CSV/TSV text per RFC 4180 (quoted fields, "" escapes, embedded
 * newlines/delimiters in quotes, CR/LF/CRLF line endings).
 *
 * - `opts.delimiter` defaults to `detectDelimiter(text)`.
 * - `opts.header` defaults to true: the first parsed row becomes `header`
 *   and is excluded from `rows`. With header true and empty input, returns
 *   `{ header: null, rows: [], warnings: [] }`.
 * - Empty lines are skipped (reported as a count in `warnings`).
 * - Ragged rows are kept, with one warning per offending row.
 * - An unquoted field containing a stray `"` mid-field is tolerated (kept
 *   literally) with a single warning.
 * - An unterminated quoted field throws `CsvParseError`.
 */
export function parseCsv(
  text: string,
  opts: { delimiter?: Delimiter; header?: boolean } = {},
): CsvTable {
  const delimiter = opts.delimiter ?? detectDelimiter(text);
  const useHeader = opts.header ?? true;

  if (text.length === 0) {
    return { header: useHeader ? null : null, rows: [], warnings: [] };
  }

  const allRows: string[][] = [];
  const warnings: string[] = [];
  let emptyLineCount = 0;
  let strayQuoteWarned = false;

  let field = '';
  let row: string[] = [];
  let rowHasContent = false; // whether any char has been consumed into this row yet
  let inQuotes = false;
  let line = 1;
  let col = 1;
  // Position where the current field started, for stray-quote detection.
  let fieldHasQuoteAtStart = false;
  let fieldCharCount = 0;

  const pushField = () => {
    row.push(field);
    field = '';
    fieldHasQuoteAtStart = false;
    fieldCharCount = 0;
  };

  const pushRow = () => {
    pushField();
    if (row.length === 1 && row[0] === '') {
      // Fully empty line (no delimiters, no content) — skip it.
      emptyLineCount++;
    } else {
      allRows.push(row);
    }
    row = [];
    rowHasContent = false;
  };

  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i] as string;

    if (inQuotes) {
      if (c === '"') {
        const next = text[i + 1];
        if (next === '"') {
          field += '"';
          fieldCharCount++;
          i += 2;
          col += 2;
          continue;
        }
        // Closing quote.
        inQuotes = false;
        i++;
        col++;
        continue;
      }
      if (c === '\n') {
        field += '\n';
        i++;
        line++;
        col = 1;
        continue;
      }
      if (c === '\r') {
        // Embedded CR inside quotes: normalize CRLF -> \n, lone CR -> \n.
        field += '\n';
        i++;
        if (text[i] === '\n') i++;
        line++;
        col = 1;
        continue;
      }
      field += c;
      fieldCharCount++;
      i++;
      col++;
      continue;
    }

    // Not in quotes.
    if (c === '"') {
      if (fieldCharCount === 0) {
        // Quote at the very start of a field: begin a quoted field.
        inQuotes = true;
        fieldHasQuoteAtStart = true;
        rowHasContent = true;
        i++;
        col++;
        continue;
      }
      // Stray quote mid-field (unquoted field containing a literal ").
      if (!strayQuoteWarned) {
        warnings.push(
          `Line ${line}: a " appeared inside an unquoted field and was kept literally.`,
        );
        strayQuoteWarned = true;
      }
      field += c;
      fieldCharCount++;
      rowHasContent = true;
      i++;
      col++;
      continue;
    }

    if (c === delimiter) {
      pushField();
      rowHasContent = true;
      i++;
      col++;
      continue;
    }

    if (c === '\n') {
      pushRow();
      i++;
      line++;
      col = 1;
      continue;
    }

    if (c === '\r') {
      pushRow();
      i++;
      if (text[i] === '\n') i++;
      line++;
      col = 1;
      continue;
    }

    field += c;
    fieldCharCount++;
    rowHasContent = true;
    i++;
    col++;
  }

  if (inQuotes) {
    throw new CsvParseError(
      'Unterminated quoted field: missing a closing "',
      line,
      col,
      'Add a closing double-quote to end the field, or escape embedded quotes as "".',
    );
  }

  // Flush the last row unless the input ended cleanly on a terminator with
  // no trailing content (trailing newline is ignored, not treated as an
  // extra empty row).
  if (fieldCharCount > 0 || row.length > 0 || rowHasContent || field.length > 0) {
    pushRow();
  }
  void fieldHasQuoteAtStart;

  if (emptyLineCount > 0) {
    warnings.push(`Skipped ${emptyLineCount} empty line${emptyLineCount === 1 ? '' : 's'}.`);
  }

  let header: string[] | null = null;
  let dataRows = allRows;

  if (useHeader) {
    if (allRows.length === 0) {
      return { header: null, rows: [], warnings };
    }
    header = allRows[0] as string[];
    dataRows = allRows.slice(1);
  }

  const expected = useHeader ? (header as string[]).length : (dataRows[0]?.length ?? 0);
  dataRows.forEach((r, idx) => {
    if (r.length !== expected) {
      const rowNumber = useHeader ? idx + 2 : idx + 1; // 1-based, accounting for header
      warnings.push(`Row ${rowNumber} has ${r.length} fields, expected ${expected}.`);
    }
  });

  return { header, rows: dataRows, warnings };
}

/** Returns true if `field` needs quoting per RFC 4180 plus leading/trailing-space safety. */
function needsQuoting(field: string, delimiter: Delimiter): boolean {
  if (field.includes(delimiter) || field.includes('"') || field.includes('\n') || field.includes('\r')) {
    return true;
  }
  if (field.length > 0 && (field[0] === ' ' || field[field.length - 1] === ' ')) {
    return true;
  }
  return false;
}

function quoteField(field: string): string {
  return `"${field.replace(/"/g, '""')}"`;
}

/**
 * Serializes a table back to delimited text using LF line endings. A field
 * is quoted only when it contains the delimiter, a quote, a CR/LF, or has
 * leading/trailing whitespace.
 */
export function stringifyCsv(
  table: { header: string[] | null; rows: string[][] },
  opts: { delimiter?: Delimiter } = {},
): string {
  const delimiter = opts.delimiter ?? ',';
  const lines: string[] = [];

  const renderRow = (row: string[]): string =>
    row
      .map((cell) => (needsQuoting(cell, delimiter) ? quoteField(cell) : cell))
      .join(delimiter);

  if (table.header) {
    lines.push(renderRow(table.header));
  }
  for (const row of table.rows) {
    lines.push(renderRow(row));
  }

  return lines.join('\n');
}

/**
 * Converts a parsed table to a JSON-friendly value. Cells stay strings (no
 * type coercion) — callers can apply `coerceCell` themselves if desired.
 */
export function csvToJson(table: CsvTable): unknown {
  if (table.header) {
    const header = table.header;
    return table.rows.map((row) => {
      const obj: Record<string, string> = {};
      header.forEach((key, idx) => {
        obj[key] = row[idx] ?? '';
      });
      return obj;
    });
  }
  return table.rows.map((row) => row.slice());
}

/**
 * Best-effort coercion of a single CSV cell string to a richer JS type:
 * - '' stays '' (not coerced to null).
 * - 'true' / 'false' -> boolean.
 * - A valid finite numeric literal -> number.
 * - Anything else -> the original string, unchanged.
 */
export function coerceCell(cell: string): unknown {
  if (cell === '') return '';
  if (cell === 'true') return true;
  if (cell === 'false') return false;
  if (isNumericLiteral(cell)) {
    const n = Number(cell);
    if (Number.isFinite(n)) return n;
  }
  return cell;
}

/** Matches a JSON-style numeric literal (no leading/trailing whitespace, no leading '+'). */
function isNumericLiteral(s: string): boolean {
  return /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(s);
}

/**
 * Converts a JSON value into a CSV-shaped table.
 * - Throws a plain `Error` unless `value` is an array.
 * - Array of plain objects: header = union of keys in first-seen order
 *   across all objects; nested object/array cell values are JSON.stringify'd;
 *   null/undefined -> ''.
 * - Array of arrays: no header, rows are stringified copies of each array.
 * - Array of primitives: single column named 'value'.
 */
export function jsonToCsv(value: unknown): { header: string[] | null; rows: string[][] } {
  if (!Array.isArray(value)) {
    throw new Error('jsonToCsv expects a JSON array (e.g. an array of objects or an array of arrays).');
  }

  if (value.length === 0) {
    return { header: null, rows: [] };
  }

  const allObjects = value.every(
    (item) => item !== null && typeof item === 'object' && !Array.isArray(item),
  );
  const allArrays = value.every((item) => Array.isArray(item));

  const cellToString = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return JSON.stringify(v);
  };

  if (allObjects) {
    const header: string[] = [];
    const seen = new Set<string>();
    for (const item of value) {
      for (const key of Object.keys(item as Record<string, unknown>)) {
        if (!seen.has(key)) {
          seen.add(key);
          header.push(key);
        }
      }
    }
    const rows = value.map((item) => {
      const obj = item as Record<string, unknown>;
      return header.map((key) => cellToString(obj[key]));
    });
    return { header, rows };
  }

  if (allArrays) {
    const rows = (value as unknown[][]).map((row) => row.map((cell) => cellToString(cell)));
    return { header: null, rows };
  }

  // Array of primitives (or a mixed bag) — single column.
  const rows = value.map((item) => [cellToString(item)]);
  return { header: ['value'], rows };
}
