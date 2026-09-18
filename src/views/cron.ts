/**
 * Cron renderer: the English description up top, a field-by-field breakdown
 * table, and the next runs with relative times.
 */

import { h } from '../ui.js';
import type { CronData } from '../modes/cron.js';
import type { ViewRenderer } from './types.js';

export const renderCron: ViewRenderer = (host, raw, ctx) => {
  const d = raw as CronData;

  const copyDesc = h('button.btn.small', { type: 'button' }, 'Copy');
  copyDesc.addEventListener('click', () => ctx.copy(d.description, 'description'));
  host.append(
    h('div.cron-head', {}, h('code.cron-expr', {}, d.expression), d.macro ? h('span.badge.muted', {}, `${d.macro} macro`) : null),
    h('div.cron-desc', {}, h('span.cron-desc-text', {}, d.description), copyDesc),
  );

  if (d.fields.length) {
    const body = h('tbody');
    for (const f of d.fields) body.append(h('tr', {}, h('td.cron-field', {}, f.field), h('td', {}, h('code', {}, f.value)), h('td.cron-meaning', {}, f.meaning)));
    host.append(h('div.table-wrap', {}, h('table.csv-table.cron-table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Field'), h('th', {}, 'Value'), h('th', {}, 'Meaning'))), body)));
  }

  const runsHead = h('div.cron-runs-head', {}, h('h3', {}, d.runs.length ? `Next ${d.runs.length} runs` : 'Next runs'), h('span.muted', {}, ` · ${d.timeZone}`));
  const list = h('ol.cron-runs');
  for (const r of d.runs) {
    const copy = h('button.btn.small', { type: 'button', title: r.iso }, 'Copy ISO');
    copy.addEventListener('click', () => ctx.copy(r.iso, 'timestamp'));
    list.append(h('li.cron-run', {}, h('code.cron-run-time', {}, r.local), h('span.cron-run-rel.muted', {}, r.relative), copy));
  }
  if (!d.runs.length) list.append(h('li.cron-run.muted', {}, d.macro === '@reboot' ? 'Runs once at scheduler start; no calendar schedule.' : 'No matching time in the next 5 years.'));
  host.append(runsHead, list);
};
