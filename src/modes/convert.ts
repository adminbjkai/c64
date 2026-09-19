/**
 * Convert mode: JSON ↔ XML, JSON ↔ YAML, JSON ↔ CSV, plus the transitive
 * pairs (XML → YAML etc.) since everything goes through a JS value.
 *
 * Source "auto" sniffs the input. Conventions for the lossy directions
 * (XML attributes → "@name", CSV → array of records with string cells unless
 * "Typed cells" is on) are documented in src/lib/xml.ts and src/lib/csv.ts.
 */

import { type ToolMode, type ModeResult, type RunContext, failure, toDiagnostic, formatBytes, byteLength } from './types.js';
import { parseJson, describeShape } from './json.js';
import { parseXml, xmlToJson, jsonToXml } from '../lib/xml.js';
import { parseYaml, stringifyYaml } from '../lib/yaml.js';
import { parseCsv, csvToJson, jsonToCsv, stringifyCsv, coerceCell } from '../lib/csv.js';

export type Format = 'json' | 'xml' | 'yaml' | 'csv';

export function sniffFormat(text: string): Format {
  const t = text.trim();
  if (t.startsWith('<')) return 'xml';
  if (t.startsWith('{') || t.startsWith('[')) return 'json';
  const lines = t.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length >= 2 && /[,\t;|]/.test(lines[0]!) && !/^\s*[-\w"']+\s*:/.test(lines[0]!)) return 'csv';
  return 'yaml';
}

export function parseAs(format: Format, text: string, opts: { typedCells?: boolean } = {}): unknown {
  switch (format) {
    case 'json':
      return parseJson(text).value;
    case 'xml':
      return xmlToJson(parseXml(text));
    case 'yaml':
      return parseYaml(text);
    case 'csv': {
      const value = csvToJson(parseCsv(text));
      if (!opts.typedCells || !Array.isArray(value)) return value;
      return value.map((row) =>
        Array.isArray(row)
          ? row.map((c) => coerceCell(String(c)))
          : Object.fromEntries(Object.entries(row as Record<string, string>).map(([k, v]) => [k, coerceCell(v)])),
      );
    }
  }
}

export function emitAs(format: Format, value: unknown): string {
  switch (format) {
    case 'json':
      return JSON.stringify(value, null, 2);
    case 'xml':
      return jsonToXml(value, { indent: '  ' });
    case 'yaml':
      return stringifyYaml(value);
    case 'csv':
      return stringifyCsv(jsonToCsv(value));
  }
}

const LABEL: Record<Format, string> = { json: 'JSON', xml: 'XML', yaml: 'YAML', csv: 'CSV' };

export function runConvert(input: string, ctx: RunContext): ModeResult {
  if (input.trim() === '') return { output: '', status: '' };
  const fromOpt = ctx.options['from'];
  const from: Format = fromOpt === 'json' || fromOpt === 'xml' || fromOpt === 'yaml' || fromOpt === 'csv' ? fromOpt : sniffFormat(input);
  const toOpt = ctx.options['to'];
  const to: Format = toOpt === 'json' || toOpt === 'xml' || toOpt === 'yaml' || toOpt === 'csv' ? toOpt : 'yaml';

  let value: unknown;
  try {
    value = parseAs(from, input, { typedCells: ctx.options['typedCells'] === true });
  } catch (e) {
    return failure(LABEL[from], e);
  }
  try {
    const output = emitAs(to, value);
    const notes: string[] = [];
    if (fromOpt === 'auto' || fromOpt === undefined) notes.push(`Detected ${LABEL[from]} input.`);
    if (to === 'csv') notes.push('CSV needs an array of flat records; nested values are JSON-encoded in their cell.');
    if (from === 'xml') notes.push('XML attributes become "@name" keys; text alongside child elements becomes "#text".');
    return {
      output,
      notes,
      status: `${LABEL[from]} → ${LABEL[to]} · ${describeShape(value)} · ${formatBytes(byteLength(output))}`,
    };
  } catch (e) {
    const d = toDiagnostic(e);
    return { output: '', error: { message: `Cannot emit ${LABEL[to]}: ${d.message}`, hint: d.hint }, status: `Cannot convert to ${LABEL[to]}` };
  }
}

const FORMAT_OPTIONS = [
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'xml', label: 'XML' },
  { value: 'csv', label: 'CSV' },
];

export const convertMode: ToolMode = {
  id: 'convert',
  label: 'Convert',
  description: 'Convert between JSON, YAML, XML and CSV in any direction.',
  category: 'Formats',
  icon: 'convert',
  emptyHint: 'Paste JSON, XML, YAML or CSV, pick a target format, copy the result.',
  sample: '[{"sku":"K-1","name":"Keyboard","qty":1,"price":99.5},{"sku":"M-2","name":"Mouse","qty":2,"price":25}]',
  outputLanguage: (ctx) => ({ json: 'json', xml: 'xml', yaml: 'yaml', toml: 'toml' } as const)[String(ctx.options['to'] ?? 'yaml')],
  supportsPretty: false,
  controls: [
    { kind: 'select', key: 'from', label: 'From', default: 'auto', options: [{ value: 'auto', label: 'From: auto' }, ...FORMAT_OPTIONS] },
    { kind: 'select', key: 'to', label: 'To', default: 'yaml', options: FORMAT_OPTIONS.map((o) => ({ ...o, label: `To: ${o.label}` })) },
    { kind: 'toggle', key: 'typedCells', label: 'Typed CSV cells', default: false },
  ],
  run: runConvert,
};
