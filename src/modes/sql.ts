/**
 * SQL Formatter mode. Pretty = clause-per-line layout, Raw = one single-spaced
 * line per statement. Best-effort on any dialect; only an unterminated string
 * or comment is an error.
 */

import { type ToolMode, type ModeResult, type RunContext, failure, formatBytes, byteLength } from './types.js';
import { formatSql, minifySql, countStatements } from '../lib/sql.js';
import { indentString } from './json.js';

export function runSql(input: string, ctx: RunContext): ModeResult {
  if (input.trim() === '') return { output: '', status: '' };
  try {
    const uppercase = ctx.options['uppercaseKeywords'] !== false;
    const commaStyle = ctx.options['commaStyle'] === 'start' ? 'start' : 'end';
    const output = ctx.pretty ? formatSql(input, { indent: indentString(ctx.options['indent']), uppercase, commaStyle }) : minifySql(input, { uppercase });
    const n = countStatements(input);
    return { output, status: `${n} statement${n === 1 ? '' : 's'} · ${formatBytes(byteLength(output))}` };
  } catch (e) {
    return failure('SQL', e);
  }
}

export const sqlMode: ToolMode = {
  id: 'sql',
  label: 'SQL Formatter',
  description: 'Lay out SQL one clause per line with consistent keyword casing, or squash it onto one line per statement.',
  category: 'Formats',
  icon: 'database',
  keywords: ['query', 'mysql', 'postgres', 'sqlite', 'beautify', 'prettify', 'select'],
  emptyHint: 'Paste SQL to format it. Raw minifies to one line per statement.',
  sample:
    "select u.id, u.name, count(o.id) as orders, sum(o.total) as spent from users u left join orders o on o.user_id = u.id where u.active = 1 and u.created_at >= '2024-01-01' and u.id in (select user_id from subscriptions where plan <> 'free') group by u.id, u.name having count(o.id) > 0 order by spent desc limit 10;\ninsert into audit_log (user_id, action) values (1, 'login'), (2, 'logout');",
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
    { kind: 'toggle', key: 'uppercaseKeywords', label: 'Uppercase keywords', default: true },
    {
      kind: 'select',
      key: 'commaStyle',
      label: 'Commas',
      default: 'end',
      options: [
        { value: 'end', label: 'End of line' },
        { value: 'start', label: 'Start of line' },
      ],
    },
  ],
  run: runSql,
};
