/**
 * Color renderer: a swatch per input line, its values in a table with copy
 * buttons, WCAG badges, and a 9-step tint/shade scale.
 */

import { h } from '../ui.js';
import type { ColorData, ColorEntry } from '../modes/color.js';
import type { ViewRenderer } from './types.js';
import type { WcagGrade } from '../lib/color.js';

const gradeClass: Record<WcagGrade, string> = { AAA: 'ok', AA: 'ok', 'AA Large': 'warn', Fail: 'bad' };

export const renderColor: ViewRenderer = (host, raw, ctx) => {
  const d = raw as ColorData;
  for (const c of d.colors) host.append(renderEntry(c, ctx));
};

function renderEntry(c: ColorEntry, ctx: Parameters<ViewRenderer>[2]): HTMLElement {
  const row = (label: string, value: string, extra?: Node | null): HTMLElement => {
    const copy = h('button.btn.small', { type: 'button' }, 'Copy');
    copy.addEventListener('click', () => ctx.copy(value, label));
    return h('tr', {}, h('td.color-label', {}, label), h('td.color-value', {}, h('code', {}, value), extra ?? null), h('td.color-copy', {}, copy));
  };
  const contrast = (label: string, cr: { ratio: number; grade: WcagGrade }): HTMLElement =>
    h('tr', {}, h('td.color-label', {}, label), h('td.color-value', {}, h('code', {}, `${cr.ratio.toFixed(2)}:1`), ' ', h(`span.badge.${gradeClass[cr.grade]}`, {}, cr.grade)), h('td.color-copy'));

  const body = h(
    'tbody',
    {},
    row('hex', c.hex),
    row('hex8', c.hex8),
    row('rgb', c.rgb),
    row('hsl', c.hsl),
    row('hwb', c.hwb),
    row('cmyk', c.cmyk),
    h('tr', {}, h('td.color-label', {}, 'luminance'), h('td.color-value', {}, h('code', {}, c.luminance.toFixed(4))), h('td.color-copy')),
    contrast('on white', c.contrastWhite),
    contrast('on black', c.contrastBlack),
    row('nearest', c.nearest.name, h('span.muted', {}, ` ${c.nearest.hex}${c.nearest.exact ? ' · exact' : ''}`)),
  );

  const scale = h('div.color-scale');
  for (const hex of c.scale) {
    const step = h('button.color-scale-step', { type: 'button', style: `background:${hex}`, title: hex, 'aria-label': `Copy ${hex}` });
    step.addEventListener('click', () => ctx.copy(hex, hex));
    scale.append(step);
  }

  return h(
    'section.color-item',
    {},
    h(
      'div.color-head',
      {},
      h('div.color-swatch', { style: `background:${c.css}`, title: c.input }),
      h('div.color-title', {}, h('code.color-input', {}, c.input), h('span.muted', {}, ` · line ${c.line}${c.alpha < 1 ? ` · alpha ${c.alpha.toFixed(2)}` : ''}`)),
    ),
    h('div.table-wrap', {}, h('table.csv-table.color-table', {}, body)),
    scale,
  );
}
