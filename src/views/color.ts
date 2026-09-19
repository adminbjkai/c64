/**
 * Color renderer: a card per input line with a swatch in the head, its
 * values as copyable rows, WCAG badges, and a 9-step tint/shade scale.
 */

import { h } from '../ui.js';
import type { ColorData, ColorEntry } from '../modes/color.js';
import type { ViewRenderer } from './types.js';
import type { WcagGrade } from '../lib/color.js';
import { viewShell, cardList, kvTable, badge, muted, copyInline, facts, type Card, type Tone } from './ui.js';

const GRADE: Record<WcagGrade, Tone> = { AAA: 'ok', AA: 'ok', 'AA Large': 'warn', Fail: 'danger' };

export const renderColor: ViewRenderer = (host, raw) => {
  const d = raw as ColorData;
  const { body } = viewShell(host);
  body.append(cardList(d.colors.map(card)));
};

function card(c: ColorEntry): Card {
  const contrast = (label: string, cr: { ratio: number; grade: WcagGrade }) => ({ label, value: `${cr.ratio.toFixed(2)}:1`, note: badge(GRADE[cr.grade], cr.grade) });
  const rows = kvTable([
    { label: 'hex', value: c.hex },
    { label: 'hex8', value: c.hex8 },
    { label: 'rgb', value: c.rgb },
    { label: 'hsl', value: c.hsl },
    { label: 'hwb', value: c.hwb },
    { label: 'cmyk', value: c.cmyk },
    { label: 'luminance', value: c.luminance.toFixed(4) },
    contrast('on white', c.contrastWhite),
    contrast('on black', c.contrastBlack),
    { label: 'nearest', value: c.nearest.name, note: muted(facts(c.nearest.hex, c.nearest.exact ? 'exact' : null)) },
  ]);
  const scale = h('div.color-scale', { role: 'group', 'aria-label': 'Tints and shades' });
  for (const hex of c.scale) {
    const step = h('button.color-scale-step', { type: 'button', style: `background:${hex}`, title: `Copy ${hex}`, 'aria-label': `Copy ${hex}` });
    step.addEventListener('click', () => copyInline(step, hex));
    scale.append(step);
  }
  return {
    title: h('span.color-title', {}, h('span.color-swatch', { style: `--sw:${c.css}` }), h('code', {}, c.input)),
    meta: [muted(facts(`line ${c.line}`, c.alpha < 1 ? `alpha ${c.alpha.toFixed(2)}` : null))],
    body: [rows, scale],
  };
}
