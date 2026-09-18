/**
 * XML Format / Validate mode. Pretty = indented, Raw = minified.
 */

import { type ToolMode, type ModeResult, type RunContext, failure, formatBytes, byteLength } from './types.js';
import { parseXml, formatXml, minifyXml } from '../lib/xml.js';
import { indentString } from './json.js';

function countElements(doc: ReturnType<typeof parseXml>): number {
  let n = 0;
  const walk = (nodes: { type: string; children?: unknown[] }[]): void => {
    for (const node of nodes) {
      if (node.type === 'element') {
        n++;
        walk((node.children ?? []) as { type: string; children?: unknown[] }[]);
      }
    }
  };
  walk(doc.children);
  return n;
}

export function runXml(input: string, ctx: RunContext): ModeResult {
  if (input.trim() === '') return { output: '', status: '' };
  try {
    const doc = parseXml(input);
    const output = ctx.pretty ? formatXml(doc, { indent: indentString(ctx.options['indent']) }) : minifyXml(doc);
    const n = countElements(doc);
    return { output, status: `Well-formed XML · ${n} element${n === 1 ? '' : 's'} · ${formatBytes(byteLength(output))}` };
  } catch (e) {
    return failure('XML', e);
  }
}

export const xmlMode: ToolMode = {
  id: 'xml',
  label: 'XML Format / Validate',
  description: 'Pretty-print or minify XML and check it is well-formed.',
  category: 'Formats',
  icon: 'xml',
  emptyHint: 'Paste XML to pretty-print and check well-formedness. Raw minifies.',
  sample: '<?xml version="1.0" encoding="UTF-8"?><catalog><book id="bk101" lang="en"><author>Gambardella, Matthew</author><title>XML Developer\'s Guide</title><price>44.95</price></book><book id="bk102"><author>Ralls, Kim</author><title>Midnight Rain</title><price>5.95</price></book></catalog>',
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
  run: runXml,
};
