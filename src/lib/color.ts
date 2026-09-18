/**
 * color.ts — CSS colour parsing and conversion, dependency-free.
 *
 * Parses: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, bare 6/8-digit hex,
 * `rgb()`/`rgba()` (comma or space syntax, numbers or percentages, `/ alpha`),
 * `hsl()`/`hsla()` (hue in deg/rad/grad/turn or unitless), `hwb()`, the 148
 * CSS named colours plus `transparent`. Matching is case-insensitive.
 *
 * Converts to hex / hex8 / rgb / hsl / hwb / CMYK (naive, no ICC profile),
 * WCAG 2.x relative luminance and contrast ratio, and finds the nearest named
 * colour by Euclidean RGB distance. Alpha is carried through every
 * conversion but ignored for luminance/contrast (treated as opaque).
 */

export interface Rgba {
  /** 0–255, may be fractional. */
  r: number;
  g: number;
  b: number;
  /** 0–1. */
  a: number;
}

export class ColorParseError extends Error {
  constructor(
    message: string,
    public hint?: string,
  ) {
    super(message);
    this.name = 'ColorParseError';
  }
}

export const NAMED_COLORS: Record<string, string> = {
  aliceblue: 'f0f8ff', antiquewhite: 'faebd7', aqua: '00ffff', aquamarine: '7fffd4', azure: 'f0ffff', beige: 'f5f5dc', bisque: 'ffe4c4', black: '000000', blanchedalmond: 'ffebcd', blue: '0000ff', blueviolet: '8a2be2', brown: 'a52a2a', burlywood: 'deb887', cadetblue: '5f9ea0', chartreuse: '7fff00', chocolate: 'd2691e', coral: 'ff7f50', cornflowerblue: '6495ed', cornsilk: 'fff8dc', crimson: 'dc143c', cyan: '00ffff', darkblue: '00008b', darkcyan: '008b8b', darkgoldenrod: 'b8860b', darkgray: 'a9a9a9', darkgreen: '006400', darkgrey: 'a9a9a9', darkkhaki: 'bdb76b', darkmagenta: '8b008b', darkolivegreen: '556b2f', darkorange: 'ff8c00', darkorchid: '9932cc', darkred: '8b0000', darksalmon: 'e9967a', darkseagreen: '8fbc8f', darkslateblue: '483d8b', darkslategray: '2f4f4f', darkslategrey: '2f4f4f', darkturquoise: '00ced1', darkviolet: '9400d3', deeppink: 'ff1493', deepskyblue: '00bfff', dimgray: '696969', dimgrey: '696969', dodgerblue: '1e90ff', firebrick: 'b22222', floralwhite: 'fffaf0', forestgreen: '228b22', fuchsia: 'ff00ff', gainsboro: 'dcdcdc', ghostwhite: 'f8f8ff', gold: 'ffd700', goldenrod: 'daa520', gray: '808080', green: '008000', greenyellow: 'adff2f', grey: '808080', honeydew: 'f0fff0', hotpink: 'ff69b4', indianred: 'cd5c5c', indigo: '4b0082', ivory: 'fffff0', khaki: 'f0e68c', lavender: 'e6e6fa', lavenderblush: 'fff0f5', lawngreen: '7cfc00', lemonchiffon: 'fffacd', lightblue: 'add8e6', lightcoral: 'f08080', lightcyan: 'e0ffff', lightgoldenrodyellow: 'fafad2', lightgray: 'd3d3d3', lightgreen: '90ee90', lightgrey: 'd3d3d3', lightpink: 'ffb6c1', lightsalmon: 'ffa07a', lightseagreen: '20b2aa', lightskyblue: '87cefa', lightslategray: '778899', lightslategrey: '778899', lightsteelblue: 'b0c4de', lightyellow: 'ffffe0', lime: '00ff00', limegreen: '32cd32', linen: 'faf0e6', magenta: 'ff00ff', maroon: '800000', mediumaquamarine: '66cdaa', mediumblue: '0000cd', mediumorchid: 'ba55d3', mediumpurple: '9370db', mediumseagreen: '3cb371', mediumslateblue: '7b68ee', mediumspringgreen: '00fa9a', mediumturquoise: '48d1cc', mediumvioletred: 'c71585', midnightblue: '191970', mintcream: 'f5fffa', mistyrose: 'ffe4e1', moccasin: 'ffe4b5', navajowhite: 'ffdead', navy: '000080', oldlace: 'fdf5e6', olive: '808000', olivedrab: '6b8e23', orange: 'ffa500', orangered: 'ff4500', orchid: 'da70d6', palegoldenrod: 'eee8aa', palegreen: '98fb98', paleturquoise: 'afeeee', palevioletred: 'db7093', papayawhip: 'ffefd5', peachpuff: 'ffdab9', peru: 'cd853f', pink: 'ffc0cb', plum: 'dda0dd', powderblue: 'b0e0e6', purple: '800080', rebeccapurple: '663399', red: 'ff0000', rosybrown: 'bc8f8f', royalblue: '4169e1', saddlebrown: '8b4513', salmon: 'fa8072', sandybrown: 'f4a460', seagreen: '2e8b57', seashell: 'fff5ee', sienna: 'a0522d', silver: 'c0c0c0', skyblue: '87ceeb', slateblue: '6a5acd', slategray: '708090', slategrey: '708090', snow: 'fffafa', springgreen: '00ff7f', steelblue: '4682b4', tan: 'd2b48c', teal: '008080', thistle: 'd8bfd8', tomato: 'ff6347', turquoise: '40e0d0', violet: 'ee82ee', wheat: 'f5deb3', white: 'ffffff', whitesmoke: 'f5f5f5', yellow: 'ffff00', yellowgreen: '9acd32',
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/* ------------------------------------------------------------ parsing */

function hexToRgba(hex: string): Rgba {
  const h = hex.length === 3 || hex.length === 4 ? hex.split('').map((c) => c + c).join('') : hex;
  const n = (i: number): number => parseInt(h.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
}

function parseAlpha(s: string | undefined): number {
  if (s === undefined || s === '') return 1;
  if (s.endsWith('%')) return clamp(parseFloat(s) / 100, 0, 1);
  const v = parseFloat(s);
  if (Number.isNaN(v)) throw new ColorParseError(`Alpha "${s}" is not a number`, 'Use a number from 0 to 1 or a percentage.');
  return clamp(v, 0, 1);
}

function parseHue(s: string): number {
  const m = /^(-?[\d.]+)(deg|rad|grad|turn)?$/i.exec(s);
  if (!m) throw new ColorParseError(`Hue "${s}" is not a number`, 'Use degrees like 30 or 30deg (rad, grad and turn also work).');
  const v = parseFloat(m[1]!);
  const unit = (m[2] ?? 'deg').toLowerCase();
  const deg = unit === 'rad' ? (v * 180) / Math.PI : unit === 'grad' ? v * 0.9 : unit === 'turn' ? v * 360 : v;
  return ((deg % 360) + 360) % 360;
}

function parsePercent(s: string, what: string): number {
  if (!s.endsWith('%')) {
    const v = parseFloat(s);
    if (Number.isNaN(v)) throw new ColorParseError(`${what} "${s}" is not a percentage`, `Write ${what.toLowerCase()} as a percentage, e.g. 50%.`);
    return clamp(v, 0, 100);
  }
  return clamp(parseFloat(s), 0, 100);
}

function parseChannel(s: string): number {
  if (s.endsWith('%')) return clamp((parseFloat(s) / 100) * 255, 0, 255);
  const v = parseFloat(s);
  if (Number.isNaN(v)) throw new ColorParseError(`Channel "${s}" is not a number`, 'Use 0-255 or a percentage.');
  return clamp(v, 0, 255);
}

/** Splits "a, b, c" / "a b c / d" / "a, b, c, d" into [args, alpha]. */
function splitArgs(inner: string, fn: string): { args: string[]; alpha: string | undefined } {
  let alpha: string | undefined;
  let body = inner.trim();
  const slash = body.indexOf('/');
  if (slash >= 0) {
    alpha = body.slice(slash + 1).trim();
    body = body.slice(0, slash).trim();
  }
  const args = body.split(/\s*,\s*|\s+/).filter(Boolean);
  if (alpha === undefined && args.length === 4) alpha = args.pop();
  if (args.length !== 3) throw new ColorParseError(`${fn}() needs 3 values (plus optional alpha), got ${args.length}`, `Example: ${fn}(${fn.startsWith('rgb') ? '255 128 0' : fn === 'hwb' ? '30 0% 0%' : '30 100% 50%'} / 0.5)`);
  return { args, alpha };
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sat = s / 100;
  const lig = l / 100;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb: [number, number, number];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = lig - c / 2;
  return [(rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255];
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rr) h = ((gg - bb) / d) % 6;
  else if (max === gg) h = (bb - rr) / d + 2;
  else h = (rr - gg) / d + 4;
  h = ((h * 60) % 360 + 360) % 360;
  return [h, s * 100, l * 100];
}

export function hwbToRgb(h: number, w: number, bk: number): [number, number, number] {
  const wh = w / 100;
  const bl = bk / 100;
  if (wh + bl >= 1) {
    const gray = (wh / (wh + bl)) * 255;
    return [gray, gray, gray];
  }
  const [r, g, b] = hslToRgb(h, 100, 50);
  const f = (c: number): number => (c / 255) * (1 - wh - bl) + wh;
  return [f(r) * 255, f(g) * 255, f(b) * 255];
}

export function rgbToHwb(r: number, g: number, b: number): [number, number, number] {
  const [h] = rgbToHsl(r, g, b);
  const w = Math.min(r, g, b) / 255;
  const bk = 1 - Math.max(r, g, b) / 255;
  return [h, w * 100, bk * 100];
}

export function rgbToCmyk(r: number, g: number, b: number): [number, number, number, number] {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const k = 1 - Math.max(rr, gg, bb);
  if (k === 1) return [0, 0, 0, 100];
  const c = (1 - rr - k) / (1 - k);
  const m = (1 - gg - k) / (1 - k);
  const y = (1 - bb - k) / (1 - k);
  return [c * 100, m * 100, y * 100, k * 100];
}

export function parseColor(input: string): Rgba {
  const s = input.trim();
  if (!s) throw new ColorParseError('Empty colour');
  const lower = s.toLowerCase();
  if (lower === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const named = NAMED_COLORS[lower];
  if (named) return hexToRgba(named);
  const hm = /^#?([0-9a-f]{1,8})$/i.exec(s);
  if (hm) {
    const hex = hm[1]!;
    const bare = !s.startsWith('#');
    if (bare ? hex.length === 6 || hex.length === 8 : [3, 4, 6, 8].includes(hex.length)) return hexToRgba(hex);
    throw new ColorParseError(`"${s}" is not a valid hex colour`, bare ? 'Bare hex needs 6 or 8 digits; add # for the 3/4-digit forms.' : 'Hex colours have 3, 4, 6 or 8 digits: #rgb, #rgba, #rrggbb, #rrggbbaa.');
  }
  const fm = /^([a-z]+)\s*\((.*)\)$/i.exec(s);
  if (fm) {
    const fn = fm[1]!.toLowerCase();
    const inner = fm[2]!;
    if (fn === 'rgb' || fn === 'rgba') {
      const { args, alpha } = splitArgs(inner, fn);
      return { r: parseChannel(args[0]!), g: parseChannel(args[1]!), b: parseChannel(args[2]!), a: parseAlpha(alpha) };
    }
    if (fn === 'hsl' || fn === 'hsla') {
      const { args, alpha } = splitArgs(inner, fn);
      const [r, g, b] = hslToRgb(parseHue(args[0]!), parsePercent(args[1]!, 'Saturation'), parsePercent(args[2]!, 'Lightness'));
      return { r, g, b, a: parseAlpha(alpha) };
    }
    if (fn === 'hwb') {
      const { args, alpha } = splitArgs(inner, fn);
      const [r, g, b] = hwbToRgb(parseHue(args[0]!), parsePercent(args[1]!, 'Whiteness'), parsePercent(args[2]!, 'Blackness'));
      return { r, g, b, a: parseAlpha(alpha) };
    }
    throw new ColorParseError(`Unknown colour function ${fn}()`, 'Supported: rgb(), rgba(), hsl(), hsla(), hwb().');
  }
  if (/^[a-z]+$/i.test(s)) throw new ColorParseError(`"${s}" is not a CSS colour name`, 'Check the spelling — e.g. rebeccapurple, darkslategray, lightgoldenrodyellow.');
  throw new ColorParseError(`Cannot parse "${s}" as a colour`, 'Use #hex, rgb(), hsl(), hwb() or a CSS colour name.');
}

/* ---------------------------------------------------------- formatting */

const hex2 = (v: number): string => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
const fmtNum = (v: number, digits = 0): string => {
  const s = v.toFixed(digits);
  return digits ? s.replace(/\.?0+$/, '') : s;
};
const fmtAlpha = (a: number): string => fmtNum(a, 3);

export function toHex(c: Rgba): string {
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
}
export function toHex8(c: Rgba): string {
  return `${toHex(c)}${hex2(c.a * 255)}`;
}
export function toRgbString(c: Rgba): string {
  const base = `${Math.round(c.r)} ${Math.round(c.g)} ${Math.round(c.b)}`;
  return c.a < 1 ? `rgb(${base} / ${fmtAlpha(c.a)})` : `rgb(${base})`;
}
export function toHslString(c: Rgba): string {
  const [h, s, l] = rgbToHsl(c.r, c.g, c.b);
  const base = `${fmtNum(h)} ${fmtNum(s)}% ${fmtNum(l)}%`;
  return c.a < 1 ? `hsl(${base} / ${fmtAlpha(c.a)})` : `hsl(${base})`;
}
export function toHwbString(c: Rgba): string {
  const [h, w, b] = rgbToHwb(c.r, c.g, c.b);
  const base = `${fmtNum(h)} ${fmtNum(w)}% ${fmtNum(b)}%`;
  return c.a < 1 ? `hwb(${base} / ${fmtAlpha(c.a)})` : `hwb(${base})`;
}
export function toCmykString(c: Rgba): string {
  const [cc, m, y, k] = rgbToCmyk(c.r, c.g, c.b);
  return `cmyk(${fmtNum(cc)}% ${fmtNum(m)}% ${fmtNum(y)}% ${fmtNum(k)}%)`;
}

/* --------------------------------------------------------------- WCAG */

export function relativeLuminance(c: Rgba): number {
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

export function contrastRatio(a: Rgba, b: Rgba): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export type WcagGrade = 'AAA' | 'AA' | 'AA Large' | 'Fail';

export function wcagGrade(ratio: number): WcagGrade {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA Large';
  return 'Fail';
}

export const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };
export const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

/* ----------------------------------------------------------- helpers */

export function nearestNamedColor(c: Rgba): { name: string; hex: string; distance: number } {
  let best = { name: 'black', hex: '#000000', distance: Infinity };
  for (const [name, hex] of Object.entries(NAMED_COLORS)) {
    const n = hexToRgba(hex);
    const d = Math.sqrt((n.r - c.r) ** 2 + (n.g - c.g) ** 2 + (n.b - c.b) ** 2);
    if (d < best.distance) best = { name, hex: '#' + hex, distance: d };
  }
  return best;
}

export function mix(c: Rgba, target: Rgba, amount: number): Rgba {
  return { r: c.r + (target.r - c.r) * amount, g: c.g + (target.g - c.g) * amount, b: c.b + (target.b - c.b) * amount, a: c.a };
}

/** 9 steps: 4 tints (lightest first), the colour itself, 4 shades (darkest last). */
export function tintShadeScale(c: Rgba): string[] {
  const out: string[] = [];
  for (const amt of [0.8, 0.6, 0.4, 0.2]) out.push(toHex(mix(c, WHITE, amt)));
  out.push(toHex(c));
  for (const amt of [0.2, 0.4, 0.6, 0.8]) out.push(toHex(mix(c, BLACK, amt)));
  return out;
}
