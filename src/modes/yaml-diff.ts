/**
 * YAML Compare mode: both texts are parsed with the YAML subset parser and
 * compared with the structural diff engine (comments, quoting style and
 * block/flow layout never matter). Pretty = change report, Raw = JSON Patch
 * against the parsed values.
 */

import { type ToolMode, type ModeResult, type RunContext } from './types.js';
import { parseYaml } from '../lib/yaml.js';
import { checkSides, compareControls, compareValues, readDiffOptions, sideFailure } from './struct-compare.js';

const LABELS: [string, string] = ['Original', 'Changed'];

export function runYamlDiff(input: string, ctx: RunContext): ModeResult {
  const early = checkSides(input, ctx.inputB, LABELS);
  if (early) return early;
  let a: unknown;
  let b: unknown;
  try {
    a = parseYaml(input);
  } catch (e) {
    return sideFailure(LABELS[0], 'YAML', e);
  }
  try {
    b = parseYaml(ctx.inputB ?? '');
  } catch (e) {
    return sideFailure(LABELS[1], 'YAML', e);
  }
  return compareValues(a, b, ctx, readDiffOptions(ctx), LABELS);
}

export const yamlDiffMode: ToolMode = {
  id: 'yaml-diff',
  label: 'YAML Compare',
  description: 'Compare two YAML documents by their parsed values, ignoring comments and formatting.',
  category: 'Compare',
  icon: 'compare',
  keywords: ['diff', 'yaml', 'config', 'kubernetes', 'structural', 'semantic'],
  emptyHint: 'Paste the original YAML in Original and the new version in Changed.',
  inputs: 2,
  inputLabels: LABELS,
  sample: `# deployment
name: api
replicas: 2
image: registry/api:1.4.0
env:
  LOG_LEVEL: info
  DEBUG: "false"
ports:
  - 8080
  - 9090
`,
  sampleB: `name: api
replicas: 3
image: 'registry/api:1.5.0'
env:
  LOG_LEVEL: debug
  DEBUG: false
  TRACE: "1"
ports: [8080, 9090, 9100]
`,
  supportsPretty: true,
  outputLanguage: (ctx) => (ctx.pretty ? undefined : 'json'),
  controls: compareControls(),
  run: runYamlDiff,
};
