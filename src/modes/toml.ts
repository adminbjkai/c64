/**
 * TOML ↔ JSON mode. Auto direction: input that starts with `{` (or a `[`
 * that is not a TOML table header) is JSON → TOML; everything else is
 * TOML → JSON. Pretty = 2-space JSON, Raw = minified (TOML output is the
 * same either way).
 */

import { type ToolMode, type ModeResult, type RunContext, failure, toDiagnostic, formatBytes, byteLength } from './types.js';
import { parseJson, describeShape } from './json.js';
import { parseTomlWithInfo, stringifyToml, looksLikeToml } from '../lib/toml.js';

export type TomlDirection = 'toJson' | 'toToml';

export function detectTomlDirection(text: string): TomlDirection {
  const t = text.trim();
  if (t.startsWith('{')) return 'toToml';
  if (t.startsWith('[')) return looksLikeToml(t) ? 'toJson' : 'toToml';
  return 'toJson';
}

export function runToml(input: string, ctx: RunContext): ModeResult {
  if (input.trim() === '') return { output: '', status: '' };
  const dirOpt = ctx.options['direction'];
  const direction: TomlDirection = dirOpt === 'toJson' || dirOpt === 'toToml' ? dirOpt : detectTomlDirection(input);
  const notes: string[] = [];
  if (dirOpt !== 'toJson' && dirOpt !== 'toToml') notes.push(`Detected ${direction === 'toJson' ? 'TOML' : 'JSON'} input.`);

  if (direction === 'toJson') {
    try {
      const { value, dates } = parseTomlWithInfo(input);
      if (dates) notes.push(`${dates} date/time value${dates === 1 ? '' : 's'} emitted as ISO-8601 string${dates === 1 ? '' : 's'} (JSON has no date type).`);
      const output = ctx.pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
      return { output, notes: notes.length ? notes : undefined, status: `TOML → JSON · ${describeShape(value)} · ${formatBytes(byteLength(output))}` };
    } catch (e) {
      return failure('TOML', e);
    }
  }

  let value: unknown;
  let parseNotes: string[];
  try {
    ({ value, notes: parseNotes } = parseJson(input));
  } catch (e) {
    return failure('JSON', e);
  }
  try {
    const skipped: string[] = [];
    const output = stringifyToml(value, { skipped });
    if (skipped.length) notes.push(`Skipped ${skipped.length} null value${skipped.length === 1 ? '' : 's'} (TOML has no null): ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? ', …' : ''}.`);
    notes.push(...parseNotes);
    return { output, notes: notes.length ? notes : undefined, status: `JSON → TOML · ${describeShape(value)} · ${formatBytes(byteLength(output))}` };
  } catch (e) {
    const d = toDiagnostic(e);
    return { output: '', error: { message: `Cannot emit TOML: ${d.message}`, hint: d.hint }, status: 'Cannot convert to TOML' };
  }
}

export const tomlMode: ToolMode = {
  id: 'toml',
  label: 'TOML ↔ JSON',
  description: 'Parse TOML 1.0 into JSON with exact error positions, or write JSON out as TOML tables.',
  category: 'Formats',
  icon: 'toml',
  keywords: ['toml', 'config', 'cargo', 'pyproject', 'tables', 'ini'],
  emptyHint: 'Paste TOML to see it as JSON, or JSON to write it as TOML — the direction is detected.',
  sample: `# Cargo-style manifest
title = "TOML Example"

[owner]
name = "Tom Preston-Werner"
dob = 1979-05-27T07:32:00-08:00

[database]
enabled = true
ports = [ 8000, 8001, 8002 ]
data = [ ["delta", "phi"], [3.14] ]
temp_targets = { cpu = 79.5, case = 72.0 }

[servers]

[servers.alpha]
ip = "10.0.0.1"
role = "frontend"

[servers.beta]
ip = "10.0.0.2"
role = "backend"

[[products]]
name = "Hammer"
sku = 738594937

[[products]]
name = "Nail"
sku = 284758393
color = "gray"
`,
  supportsPretty: true,
  controls: [
    {
      kind: 'select',
      key: 'direction',
      label: 'Direction',
      default: 'auto',
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'toJson', label: 'TOML → JSON' },
        { value: 'toToml', label: 'JSON → TOML' },
      ],
    },
  ],
  run: runToml,
};
