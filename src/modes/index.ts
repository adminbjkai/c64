/**
 * Mode registry. Adding a tool type = implement ToolMode and list it here;
 * the pane header's dropdown is generated from this list, in this order.
 */

import type { ToolMode } from './types.js';
import { jsonMode } from './json.js';
import { jsonTreeMode, jsonPathMode } from './json-tree.js';
import { jsonGraphMode } from './json-graph.js';
import { xmlMode } from './xml.js';
import { yamlMode } from './yaml.js';
import { csvMode } from './csv.js';
import { convertMode } from './convert.js';
import { base64Mode } from './base64.js';
import { jwtMode } from './jwt.js';
import { minifyMode } from './minify.js';
import { cssMode } from './css.js';

export const MODES: ToolMode[] = [
  jsonMode,
  jsonTreeMode,
  jsonPathMode,
  jsonGraphMode,
  xmlMode,
  yamlMode,
  csvMode,
  convertMode,
  base64Mode,
  jwtMode,
  minifyMode,
  cssMode,
];

export function getMode(id: string): ToolMode {
  return MODES.find((m) => m.id === id) ?? MODES[0]!;
}

export type { ToolMode, ModeResult, ModeControl, ModeView, Diagnostic, RunContext } from './types.js';
