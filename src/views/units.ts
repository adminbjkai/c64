/**
 * Units renderer: one card per input quantity with a category badge and a
 * unit → value grid; the input's own unit is marked.
 */

import { h } from '../ui.js';
import type { UnitsData } from '../modes/unit-convert.js';
import type { ViewRenderer } from './types.js';
import { viewShell, cardList, kvTable, badge, muted } from './ui.js';

export const renderUnits: ViewRenderer = (host, raw) => {
  const d = raw as UnitsData;
  const { body } = viewShell(host);
  body.append(
    cardList(
      d.entries.map((e) => ({
        title: h('code', {}, e.input),
        meta: [badge('neutral', e.category), muted(`line ${e.line}`)],
        body: kvTable(
          e.rows.map((r) => ({
            label: h('span', {}, h('code', {}, r.symbol), ' ', muted(r.name)),
            value: r.value,
            copy: r.value,
            note: r.self ? badge('info', 'input') : undefined,
          })),
        ),
      })),
    ),
  );
};
