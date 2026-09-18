import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseColor, toHex, toHex8, toRgbString, toHslString, toHwbString, toCmykString, contrastRatio, relativeLuminance, wcagGrade, nearestNamedColor, tintShadeScale, NAMED_COLORS, WHITE, BLACK, ColorParseError } from '../src/lib/color.js';
import { runColor, colorMode, type ColorData } from '../src/modes/color.js';

const ctx = (options: Record<string, unknown> = {}) => ({ pretty: true, options });
const hexOf = (s: string): string => toHex(parseColor(s));

test('sample runs and produces a color view with one entry per line', () => {
  const r = runColor(colorMode.sample, ctx());
  assert.equal(r.error, undefined);
  assert.equal(r.view?.kind, 'color');
  assert.equal((r.view?.data as ColorData).colors.length, 6);
  assert.equal(r.status, '6 colours');
});

test('empty input returns empty output and status', () => {
  assert.deepEqual(runColor('\n\n', ctx()), { output: '', status: '' });
});

test('hex syntaxes: #rgb #rgba #rrggbb #rrggbbaa and bare 6/8-hex', () => {
  assert.equal(hexOf('#f80'), '#ff8800');
  assert.deepEqual(parseColor('#f808'), { r: 255, g: 136, b: 0, a: 0x88 / 255 });
  assert.equal(hexOf('#FF8000'), '#ff8000');
  assert.equal(toHex8(parseColor('#ff800080')), '#ff800080');
  assert.equal(hexOf('1e90ff'), '#1e90ff');
  assert.equal(toHex8(parseColor('1e90ff80')), '#1e90ff80');
});

test('rgb()/rgba(): comma syntax, space syntax, percentages and alpha forms', () => {
  assert.equal(hexOf('rgb(255, 128, 0)'), '#ff8000');
  assert.equal(hexOf('rgb(255 128 0)'), '#ff8000');
  assert.equal(hexOf('rgb(100% 50% 0%)'), '#ff8000');
  assert.equal(toRgbString(parseColor('rgba(255,128,0,0.5)')), 'rgb(255 128 0 / 0.5)');
  assert.equal(toRgbString(parseColor('rgb(255 128 0 / 50%)')), 'rgb(255 128 0 / 0.5)');
  assert.equal(toRgbString(parseColor('rgb(300 -5 0)')), 'rgb(255 0 0)');
});

test('hsl()/hsla(): degrees, units, comma and space syntax', () => {
  assert.equal(hexOf('hsl(30 100% 50%)'), '#ff8000');
  assert.equal(hexOf('hsl(30, 100%, 50%)'), '#ff8000');
  assert.equal(hexOf('hsl(30deg 100% 50%)'), '#ff8000');
  assert.equal(hexOf('hsl(0.5turn 100% 50%)'), '#00ffff');
  assert.equal(hexOf('hsl(200grad 100% 50%)'), '#00ffff');
  assert.equal(hexOf('hsl(390 100% 50%)'), '#ff8000');
  assert.equal(toHslString(parseColor('hsla(30, 100%, 50%, 0.25)')), 'hsl(30 100% 50% / 0.25)');
});

test('hsl ↔ rgb round trips on known values', () => {
  assert.equal(toHslString(parseColor('#ff8000')), 'hsl(30 100% 50%)');
  assert.equal(toHslString(parseColor('#ff0000')), 'hsl(0 100% 50%)');
  assert.equal(toHslString(parseColor('#00ff00')), 'hsl(120 100% 50%)');
  assert.equal(toHslString(parseColor('#0000ff')), 'hsl(240 100% 50%)');
  assert.equal(toHslString(parseColor('#808080')), 'hsl(0 0% 50%)');
  assert.equal(toHslString(parseColor('#663399')), 'hsl(270 50% 40%)');
  for (const hex of ['#ff8000', '#663399', '#ff0000', '#808080', '#00ffff']) {
    assert.equal(hexOf(toHslString(parseColor(hex))), hex, hex);
  }
});

test('hwb() parsing and formatting', () => {
  assert.equal(hexOf('hwb(30 0% 0%)'), '#ff8000');
  assert.equal(toHwbString(parseColor('#ff8000')), 'hwb(30 0% 0%)');
  assert.equal(hexOf('hwb(200 10% 20%)'), '#1a90cc');
  assert.equal(toHwbString(parseColor('#1a90cc')), 'hwb(200 10% 20%)');
  assert.equal(hexOf('hwb(0 50% 50%)'), '#808080');
});

test('named colours: full 148-entry table, case-insensitive lookup, transparent', () => {
  assert.equal(Object.keys(NAMED_COLORS).length, 148);
  assert.equal(hexOf('rebeccapurple'), '#663399');
  assert.equal(hexOf('DarkSlateGray'), '#2f4f4f');
  assert.equal(hexOf('lightgoldenrodyellow'), '#fafad2');
  assert.equal(hexOf('grey'), hexOf('gray'));
  assert.equal(parseColor('transparent').a, 0);
});

test('cmyk approximation', () => {
  assert.equal(toCmykString(parseColor('#ff8000')), 'cmyk(0% 50% 100% 0%)');
  assert.equal(toCmykString(parseColor('#000000')), 'cmyk(0% 0% 0% 100%)');
  assert.equal(toCmykString(parseColor('#ffffff')), 'cmyk(0% 0% 0% 0%)');
});

test('luminance and WCAG contrast: black on white is 21', () => {
  assert.equal(relativeLuminance(WHITE), 1);
  assert.equal(relativeLuminance(BLACK), 0);
  assert.equal(contrastRatio(BLACK, WHITE), 21);
  assert.equal(contrastRatio(WHITE, BLACK), 21);
  assert.equal(contrastRatio(WHITE, WHITE), 1);
  assert.equal(wcagGrade(21), 'AAA');
  assert.equal(wcagGrade(4.6), 'AA');
  assert.equal(wcagGrade(3.2), 'AA Large');
  assert.equal(wcagGrade(2), 'Fail');
  const gray = parseColor('#767676');
  assert.ok(contrastRatio(gray, WHITE) >= 4.5);
});

test('nearest named colour and tint/shade scale', () => {
  assert.equal(nearestNamedColor(parseColor('#ff8000')).name, 'darkorange');
  assert.equal(nearestNamedColor(parseColor('#1e90ff')).distance, 0);
  const scale = tintShadeScale(parseColor('#808080'));
  assert.equal(scale.length, 9);
  assert.equal(scale[4], '#808080');
  assert.equal(scale[0], '#e6e6e6');
  assert.equal(scale[8], '#1a1a1a');
});

test('alpha is carried into hex8/rgb/hsl and reported in the view', () => {
  const r = runColor('hsl(150 60% 40% / 0.5)', ctx());
  const c = (r.view?.data as ColorData).colors[0]!;
  assert.equal(c.alpha, 0.5);
  assert.equal(c.hex8, '#29a36680');
  assert.equal(c.rgb, 'rgb(41 163 102 / 0.5)');
  assert.equal(c.css, 'rgb(41 163 102 / 0.5)');
  assert.equal(c.scale.length, 9);
});

test('output control: hex / rgb / hsl give one line per colour', () => {
  const input = '#ff8000\nred\n#ff800080';
  assert.equal(runColor(input, ctx({ output: 'hex' })).output, '#ff8000\n#ff0000\n#ff800080');
  assert.equal(runColor(input, ctx({ output: 'rgb' })).output, 'rgb(255 128 0)\nrgb(255 0 0)\nrgb(255 128 0 / 0.502)');
  assert.equal(runColor(input, ctx({ output: 'hsl' })).output, 'hsl(30 100% 50%)\nhsl(0 100% 50%)\nhsl(30 100% 50% / 0.502)');
  const all = runColor('#ff8000', ctx()).output;
  assert.ok(all.includes('  contrast   2.52:1 on white (Fail) · 8.34:1 on black (AAA)'));
  assert.ok(all.includes('  nearest    darkorange (#ff8c00)'));
});

test('invalid colour is an error with the line number and a hint', () => {
  const r = runColor('#ff8000\nnotacolor\nred', ctx());
  assert.equal(r.error?.line, 2);
  assert.match(r.error?.message ?? '', /not a CSS colour name/);
  assert.ok(r.error?.hint);
  assert.equal(r.status, 'Invalid colour · line 2');
  assert.throws(() => parseColor('#12'), ColorParseError);
  assert.throws(() => parseColor('rgb(1, 2)'), ColorParseError);
  assert.throws(() => parseColor('hsl(x 1% 1%)'), ColorParseError);
  assert.throws(() => parseColor('blah(1 2 3)'), ColorParseError);
  assert.throws(() => parseColor('12345'), ColorParseError);
});
