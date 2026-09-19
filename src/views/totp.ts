/**
 * TOTP renderer: big current code (click to copy), a countdown bar that
 * ticks every second and asks the pane to re-run the mode when the period
 * rolls over, then the neighbouring codes and settings as copyable rows.
 */

import { h } from '../ui.js';
import type { TotpData } from '../modes/totp.js';
import type { ViewRenderer } from './types.js';
import { viewShell, section, kvTable, copyable, badge, muted, facts, type KvRow } from './ui.js';

export function groupCode(code: string): string {
  if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`;
  if (code.length === 8) return `${code.slice(0, 4)} ${code.slice(4)}`;
  return code;
}

export const renderTotp: ViewRenderer = (host, raw, ctx) => {
  const d = raw as TotpData;
  const totp = d.mode === 'totp';
  const code = copyable(d.code, { label: 'code', display: groupCode(d.code) });
  code.classList.add('totp-code');

  const remainingEl = h('span.totp-remaining', {}, `${d.remaining}s`);
  const fill = h('div.totp-ring-fill');
  const ring = h('div.totp-ring', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': d.period, 'aria-valuenow': d.remaining }, fill);
  const setProgress = (remaining: number) => {
    fill.style.width = `${Math.max(0, Math.min(100, (remaining / d.period) * 100))}%`;
    ring.classList.toggle('is-low', remaining <= 5);
    ring.setAttribute('aria-valuenow', String(remaining));
    remainingEl.textContent = `${remaining}s`;
  };
  setProgress(d.remaining);

  const rows: KvRow[] = [
    { label: totp ? 'Previous code' : 'Counter − 1', value: groupCode(d.prev), copy: d.prev },
    { label: totp ? 'Next code' : 'Counter + 1', value: groupCode(d.next), copy: d.next },
    { label: 'Algorithm', value: d.algorithm, copy: false },
    { label: 'Digits', value: String(d.digits), copy: false },
    totp ? { label: 'Period', value: `${d.period} s`, copy: false } : { label: 'Counter', value: String(d.counter), copy: false },
  ];
  if (d.issuer) rows.push({ label: 'Issuer', value: d.issuer });
  if (d.account) rows.push({ label: 'Account', value: d.account });
  rows.push({ label: 'otpauth URL', value: d.url });

  const { body } = viewShell(host, { status: [badge('neutral', d.mode.toUpperCase()), muted(facts(d.algorithm, `${d.digits} digits`, totp ? `${d.period} s` : `counter ${d.counter}`))] });
  body.append(h('div.totp-head', {}, code, h('div.totp-timer', { hidden: !totp }, ring, remainingEl)), section('Details', {}, kvTable(rows)));

  if (!totp) return;
  // Count down from the reference time the mode used; re-run when the period rolls over.
  const startedAt = Date.now();
  let lastWindow = Math.floor(d.now / 1000 / d.period);
  const timer = setInterval(() => {
    const now = d.now + (Date.now() - startedAt);
    const win = Math.floor(now / 1000 / d.period);
    if (win !== lastWindow) {
      lastWindow = win;
      clearInterval(timer);
      ctx.setOption('tick', Date.now());
      return;
    }
    setProgress(d.period - (Math.floor(now / 1000) % d.period));
  }, 1000);
  return () => clearInterval(timer);
};
