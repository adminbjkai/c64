/**
 * Cron renderer: the English description up top, a field-by-field breakdown
 * table, and the next runs with relative times.
 */

import { h } from '../ui.js';
import type { CronData } from '../modes/cron.js';
import type { ViewRenderer } from './types.js';
import { viewShell, section, dataTable, emptyState, copyable, badge, muted } from './ui.js';

export const renderCron: ViewRenderer = (host, raw) => {
  const d = raw as CronData;
  const { body } = viewShell(host);

  const sentence = copyable(d.description, { label: 'description' });
  sentence.classList.add('cron-sentence');
  body.append(
    section(
      'Schedule',
      { meta: h('span', {}, h('code', {}, d.expression), d.macro ? badge('neutral', `${d.macro} macro`) : null) },
      sentence,
      d.fields.length
        ? dataTable(
            [
              { key: 'field', label: 'Field' },
              { key: 'value', label: 'Value', mono: true },
              { key: 'meaning', label: 'Meaning', wrap: true },
            ],
            d.fields.map((f) => ({ field: { text: f.field, copy: false }, value: f.value, meaning: { text: f.meaning, copy: false } })),
          )
        : null,
    ),
  );

  body.append(
    section(
      d.runs.length ? `Next ${d.runs.length} runs` : 'Next runs',
      { meta: muted(d.timeZone) },
      d.runs.length
        ? dataTable(
            [
              { key: 'local', label: 'Local time', mono: true },
              { key: 'relative', label: 'Relative' },
              { key: 'iso', label: 'ISO 8601', mono: true },
            ],
            d.runs.map((r) => ({ local: r.local, relative: { text: r.relative, copy: false }, iso: r.iso })),
            { rowNum: true },
          )
        : emptyState(d.macro === '@reboot' ? 'Runs once when the scheduler starts, so there is no calendar schedule.' : 'No matching time in the next 5 years.'),
    ),
  );
};
