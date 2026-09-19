/**
 * CSS mode: beautify (Pretty) or minify (Raw), with structural validation.
 */

import { type ToolMode, type ModeResult, type RunContext, failure, formatBytes, byteLength } from './types.js';
import { formatCss, minifyCss } from '../lib/css.js';
import { indentString } from './json.js';

export function runCss(input: string, ctx: RunContext): ModeResult {
  if (input.trim() === '') return { output: '', status: '' };
  try {
    const output = ctx.pretty ? formatCss(input, { indent: indentString(ctx.options['indent']) }) : minifyCss(input);
    const inBytes = byteLength(input);
    const outBytes = byteLength(output);
    const delta = inBytes ? Math.round(((outBytes - inBytes) / inBytes) * 100) : 0;
    return { output, status: `${ctx.pretty ? 'Beautified' : 'Minified'} · ${formatBytes(inBytes)} → ${formatBytes(outBytes)} (${delta >= 0 ? '+' : ''}${delta}%)` };
  } catch (e) {
    return failure('CSS', e);
  }
}

export const cssMode: ToolMode = {
  id: 'css',
  label: 'CSS',
  description: 'Beautify or minify CSS with structural validation.',
  category: 'Text',
  icon: 'css',
  emptyHint: 'Paste CSS to beautify it. Raw minifies.',
  sample: '.card{display:flex;gap:8px}.card:hover,.card:focus-visible{outline:2px solid #3b6cff}@media (max-width:600px){.card{flex-direction:column}}',
  outputLanguage: 'css',
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
        { value: 'tab', label: 'Tab' },
      ],
    },
  ],
  run: runCss,
};
