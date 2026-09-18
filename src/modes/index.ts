/**
 * Mode registry. Adding a tool type = implement ToolMode and list it here;
 * the sidebar, the pane header's dropdown and the empty-pane picker are all
 * generated from this list, grouped by category in CATEGORIES order.
 */

import type { ToolMode } from './types.js';
// JSON
import { jsonMode } from './json.js';
import { jsonTreeMode, jsonPathMode } from './json-tree.js';
import { jsonGraphMode } from './json-graph.js';
import { jsonToTypesMode } from './json-to-types.js';
// Formats
import { xmlMode } from './xml.js';
import { yamlMode } from './yaml.js';
import { csvMode } from './csv.js';
import { htmlMode } from './html.js';
import { sqlMode } from './sql.js';
import { convertMode } from './convert.js';
// Encoding
import { base64Mode } from './base64.js';
import { jwtMode } from './jwt.js';
import { hexMode } from './hex.js';
import { baseNMode } from './base-n.js';
// Text
import { minifyMode } from './minify.js';
import { cssMode } from './css.js';
import { markdownMode } from './markdown.js';
import { caseMode } from './case.js';
import { linesMode } from './lines.js';
import { escapeMode } from './escape.js';
import { textStatsMode } from './text-stats.js';
// Web
import { urlMode } from './url.js';
import { queryStringMode } from './query-string.js';
import { htmlEntitiesMode } from './html-entities.js';
import { colorMode } from './color.js';
// Crypto & IDs
import { hashMode } from './hash.js';
import { uuidMode } from './uuid.js';
// Developer
import { diffMode } from './diff.js';
import { regexMode } from './regex.js';
import { timestampMode } from './timestamp.js';
import { cronMode } from './cron.js';

export const MODES: ToolMode[] = [
  jsonMode, jsonTreeMode, jsonPathMode, jsonGraphMode, jsonToTypesMode,
  xmlMode, yamlMode, csvMode, htmlMode, sqlMode, convertMode,
  base64Mode, jwtMode, hexMode, baseNMode,
  minifyMode, cssMode, markdownMode, caseMode, linesMode, escapeMode, textStatsMode,
  urlMode, queryStringMode, htmlEntitiesMode, colorMode,
  hashMode, uuidMode,
  diffMode, regexMode, timestampMode, cronMode,
];

export function getMode(id: string): ToolMode {
  return MODES.find((m) => m.id === id) ?? MODES[0]!;
}

export { CATEGORIES } from './types.js';
export type { ToolMode, ToolCategory, ModeResult, ModeControl, ModeView, Diagnostic, RunContext } from './types.js';
