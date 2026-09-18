/**
 * CSV / TSV mode: delimiter auto-detection, header toggle, table preview.
 * Pretty = table view; Raw = the re-serialised CSV (normalised quoting, LF).
 */

import { type ToolMode, type ModeResult, type RunContext, failure } from './types.js';
import { parseCsv, stringifyCsv, detectDelimiter, type Delimiter } from '../lib/csv.js';

export interface TableData {
  header: string[] | null;
  rows: string[][];
  total: number;
}

const DELIM_LABEL: Record<Delimiter, string> = { ',': 'comma', '\t': 'tab', ';': 'semicolon', '|': 'pipe' };
export const TABLE_ROW_CAP = 2000;

export function delimiterOption(v: unknown, text: string): Delimiter {
  return v === ',' || v === '\t' || v === ';' || v === '|' ? v : detectDelimiter(text);
}

export function runCsv(input: string, ctx: RunContext): ModeResult {
  if (input.trim() === '') return { output: '', status: '' };
  try {
    const delimiter = delimiterOption(ctx.options['delimiter'], input);
    const header = ctx.options['header'] !== false;
    const table = parseCsv(input, { delimiter, header });
    const cols = table.header?.length ?? table.rows[0]?.length ?? 0;
    const output = stringifyCsv(table, { delimiter });
    const status = `${DELIM_LABEL[delimiter]}-separated · ${table.rows.length} row${table.rows.length === 1 ? '' : 's'} · ${cols} column${cols === 1 ? '' : 's'}`;
    const result: ModeResult = { output, status, notes: table.warnings.length ? table.warnings : undefined };
    if (ctx.pretty) {
      const data: TableData = { header: table.header, rows: table.rows.slice(0, TABLE_ROW_CAP), total: table.rows.length };
      result.view = { kind: 'table', data };
    }
    return result;
  } catch (e) {
    return failure('CSV', e);
  }
}

export const csvMode: ToolMode = {
  id: 'csv',
  label: 'CSV / TSV',
  description: 'Parse CSV or TSV into a table; delimiter is detected for you.',
  category: 'Formats',
  icon: 'table',
  emptyHint: 'Paste CSV or TSV — the delimiter is detected. Pretty shows a table, Raw re-serialises it.',
  sample: 'sku,name,qty,price\nK-1,Keyboard,1,99.50\nM-2,"Mouse, wireless",2,25\nC-3,"Cable ""USB-C""",3,7.99\n',
  supportsPretty: true,
  controls: [
    {
      kind: 'select',
      key: 'delimiter',
      label: 'Delimiter',
      default: 'auto',
      options: [
        { value: 'auto', label: 'Auto delimiter' },
        { value: ',', label: 'Comma' },
        { value: '\t', label: 'Tab' },
        { value: ';', label: 'Semicolon' },
        { value: '|', label: 'Pipe' },
      ],
    },
    { kind: 'toggle', key: 'header', label: 'Header row', default: true },
  ],
  run: runCsv,
};
