/**
 * Mode registry. Adding a tool type = implement ToolMode and list it here;
 * the sidebar, the pane header's dropdown and the command palette are all
 * generated from this list, grouped by category in CATEGORIES order. The
 * first entry, Auto detect, is the pseudo-tool every new pane starts in.
 */

import type { ToolMode } from './types.js';
// Start
import { autoMode } from './auto.js';
// JSON
import { jsonMode } from './json.js';
import { jsonTreeMode, jsonPathMode } from './json-tree.js';
import { jsonGraphMode } from './json-graph.js';
import { jsonToTypesMode } from './json-to-types.js';
import { jsonSchemaMode } from './json-schema.js';
import { jsonTableMode } from './json-table.js';
import { jsonFlattenMode } from './json-flatten.js';
import { jsonSortMode } from './json-sort.js';
// Formats
import { xmlMode } from './xml.js';
import { yamlMode } from './yaml.js';
import { csvMode } from './csv.js';
import { htmlMode } from './html.js';
import { sqlMode } from './sql.js';
import { tomlMode } from './toml.js';
import { convertMode } from './convert.js';
// Compare
import { jsonDiffMode } from './json-diff.js';
import { xmlDiffMode } from './xml-diff.js';
import { yamlDiffMode } from './yaml-diff.js';
import { jsonPatchMode } from './json-patch.js';
import { listCompareMode } from './list-compare.js';
import { diffMode } from './diff.js';
// Encoding
import { base64Mode } from './base64.js';
import { jwtMode } from './jwt.js';
import { hexMode } from './hex.js';
import { baseNMode } from './base-n.js';
import { gzipMode } from './gzip.js';
import { dataUrlMode } from './data-url.js';
// Text
import { minifyMode } from './minify.js';
import { cssMode } from './css.js';
import { markdownMode } from './markdown.js';
import { caseMode } from './case.js';
import { linesMode } from './lines.js';
import { escapeMode } from './escape.js';
import { textStatsMode } from './text-stats.js';
import { stringUtilsMode } from './string-utils.js';
import { htmlToMarkdownMode } from './html-to-markdown.js';
// Web
import { urlMode } from './url.js';
import { queryStringMode } from './query-string.js';
import { htmlEntitiesMode } from './html-entities.js';
import { colorMode } from './color.js';
// Crypto & IDs
import { hashMode } from './hash.js';
import { uuidMode } from './uuid.js';
import { totpMode } from './totp.js';
// Generators
import { qrCodeMode } from './qr-code.js';
import { loremMode } from './lorem.js';
// Developer
import { regexMode } from './regex.js';
import { timestampMode } from './timestamp.js';
import { cronMode } from './cron.js';
import { mathEvalMode } from './math-eval.js';
import { unitConvertMode } from './unit-convert.js';
import { ipSubnetMode } from './ip-subnet.js';
import { chmodMode } from './chmod.js';

export const MODES: ToolMode[] = [
  autoMode,
  jsonMode, jsonTreeMode, jsonPathMode, jsonGraphMode, jsonTableMode, jsonSchemaMode, jsonFlattenMode, jsonSortMode, jsonToTypesMode,
  xmlMode, yamlMode, tomlMode, csvMode, htmlMode, sqlMode, convertMode,
  jsonDiffMode, xmlDiffMode, yamlDiffMode, jsonPatchMode, diffMode, listCompareMode,
  base64Mode, jwtMode, hexMode, baseNMode, gzipMode, dataUrlMode,
  minifyMode, cssMode, markdownMode, htmlToMarkdownMode, caseMode, linesMode, escapeMode, stringUtilsMode, textStatsMode,
  urlMode, queryStringMode, htmlEntitiesMode, colorMode,
  hashMode, uuidMode, totpMode,
  qrCodeMode, loremMode,
  regexMode, timestampMode, cronMode, mathEvalMode, unitConvertMode, ipSubnetMode, chmodMode,
];

export function getMode(id: string): ToolMode {
  return MODES.find((m) => m.id === id) ?? jsonMode;
}

export { CATEGORIES } from './types.js';
export type { ToolMode, ToolCategory, ModeResult, ModeControl, ModeView, Diagnostic, RunContext } from './types.js';
