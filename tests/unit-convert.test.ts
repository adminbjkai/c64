import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuantity, findUnit, convert, formatNumber, closestUnits, unitsOf, UNIT_CATEGORIES } from '../src/lib/units.js';
import { runUnitConvert, unitConvertMode, type UnitsData } from '../src/modes/unit-convert.js';

const ctx = (options: Record<string, unknown> = {}) => ({ pretty: false, options });
const close = (a: number, b: number, rel = 1e-9) => assert.ok(Math.abs(a - b) <= Math.max(Math.abs(b), 1) * rel, `${a} ≉ ${b}`);
const conv = (v: number, from: string, to: string): number => {
  const f = findUnit(from)!;
  const t = findUnit(to, f.category)!;
  return convert(v, f, t.unit);
};

test('empty input is empty', () => {
  assert.deepEqual(runUnitConvert('', ctx()), { output: '', status: '' });
  assert.deepEqual(runUnitConvert(' \n', ctx()), { output: '', status: '' });
});

test('sample runs, one entry per line, units view', () => {
  const r = runUnitConvert(unitConvertMode.sample, ctx());
  assert.equal(r.error, undefined);
  assert.equal(r.view?.kind, 'units');
  const d = r.view!.data as UnitsData;
  assert.equal(d.entries.length, 8);
  assert.equal(d.entries[0]!.category, 'length');
  assert.equal(d.entries[1]!.category, 'data');
  assert.match(r.status!, /^8 quantities · /);
});

test('length: km to miles and feet', () => {
  close(conv(12, 'km', 'mi'), 7.456454306848);
  close(conv(12, 'km', 'ft'), 39370.078740157);
  const r = runUnitConvert('12 km', ctx({ precision: '3' }));
  assert.match(r.output, /^12 km = .*39400 ft.*7\.46 mi/);
});

test('temperature is affine, not proportional', () => {
  close(conv(72, '°F', '°C'), 22.2222222222);
  close(conv(0, 'C', 'F'), 32);
  close(conv(100, 'C', 'K'), 373.15);
  close(conv(-40, 'F', 'C'), -40);
  close(conv(0, 'K', 'R'), 0);
  close(conv(491.67, 'R', 'F'), 32);
  close(conv(300, 'kelvin', 'celsius'), 26.85);
  // Doubling the input must not double the output (affine check).
  assert.notEqual(conv(20, 'C', 'F') * 2, conv(40, 'C', 'F'));
});

test('data: SI vs IEC prefixes and bits vs bytes', () => {
  close(conv(1, 'GiB', 'MiB'), 1024);
  close(conv(1, 'GB', 'MB'), 1000);
  close(conv(1, 'GiB', 'B'), 1073741824);
  close(conv(1, 'GB', 'B'), 1e9);
  close(conv(1, 'MB', 'Mb'), 8);
  close(conv(8, 'bit', 'byte'), 1);
  close(conv(1, 'KiB', 'kB'), 1.024);
  close(conv(3.5, 'GiB', 'MiB'), 3584);
});

test('aliases: case-insensitive when unambiguous, case-sensitive when it matters', () => {
  assert.equal(findUnit('KM')!.unit.symbol, 'km');
  assert.equal(findUnit('Meters')!.unit.symbol, 'm');
  assert.equal(findUnit('metre')!.unit.symbol, 'm');
  assert.equal(findUnit('feet')!.unit.symbol, 'ft');
  assert.equal(findUnit('"')!.unit.symbol, 'in');
  assert.equal(findUnit("'")!.unit.symbol, 'ft');
  assert.equal(findUnit('lbs')!.unit.symbol, 'lb');
  assert.equal(findUnit('Mb')!.unit.name, 'megabit');
  assert.equal(findUnit('MB')!.unit.name, 'megabyte');
  assert.equal(findUnit('mb'), null, 'mb is ambiguous between Mb and MB');
  assert.equal(findUnit('KB')!.unit.name, 'kilobyte');
  assert.equal(findUnit('B')!.unit.name, 'byte');
  assert.equal(findUnit('b')!.unit.name, 'bit');
  assert.equal(findUnit('m')!.category, 'length');
  assert.equal(findUnit('min')!.category, 'time');
  assert.equal(findUnit('nope'), null);
});

test('every category has a base unit and converts to itself', () => {
  assert.equal(UNIT_CATEGORIES.length, 13);
  for (const c of UNIT_CATEGORIES) {
    const units = unitsOf(c);
    assert.ok(units.length >= 4, c);
    for (const u of units) close(convert(7, { category: c, unit: u }, u), 7);
  }
});

test('speed, area, volume, mass, angle, pressure, energy, power, frequency spot checks', () => {
  close(conv(90, 'mph', 'km/h'), 144.84096);
  close(conv(1, 'knot', 'km/h'), 1.852);
  close(conv(2, 'acres', 'ft²'), 87120);
  close(conv(1, 'gal', 'L'), 3.785411784);
  close(conv(180, 'lb', 'kg'), 81.6466266);
  close(conv(180, 'deg', 'rad'), Math.PI);
  close(conv(1, 'atm', 'psi'), 14.6959487755, 1e-6);
  close(conv(1, 'kWh', 'kJ'), 3600);
  close(conv(1, 'hp', 'W'), 745.69987158227);
  close(conv(2.4, 'GHz', 'MHz'), 2400);
  close(conv(1e6, 'ms', 'min'), 16.6666666667);
});

test('number formats: scientific notation, thousands separators, negatives', () => {
  assert.equal(parseQuantity('1e6 ms').value, 1e6);
  assert.equal(parseQuantity('1,000 m').value, 1000);
  assert.equal(parseQuantity('-40 F').value, -40);
  assert.equal(parseQuantity('.5 km').value, 0.5);
  assert.equal(parseQuantity('3.5GiB').match.unit.symbol, 'GiB');
});

test('precision control changes significant digits', () => {
  assert.match(runUnitConvert('1 mi', ctx({ precision: '3' })).output, /1\.61 km/);
  assert.match(runUnitConvert('1 mi', ctx({ precision: '6' })).output, /1\.60934 km/);
  assert.match(runUnitConvert('1 mi', ctx({ precision: '10' })).output, /1\.609344 km/);
  assert.match(runUnitConvert('1 mi', ctx({ precision: 'bogus' })).output, /1\.60934 km/);
  assert.match(runUnitConvert('1 mi', ctx()).status!, /6 sig\. digits/);
});

test('formatNumber trims zeros and picks exponent form for extremes', () => {
  assert.equal(formatNumber(0, 6), '0');
  assert.equal(formatNumber(1.5, 6), '1.5');
  assert.equal(formatNumber(1609.344, 6), '1609.34');
  assert.equal(formatNumber(1e20, 6), '1e20');
  assert.equal(formatNumber(1.602176634e-19, 6), '1.60218e-19');
  assert.equal(formatNumber(12000000, 6), '12000000');
});

test('target control converts only to that unit', () => {
  const r = runUnitConvert('12 km\n3 mi', ctx({ target: 'ft' }));
  assert.equal(r.error, undefined);
  assert.equal(r.output, '12 km = 39370.1 ft\n3 mi = 15840 ft');
  const d = r.view!.data as UnitsData;
  assert.equal(d.entries[0]!.rows.length, 1);
  assert.equal(d.entries[0]!.rows[0]!.symbol, 'ft');
  assert.match(r.status!, /to ft/);
});

test('target in the wrong category errors with a category hint', () => {
  const r = runUnitConvert('12 km', ctx({ target: 'kg' }));
  assert.equal(r.error?.line, 1);
  assert.match(r.error!.message, /Unknown target unit "kg"/);
  assert.match(r.error!.hint!, /mass unit but line 1 is length/);
});

test('unknown unit errors with line number and closest names', () => {
  const r = runUnitConvert('12 km\n5 kilometrs', ctx());
  assert.equal(r.error?.line, 2);
  assert.match(r.error!.message, /Unknown unit "kilometrs"/);
  assert.match(r.error!.hint!, /Closest known units: .*km/);
  assert.ok(closestUnits('metrs').includes('m'));
  assert.equal(r.output, '12 km = 12000000 mm = 1200000 cm = 12000 m = 472441 in = 39370.1 ft = 13123.4 yd = 7.45645 mi = 6.47948 nmi = 12000000000 μm', 'partial output kept');
});

test('missing number or missing unit errors', () => {
  const a = runUnitConvert('km', ctx());
  assert.equal(a.error?.line, 1);
  assert.match(a.error!.message, /Expected a number/);
  const b = runUnitConvert('  42', ctx());
  assert.match(b.error!.message, /Missing unit/);
  assert.equal(b.error?.col, 5);
});

test('view rows mark the input unit and blank lines are preserved in output', () => {
  const r = runUnitConvert('1 h\n\n2 d', ctx());
  assert.equal(r.output.split('\n').length, 3);
  assert.equal(r.output.split('\n')[1], '');
  const d = r.view!.data as UnitsData;
  assert.equal(d.entries.length, 2);
  assert.equal(d.entries[0]!.line, 1);
  assert.equal(d.entries[1]!.line, 3);
  assert.equal(d.entries[0]!.rows.find((x) => x.self)!.symbol, 'h');
  assert.equal(d.entries[0]!.rows.find((x) => x.symbol === 'min')!.value, '60');
});
