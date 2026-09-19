/**
 * YAML mode: validate + reformat YAML. Pretty = canonical YAML re-emitted,
 * Raw = the equivalent JSON (the quickest "is this what I think it is?"
 * check, and a one-click YAML → JSON round trip). The Convert mode covers
 * the other direction.
 */

import { type ToolMode, type ModeResult, type RunContext, failure, formatBytes, byteLength } from './types.js';
import { parseYaml, stringifyYaml } from '../lib/yaml.js';
import { describeShape } from './json.js';

export function runYaml(input: string, ctx: RunContext): ModeResult {
  if (input.trim() === '') return { output: '', status: '' };
  try {
    const value = parseYaml(input);
    const indent = ctx.options['indent'] === '4' ? 4 : 2;
    const output = ctx.pretty ? stringifyYaml(value, { indent }) : JSON.stringify(value, null, 2);
    return { output, status: `Valid YAML · ${describeShape(value)} · ${formatBytes(byteLength(output))}${ctx.pretty ? '' : ' · shown as JSON'}` };
  } catch (e) {
    return failure('YAML', e);
  }
}

export const yamlMode: ToolMode = {
  id: 'yaml',
  label: 'YAML',
  description: 'Validate and reformat YAML; Raw shows the equivalent JSON.',
  category: 'Formats',
  icon: 'yaml',
  emptyHint: 'Paste YAML to validate and reformat it. Raw shows the equivalent JSON.',
  sample: 'service: api\nversion: 3\nhealthy: true\nregions:\n  - us-east-1\n  - eu-west-2\nlimits:\n  rps: 1200\n  burst: null\ndescription: >\n  Folded text keeps\n  reading nicely.\n',
  outputLanguage: (ctx) => (ctx.pretty ? 'yaml' : 'json'),
  supportsPretty: true,
  controls: [
    {
      kind: 'select',
      key: 'indent',
      label: 'Indent',
      default: '2',
      options: [
        { value: '2', label: '2 spaces' },
        { value: '4', label: '4 spaces' },
      ],
    },
  ],
  run: runYaml,
};
