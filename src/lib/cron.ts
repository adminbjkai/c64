/**
 * cron.ts — cron expression parser, plain-English describer and next-run
 * calculator. No dependencies; time-zone handling goes through Intl.
 *
 * Subset implemented
 * ------------------
 * - 5 fields (min hour dom mon dow), 6 fields (sec + 5) or 7 fields
 *   (sec + 5 + year), detected by count.
 * - Per field: `*` / `?`, single values, ranges `a-b`, steps `* /n`, `a-b/n`,
 *   `a/n` (a through max), lists `a,b,c`, month names JAN–DEC and day names
 *   SUN–SAT (case-insensitive; 7 = Sunday).
 * - Quartz-style extras: `L` and `L-n` in day-of-month, `nW` / `LW`
 *   (nearest weekday) in day-of-month, `nL` (last weekday n of the month)
 *   and `n#k` (k-th weekday n) in day-of-week.
 * - Macros: @yearly / @annually, @monthly, @weekly, @daily / @midnight,
 *   @hourly and @reboot (which has no schedule).
 * - Day matching follows Vixie cron: when both day-of-month and day-of-week
 *   are restricted, a day matches if EITHER does.
 *
 * Next runs are found by an iterative matcher that steps a minute (or second)
 * at a time but skips whole days / hours that cannot match, so even sparse
 * schedules stay fast. The search is capped at 5 years.
 */

export class CronError extends Error {
  constructor(
    message: string,
    /** 0-based field index, or -1 when the problem is not tied to a field. */
    public field: number,
    /** 1-based column of the offending token in the expression. */
    public col: number,
    public hint?: string,
  ) {
    super(message);
    this.name = 'CronError';
  }
}

export type FieldName = 'second' | 'minute' | 'hour' | 'dayOfMonth' | 'month' | 'dayOfWeek' | 'year';

export interface FieldSpec {
  name: FieldName;
  label: string;
  min: number;
  max: number;
  names?: string[];
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const SPECS: Record<FieldName, FieldSpec> = {
  second: { name: 'second', label: 'Seconds', min: 0, max: 59 },
  minute: { name: 'minute', label: 'Minutes', min: 0, max: 59 },
  hour: { name: 'hour', label: 'Hours', min: 0, max: 23 },
  dayOfMonth: { name: 'dayOfMonth', label: 'Day of month', min: 1, max: 31 },
  month: { name: 'month', label: 'Month', min: 1, max: 12, names: MONTHS },
  dayOfWeek: { name: 'dayOfWeek', label: 'Day of week', min: 0, max: 7, names: DAYS },
  year: { name: 'year', label: 'Year', min: 1970, max: 2099 },
};

export type CronItem =
  | { type: 'any' }
  | { type: 'value'; value: number }
  | { type: 'range'; from: number; to: number; step: number }
  | { type: 'step'; from: number; step: number }
  | { type: 'last'; offset: number }
  | { type: 'lastWeekday' }
  | { type: 'nearestWeekday'; day: number }
  | { type: 'lastDow'; dow: number }
  | { type: 'nthDow'; dow: number; n: number };

export interface CronField {
  spec: FieldSpec;
  raw: string;
  items: CronItem[];
  /** True when the field imposes no restriction (`*` or `?`). */
  any: boolean;
  /** Plain values allowed by the simple items (values/ranges/steps). */
  values: Set<number>;
  col: number;
}

export interface CronExpression {
  raw: string;
  /** The macro used, e.g. "@daily", or undefined. */
  macro?: string;
  reboot: boolean;
  fields: CronField[];
  hasSeconds: boolean;
  hasYear: boolean;
}

const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

function byName(field: FieldName): (f: CronField) => boolean {
  return (f) => f.spec.name === field;
}

export function parseCron(input: string): CronExpression {
  const lines = input.split('\n').map((l) => l.trim());
  const nonEmpty = lines.map((l, i) => [l, i] as const).filter(([l]) => l !== '');
  if (nonEmpty.length === 0) throw new CronError('Empty expression', -1, 1);
  if (nonEmpty.length > 1) {
    throw new CronError(`Only one cron expression is supported (extra text on line ${nonEmpty[1]![1] + 1})`, -1, 1, 'Remove the extra lines and keep a single expression.');
  }
  const raw = nonEmpty[0]![0];
  let macro: string | undefined;
  let text = raw;
  if (raw.startsWith('@')) {
    const key = raw.toLowerCase();
    if (key === '@reboot') return { raw, macro: '@reboot', reboot: true, fields: [], hasSeconds: false, hasYear: false };
    const expanded = MACROS[key];
    if (!expanded) throw new CronError(`Unknown macro ${raw}`, -1, 1, 'Known macros: @yearly, @annually, @monthly, @weekly, @daily, @midnight, @hourly, @reboot.');
    macro = key;
    text = expanded;
  }
  const tokens: { text: string; col: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) tokens.push({ text: m[0], col: macro ? 1 : m.index + 1 });
  let order: FieldName[];
  if (tokens.length === 5) order = ['minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek'];
  else if (tokens.length === 6) order = ['second', 'minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek'];
  else if (tokens.length === 7) order = ['second', 'minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek', 'year'];
  else throw new CronError(`Expected 5, 6 or 7 fields, got ${tokens.length}`, -1, 1, 'Standard cron is "minute hour day-of-month month day-of-week"; add a leading seconds field and/or a trailing year field for 6 or 7.');
  const fields = tokens.map((tok, i) => parseField(tok.text, SPECS[order[i]!], i, tok.col));
  return { raw, macro, reboot: false, fields, hasSeconds: tokens.length >= 6, hasYear: tokens.length === 7 };
}

function parseField(raw: string, spec: FieldSpec, index: number, col: number): CronField {
  const fail = (msg: string, hint?: string): never => {
    throw new CronError(`${spec.label} field: ${msg}`, index, col, hint);
  };
  const num = (s: string): number => {
    const up = s.toUpperCase();
    if (spec.names) {
      const idx = spec.names.indexOf(up);
      if (idx >= 0) return spec.name === 'month' ? idx + 1 : idx;
    }
    if (!/^\d+$/.test(s)) fail(`"${s}" is not a number${spec.names ? ' or a name' : ''}`, spec.names ? `Use ${spec.min}-${spec.max} or ${spec.names[0]}-${spec.names[spec.names.length - 1]}.` : `Use a value from ${spec.min} to ${spec.max}.`);
    const v = parseInt(s, 10);
    if (v < spec.min || v > spec.max) fail(`${v} is out of range ${spec.min}-${spec.max}`);
    return spec.name === 'dayOfWeek' && v === 7 ? 0 : v;
  };
  const items: CronItem[] = [];
  const values = new Set<number>();
  const addRange = (from: number, to: number, step: number): void => {
    for (let v = from; v <= to; v += step) values.add(v);
  };
  let any = false;
  if (raw === '*' || raw === '?') {
    any = true;
    items.push({ type: 'any' });
  } else {
    for (const part of raw.split(',')) {
      if (part === '') fail('empty list item', 'Remove the extra comma.');
      const up = part.toUpperCase();
      if (spec.name === 'dayOfMonth') {
        if (up === 'L') {
          items.push({ type: 'last', offset: 0 });
          continue;
        }
        const lm = /^L-(\d+)$/.exec(up);
        if (lm) {
          items.push({ type: 'last', offset: parseInt(lm[1]!, 10) });
          continue;
        }
        if (up === 'LW') {
          items.push({ type: 'lastWeekday' });
          continue;
        }
        const wm = /^(\d+)W$/.exec(up);
        if (wm) {
          const d = parseInt(wm[1]!, 10);
          if (d < 1 || d > 31) fail(`${d}W is out of range 1W-31W`);
          items.push({ type: 'nearestWeekday', day: d });
          continue;
        }
      }
      if (spec.name === 'dayOfWeek') {
        const lm = /^([A-Z0-9]+)L$/.exec(up);
        if (lm && up !== 'L') {
          items.push({ type: 'lastDow', dow: num(lm[1]!) });
          continue;
        }
        if (up === 'L') {
          items.push({ type: 'lastDow', dow: 6 });
          continue;
        }
        const hm = /^([A-Z0-9]+)#(\d+)$/.exec(up);
        if (hm) {
          const n = parseInt(hm[2]!, 10);
          if (n < 1 || n > 5) fail(`#${n} must be between #1 and #5`);
          items.push({ type: 'nthDow', dow: num(hm[1]!), n });
          continue;
        }
      }
      if (/^(L|L-\d+|LW|\d+W|[A-Z0-9]+L|[A-Z0-9]+#\d+)$/i.test(part)) fail(`"${part}" is not valid here`, 'L, W and # are only allowed in the day-of-month (L, L-n, nW, LW) and day-of-week (nL, n#k) fields.');
      const [rangePart, stepPart, extra] = part.split('/');
      if (extra !== undefined) fail(`"${part}" has more than one "/"`);
      let step = 1;
      if (stepPart !== undefined) {
        if (!/^\d+$/.test(stepPart) || parseInt(stepPart, 10) < 1) fail(`step "/${stepPart}" must be a positive number`);
        step = parseInt(stepPart, 10);
      }
      if (rangePart === '*' || rangePart === '?') {
        if (stepPart === undefined) {
          any = true;
          items.push({ type: 'any' });
        } else {
          items.push({ type: 'step', from: spec.min, step });
          addRange(spec.min, spec.name === 'dayOfWeek' ? 6 : spec.max, step);
        }
        continue;
      }
      const dash = rangePart!.indexOf('-');
      if (dash > 0) {
        const from = num(rangePart!.slice(0, dash));
        let to = num(rangePart!.slice(dash + 1));
        if (spec.name === 'dayOfWeek' && to === 0 && rangePart!.slice(dash + 1) === '7') to = 7;
        if (to < from) fail(`range ${rangePart} runs backwards`, 'Put the smaller value first.');
        items.push({ type: 'range', from, to, step });
        addRange(from, to, step);
        if (spec.name === 'dayOfWeek' && to === 7) {
          values.delete(7);
          values.add(0);
        }
      } else if (stepPart !== undefined) {
        const from = num(rangePart!);
        items.push({ type: 'step', from, step });
        addRange(from, spec.name === 'dayOfWeek' ? 6 : spec.max, step);
      } else {
        const v = num(rangePart!);
        items.push({ type: 'value', value: v });
        values.add(v);
      }
    }
  }
  if (any) items.splice(0, items.length, { type: 'any' });
  return { spec, raw, items, any, values, col };
}

/* ------------------------------------------------------------ describer */

const pad2 = (n: number): string => String(n).padStart(2, '0');

function listJoin(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth'];

function valueName(f: CronField, v: number): string {
  if (f.spec.name === 'month') return MONTH_NAMES[v - 1] ?? String(v);
  if (f.spec.name === 'dayOfWeek') return DAY_NAMES[v % 7] ?? String(v);
  return String(v);
}

/** "every minute", "every 5 minutes", "at minute 30", "every minute from 5 through 10". */
function describeSimple(f: CronField, unit: string, plural: string): string {
  if (f.any) return `every ${unit}`;
  const parts: string[] = [];
  const singles: string[] = [];
  for (const it of f.items) {
    if (it.type === 'value') singles.push(valueName(f, it.value));
    else if (it.type === 'range') parts.push(it.step === 1 ? `every ${unit} from ${valueName(f, it.from)} through ${valueName(f, it.to)}` : `every ${it.step} ${plural} from ${valueName(f, it.from)} through ${valueName(f, it.to)}`);
    else if (it.type === 'step') parts.push(it.from === f.spec.min ? `every ${it.step} ${plural}` : `every ${it.step} ${plural} from ${valueName(f, it.from)} through ${valueName(f, f.spec.name === 'dayOfWeek' ? 6 : f.spec.max)}`);
  }
  if (singles.length) parts.unshift(`at ${unit} ${listJoin(singles)}`);
  return listJoin(parts);
}

function describeDay(f: CronField): string {
  if (f.any) return '';
  const parts: string[] = [];
  const singles: string[] = [];
  for (const it of f.items) {
    switch (it.type) {
      case 'value':
        singles.push(valueName(f, it.value));
        break;
      case 'range':
        parts.push(it.step === 1 ? `on every ${f.spec.name === 'dayOfWeek' ? 'day-of-week' : 'day-of-month'} from ${valueName(f, it.from)} through ${valueName(f, it.to)}` : `on every ${it.step}${ordinalSuffix(it.step)} ${f.spec.name === 'dayOfWeek' ? 'day-of-week' : 'day-of-month'} from ${valueName(f, it.from)} through ${valueName(f, it.to)}`);
        break;
      case 'step':
        parts.push(`on every ${it.step}${ordinalSuffix(it.step)} ${f.spec.name === 'dayOfWeek' ? 'day-of-week' : 'day-of-month'}${it.from !== f.spec.min ? ` from ${valueName(f, it.from)} through ${valueName(f, f.spec.name === 'dayOfWeek' ? 6 : f.spec.max)}` : ''}`);
        break;
      case 'last':
        parts.push(it.offset === 0 ? 'on the last day of the month' : `${it.offset} day${it.offset === 1 ? '' : 's'} before the end of the month`);
        break;
      case 'lastWeekday':
        parts.push('on the last weekday of the month');
        break;
      case 'nearestWeekday':
        parts.push(`on the weekday nearest day ${it.day} of the month`);
        break;
      case 'lastDow':
        parts.push(`on the last ${DAY_NAMES[it.dow]} of the month`);
        break;
      case 'nthDow':
        parts.push(`on the ${ORDINALS[it.n]} ${DAY_NAMES[it.dow]} of the month`);
        break;
      default:
        break;
    }
  }
  if (singles.length) parts.unshift(f.spec.name === 'dayOfWeek' ? `on ${listJoin(singles)}` : `on day-of-month ${listJoin(singles)}`);
  return listJoin(parts);
}

function ordinalSuffix(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
}

function describeMonth(f: CronField): string {
  if (f.any) return '';
  const parts: string[] = [];
  const singles: string[] = [];
  for (const it of f.items) {
    if (it.type === 'value') singles.push(valueName(f, it.value));
    else if (it.type === 'range') parts.push(it.step === 1 ? `in every month from ${valueName(f, it.from)} through ${valueName(f, it.to)}` : `in every ${it.step}${ordinalSuffix(it.step)} month from ${valueName(f, it.from)} through ${valueName(f, it.to)}`);
    else if (it.type === 'step') parts.push(`in every ${it.step}${ordinalSuffix(it.step)} month${it.from !== 1 ? ` from ${valueName(f, it.from)} through December` : ''}`);
  }
  if (singles.length) parts.unshift(`in ${listJoin(singles)}`);
  return listJoin(parts);
}

function describeYear(f: CronField): string {
  if (f.any) return '';
  const parts: string[] = [];
  const singles: string[] = [];
  for (const it of f.items) {
    if (it.type === 'value') singles.push(String(it.value));
    else if (it.type === 'range') parts.push(it.step === 1 ? `in every year from ${it.from} through ${it.to}` : `in every ${it.step}${ordinalSuffix(it.step)} year from ${it.from} through ${it.to}`);
    else if (it.type === 'step') parts.push(`in every ${it.step}${ordinalSuffix(it.step)} year from ${it.from}`);
  }
  if (singles.length) parts.unshift(`in ${listJoin(singles)}`);
  return listJoin(parts);
}

const onlySingles = (f: CronField): number[] | null => {
  if (f.any) return null;
  const vals: number[] = [];
  for (const it of f.items) {
    if (it.type !== 'value') return null;
    vals.push(it.value);
  }
  return vals;
};

function describeTime(sec: CronField | undefined, min: CronField, hour: CronField): string {
  const mins = onlySingles(min);
  const hours = onlySingles(hour);
  const secs = sec ? onlySingles(sec) : [0];
  if (mins && hours && secs && mins.length * hours.length * secs.length <= 8) {
    const times: string[] = [];
    for (const h of hours) for (const mi of mins) for (const s of secs) times.push(`${pad2(h)}:${pad2(mi)}${sec && !(secs.length === 1 && s === 0) ? `:${pad2(s)}` : ''}`);
    return `At ${listJoin(times)}`;
  }
  const parts: string[] = [];
  if (sec && !(secs && secs.length === 1 && secs[0] === 0)) parts.push(describeSimple(sec, 'second', 'seconds'));
  parts.push(describeSimple(min, 'minute', 'minutes'));
  if (hours) parts.push(`past ${hours.length === 1 ? 'hour' : 'hours'} ${listJoin(hours.map(String))}`);
  else if (!hour.any) {
    const hp: string[] = [];
    for (const it of hour.items) {
      if (it.type === 'range' && it.step === 1) hp.push(`between ${pad2(it.from)}:00 and ${pad2(it.to)}:59`);
      else if (it.type === 'range') hp.push(`every ${it.step} hours from ${it.from} through ${it.to}`);
      else if (it.type === 'step') hp.push(it.from === 0 ? `every ${it.step} hours` : `every ${it.step} hours from ${it.from} through 23`);
      else if (it.type === 'value') hp.push(`past hour ${it.value}`);
    }
    parts.push(listJoin(hp));
  }
  const s = parts.join(', ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** One sentence, e.g. "At 05:30 on every day-of-week from Monday through Friday in March". */
export function describeCron(expr: CronExpression): string {
  if (expr.reboot) return 'At system startup';
  const get = (name: FieldName): CronField | undefined => expr.fields.find(byName(name));
  const sec = get('second');
  const min = get('minute')!;
  const hour = get('hour')!;
  const dom = get('dayOfMonth')!;
  const mon = get('month')!;
  const dow = get('dayOfWeek')!;
  const year = get('year');
  const parts = [describeTime(sec, min, hour)];
  const domText = describeDay(dom);
  const dowText = describeDay(dow);
  if (domText && dowText) parts.push(`${domText} and ${dowText}`);
  else if (domText) parts.push(domText);
  else if (dowText) parts.push(dowText);
  const monText = describeMonth(mon);
  if (monText) parts.push(monText);
  if (year) {
    const y = describeYear(year);
    if (y) parts.push(y);
  }
  return parts.join(' ');
}

/** Per-field meaning for the breakdown table. */
export function describeField(f: CronField): string {
  switch (f.spec.name) {
    case 'second':
      return describeSimple(f, 'second', 'seconds');
    case 'minute':
      return describeSimple(f, 'minute', 'minutes');
    case 'hour':
      return describeSimple(f, 'hour', 'hours');
    case 'dayOfMonth':
      return f.any ? 'every day of the month' : describeDay(f);
    case 'dayOfWeek':
      return f.any ? 'every day of the week' : describeDay(f);
    case 'month':
      return f.any ? 'every month' : describeMonth(f);
    case 'year':
      return f.any ? 'every year' : describeYear(f);
  }
}

/* ------------------------------------------------------------- matching */

export interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday. */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  });
}

export function partsAt(fmt: Intl.DateTimeFormat, t: number): DateParts {
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(t))) p[part.type] = part.value;
  return {
    year: parseInt(p['year'] ?? '0', 10),
    month: parseInt(p['month'] ?? '0', 10),
    day: parseInt(p['day'] ?? '0', 10),
    hour: parseInt(p['hour'] ?? '0', 10) % 24,
    minute: parseInt(p['minute'] ?? '0', 10),
    second: parseInt(p['second'] ?? '0', 10),
    weekday: WEEKDAY_INDEX[p['weekday'] ?? 'Sun'] ?? 0,
  };
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();
const weekdayOf = (year: number, month: number, day: number): number => new Date(Date.UTC(year, month - 1, day)).getUTCDay();

function nearestWeekday(year: number, month: number, target: number): number {
  const dim = daysInMonth(year, month);
  const d = Math.min(target, dim);
  const wd = weekdayOf(year, month, d);
  if (wd === 6) return d - 1 >= 1 ? d - 1 : d + 2;
  if (wd === 0) return d + 1 <= dim ? d + 1 : d - 2;
  return d;
}

function domMatches(f: CronField, p: DateParts): boolean {
  if (f.any) return true;
  if (f.values.has(p.day)) return true;
  const dim = daysInMonth(p.year, p.month);
  for (const it of f.items) {
    if (it.type === 'last' && p.day === dim - it.offset) return true;
    if (it.type === 'lastWeekday') {
      const wd = weekdayOf(p.year, p.month, dim);
      const last = wd === 6 ? dim - 1 : wd === 0 ? dim - 2 : dim;
      if (p.day === last) return true;
    }
    if (it.type === 'nearestWeekday' && p.day === nearestWeekday(p.year, p.month, it.day)) return true;
  }
  return false;
}

function dowMatches(f: CronField, p: DateParts): boolean {
  if (f.any) return true;
  if (f.values.has(p.weekday)) return true;
  for (const it of f.items) {
    if (it.type === 'lastDow' && p.weekday === it.dow && p.day + 7 > daysInMonth(p.year, p.month)) return true;
    if (it.type === 'nthDow' && p.weekday === it.dow && Math.ceil(p.day / 7) === it.n) return true;
  }
  return false;
}

function dayMatches(dom: CronField, dow: CronField, p: DateParts): boolean {
  if (dom.any && dow.any) return true;
  if (dom.any) return dowMatches(dow, p);
  if (dow.any) return domMatches(dom, p);
  return domMatches(dom, p) || dowMatches(dow, p);
}

export interface NextRunOptions {
  now: number;
  timeZone?: string;
  count?: number;
  /** Search horizon in ms (default 5 years). */
  horizon?: number;
}

/** Epoch-ms timestamps of the next `count` runs strictly after `now`. */
export function nextRuns(expr: CronExpression, opts: NextRunOptions): number[] {
  if (expr.reboot) return [];
  const count = opts.count ?? 10;
  const tz = opts.timeZone ?? 'UTC';
  const fmt = partsFormatter(tz);
  const get = (name: FieldName): CronField | undefined => expr.fields.find(byName(name));
  const sec = get('second');
  const min = get('minute')!;
  const hour = get('hour')!;
  const dom = get('dayOfMonth')!;
  const mon = get('month')!;
  const dow = get('dayOfWeek')!;
  const year = get('year');
  const unit = expr.hasSeconds ? 1000 : 60000;
  let t = Math.floor(opts.now / unit) * unit + unit;
  const end = opts.now + (opts.horizon ?? 5 * 366 * 24 * 3600 * 1000);
  const out: number[] = [];
  let guard = 0;
  while (t < end && out.length < count && guard++ < 5_000_000) {
    const p = partsAt(fmt, t);
    const toNextDay = ((23 - p.hour) * 3600 + (59 - p.minute) * 60 + (60 - p.second)) * 1000;
    if ((year && !year.any && !year.values.has(p.year)) || (!mon.any && !mon.values.has(p.month)) || !dayMatches(dom, dow, p)) {
      t += toNextDay;
      continue;
    }
    if (!hour.any && !hour.values.has(p.hour)) {
      t += ((59 - p.minute) * 60 + (60 - p.second)) * 1000;
      continue;
    }
    if (!min.any && !min.values.has(p.minute)) {
      t += (60 - p.second) * 1000;
      continue;
    }
    if (sec && !sec.any && !sec.values.has(p.second)) {
      t += 1000;
      continue;
    }
    out.push(t);
    t += unit;
  }
  return out;
}

/** "2026-09-21 09:00:00" in the given zone. */
export function formatInZone(t: number, timeZone: string): string {
  const p = partsAt(partsFormatter(timeZone), t);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)} ${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)} ${DAY_NAMES[p.weekday]?.slice(0, 3) ?? ''}`;
}

export function relativeTime(t: number, now: number): string {
  const diff = t - now;
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? 'in ' : '';
  const past = diff < 0 ? ' ago' : '';
  if (abs < 60000) return `${suffix}under a minute${past}`;
  const mins = Math.round(abs / 60000);
  if (mins < 60) return `${suffix}${mins} min${past}`;
  const hours = Math.floor(mins / 60);
  const rm = mins % 60;
  if (hours < 24) return `${suffix}${hours} h${rm ? ` ${rm} min` : ''}${past}`;
  const days = Math.floor(hours / 24);
  const rh = hours % 24;
  return `${suffix}${days} d${rh ? ` ${rh} h` : ''}${past}`;
}
