/**
 * HTML Format / Minify mode. Pretty = indented by nesting (inline elements
 * stay on their text line), Raw = minified. Tolerant: unclosed and stray tags
 * are notes; mismatched nesting is an error only with the `strict` toggle.
 */

import { type ToolMode, type ModeResult, type RunContext, formatBytes, byteLength } from './types.js';
import { parseHtml, formatHtml, minifyHtml } from '../lib/html.js';
import { indentString } from './json.js';

export function runHtml(input: string, ctx: RunContext): ModeResult {
  if (input.trim() === '') return { output: '', status: '' };
  const doc = parseHtml(input);
  const output = ctx.pretty ? formatHtml(doc, { indent: indentString(ctx.options['indent']) }) : minifyHtml(doc, { keepComments: ctx.options['keepComments'] === true });
  const strict = ctx.options['strict'] === true;
  const n = doc.elementCount;
  const notes = doc.notes.length ? doc.notes : undefined;
  const first = doc.nesting[0];
  if (strict && first) {
    return {
      output,
      notes,
      error: { message: first.message, line: first.line, col: first.col, hint: first.hint },
      status: `Invalid HTML · line ${first.line}, col ${first.col}`,
    };
  }
  return {
    output,
    notes,
    status: `${ctx.pretty ? 'Formatted' : 'Minified'} · ${n} element${n === 1 ? '' : 's'} · ${formatBytes(byteLength(output))}`,
  };
}

export const htmlMode: ToolMode = {
  id: 'html',
  label: 'HTML Format / Minify',
  description: 'Pretty-print or minify HTML, tolerating real-world markup and flagging unclosed or stray tags.',
  category: 'Formats',
  icon: 'html',
  keywords: ['markup', 'beautify', 'tidy', 'prettify', 'dom'],
  emptyHint: 'Paste HTML to indent it. Raw minifies; toggle Strict to fail on mismatched nesting.',
  sample:
    '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><title>Hello</title>\n<style>\n  body { margin: 0 }\n</style></head>\n<body><!-- main --><div class=card id="c1"><h1>Hello, <em>world</em>!</h1><p>Some <a href="/x">link</a> text.<br>Next line</p>\n<ul><li>One<li>Two</ul><pre>\n  keep   this\n</pre><script>if (a < b) { go() }</script></div></body></html>',
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
    { kind: 'toggle', key: 'keepComments', label: 'Keep comments (Raw)', default: false },
    { kind: 'toggle', key: 'strict', label: 'Strict nesting', default: false },
  ],
  run: runHtml,
};
