/**
 * Auto detect — the pseudo-tool every new pane starts in. The pane watches
 * the input (src/pane.ts) and, via the Explain heuristics, switches itself to
 * the right tool as soon as it recognises the format. Until then this mode
 * behaves like JSON Format / Validate so a pasted JSON payload is formatted
 * immediately — but it never shows a red error box: unrecognised input is
 * reported as a soft "Not recognised yet" status instead.
 */

import type { ToolMode, ModeResult, RunContext } from './types.js';
import { jsonMode, runJson } from './json.js';

export function runAuto(input: string, ctx: RunContext): ModeResult {
  const r = runJson(input, ctx);
  if (!r.error) return r;
  return { output: '', status: 'Not recognised yet', notes: ['Pick a tool from the sidebar or the chips below.'] };
}

export const autoMode: ToolMode = {
  id: 'auto',
  label: 'Auto detect',
  description: 'Paste anything — c64 recognises the format and picks the right tool.',
  category: 'Start',
  icon: 'sparkle',
  keywords: ['detect', 'start', 'any', 'paste'],
  emptyHint: 'Paste anything — JSON, JWT, Base64, XML, YAML, CSV, a URL…',
  sample: jsonMode.sample,
  outputLanguage: 'json',
  supportsPretty: true,
  controls: [],
  run: runAuto,
};
