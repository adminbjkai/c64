/**
 * Generic Minify / Prettify: whitespace-only transforms for JSON, XML or
 * CSS, auto-detected (or forced). Pretty = prettify, Raw = minify. Useful
 * when you just want the transform and don't care which tool it is.
 */

import { type ToolMode, type ModeResult, type RunContext, failure, formatBytes, byteLength } from './types.js';
import { parseJson, indentString } from './json.js';
import { parseXml, formatXml, minifyXml } from '../lib/xml.js';
import { formatCss, minifyCss } from '../lib/css.js';

type Kind = 'json' | 'xml' | 'css';

export function sniffMinifyKind(text: string): Kind {
  const t = text.trim();
  if (t.startsWith('<')) return 'xml';
  if (t.startsWith('{') || t.startsWith('[')) {
    // `{` could be CSS too ("{a:1}" is unlikely CSS); prefer JSON if it parses.
    try {
      parseJson(t);
      return 'json';
    } catch {
      return /[^{}]+\{/.test(t) ? 'css' : 'json';
    }
  }
  return 'css';
}

export function runMinify(input: string, ctx: RunContext): ModeResult {
  if (input.trim() === '') return { output: '', status: '' };
  const k = ctx.options['kind'];
  const kind: Kind = k === 'json' || k === 'xml' || k === 'css' ? k : sniffMinifyKind(input);
  const indent = indentString(ctx.options['indent']);
  try {
    let output: string;
    if (kind === 'json') {
      const v = parseJson(input).value;
      output = ctx.pretty ? JSON.stringify(v, null, indent) : JSON.stringify(v);
    } else if (kind === 'xml') {
      const doc = parseXml(input);
      output = ctx.pretty ? formatXml(doc, { indent }) : minifyXml(doc);
    } else {
      output = ctx.pretty ? formatCss(input, { indent }) : minifyCss(input);
    }
    return {
      output,
      status: `${ctx.pretty ? 'Prettified' : 'Minified'} ${kind.toUpperCase()} · ${formatBytes(byteLength(input))} → ${formatBytes(byteLength(output))}`,
      notes: k === 'auto' || k === undefined ? [`Detected ${kind.toUpperCase()}.`] : undefined,
    };
  } catch (e) {
    return failure(kind.toUpperCase(), e);
  }
}

export const minifyMode: ToolMode = {
  id: 'minify',
  label: 'Minify / Prettify',
  description: 'Squeeze or expand JSON, XML or CSS without changing anything else.',
  category: 'Text',
  icon: 'minify',
  emptyHint: 'Paste JSON, XML or CSS. Pretty expands it, Raw squeezes it — nothing else changes.',
  sample: '{"a":[1,2,3],"b":{"c":"d"}}',
  supportsPretty: true,
  controls: [
    {
      kind: 'select',
      key: 'kind',
      label: 'Language',
      default: 'auto',
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'json', label: 'JSON' },
        { value: 'xml', label: 'XML' },
        { value: 'css', label: 'CSS' },
      ],
    },
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
  run: runMinify,
};
