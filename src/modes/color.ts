/**
 * Color Converter mode: one colour per line → hex / rgb / hsl / hwb / cmyk,
 * luminance, WCAG contrast against white and black, nearest named colour and
 * a tint/shade scale. The `color` view shows swatches; the text output is
 * either the full breakdown or a single format per line.
 */

import { type ToolMode, type ModeResult, type RunContext } from './types.js';
import {
  parseColor, toHex, toHex8, toRgbString, toHslString, toHwbString, toCmykString, relativeLuminance, contrastRatio, wcagGrade, nearestNamedColor, tintShadeScale, ColorParseError, WHITE, BLACK, type WcagGrade,
} from '../lib/color.js';

export interface ColorEntry {
  input: string;
  line: number;
  hex: string;
  hex8: string;
  rgb: string;
  hsl: string;
  hwb: string;
  cmyk: string;
  alpha: number;
  luminance: number;
  contrastWhite: { ratio: number; grade: WcagGrade };
  contrastBlack: { ratio: number; grade: WcagGrade };
  nearest: { name: string; hex: string; exact: boolean };
  /** 9 hex values: 4 tints, the colour, 4 shades. */
  scale: string[];
  /** CSS value for the swatch background (keeps alpha). */
  css: string;
}

export interface ColorData {
  colors: ColorEntry[];
}

export function runColor(input: string, ctx: RunContext): ModeResult {
  if (input.trim() === '') return { output: '', status: '' };
  const outputMode = typeof ctx.options['output'] === 'string' ? ctx.options['output'] : 'all';
  const colors: ColorEntry[] = [];
  const lines = input.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim();
    if (!raw) continue;
    try {
      const c = parseColor(raw);
      const cw = contrastRatio(c, WHITE);
      const cb = contrastRatio(c, BLACK);
      const near = nearestNamedColor(c);
      const hex = toHex(c);
      colors.push({
        input: raw,
        line: i + 1,
        hex,
        hex8: toHex8(c),
        rgb: toRgbString(c),
        hsl: toHslString(c),
        hwb: toHwbString(c),
        cmyk: toCmykString(c),
        alpha: c.a,
        luminance: relativeLuminance(c),
        contrastWhite: { ratio: cw, grade: wcagGrade(cw) },
        contrastBlack: { ratio: cb, grade: wcagGrade(cb) },
        nearest: { name: near.name, hex: near.hex, exact: near.distance === 0 && c.a === 1 },
        scale: tintShadeScale(c),
        css: c.a < 1 ? toRgbString(c) : hex,
      });
    } catch (e) {
      const msg = e instanceof ColorParseError ? e.message : (e as Error).message;
      const hint = e instanceof ColorParseError ? e.hint : undefined;
      return { output: '', error: { message: msg, line: i + 1, col: 1, hint }, status: `Invalid colour · line ${i + 1}` };
    }
  }
  const out: string[] = [];
  for (const c of colors) {
    if (outputMode === 'hex') out.push(c.alpha < 1 ? c.hex8 : c.hex);
    else if (outputMode === 'rgb') out.push(c.rgb);
    else if (outputMode === 'hsl') out.push(c.hsl);
    else {
      out.push(
        `${c.input}`,
        `  hex        ${c.hex}`,
        `  hex8       ${c.hex8}`,
        `  rgb        ${c.rgb}`,
        `  hsl        ${c.hsl}`,
        `  hwb        ${c.hwb}`,
        `  cmyk       ${c.cmyk}`,
        `  luminance  ${c.luminance.toFixed(4)}`,
        `  contrast   ${c.contrastWhite.ratio.toFixed(2)}:1 on white (${c.contrastWhite.grade}) · ${c.contrastBlack.ratio.toFixed(2)}:1 on black (${c.contrastBlack.grade})`,
        `  nearest    ${c.nearest.name} (${c.nearest.hex})${c.nearest.exact ? ' — exact' : ''}`,
        '',
      );
    }
  }
  const n = colors.length;
  const data: ColorData = { colors };
  return {
    output: out.join('\n').replace(/\n+$/, ''),
    status: `${n} colour${n === 1 ? '' : 's'}`,
    view: { kind: 'color', data },
  };
}

export const colorMode: ToolMode = {
  id: 'color',
  label: 'Color Converter',
  description: 'Convert colours between hex, rgb, hsl and hwb with contrast checks, nearest named colour and a tint/shade scale.',
  category: 'Web',
  icon: 'palette',
  keywords: ['colour', 'hex', 'rgb', 'hsl', 'hwb', 'cmyk', 'contrast', 'wcag', 'swatch', 'palette'],
  emptyHint: 'One colour per line: #ff8000, rgb(255 128 0), hsl(30 100% 50%), hwb(30 0% 0%) or a name like rebeccapurple.',
  sample: '#ff8000\nrgb(59, 108, 255)\nhsl(150 60% 40% / 0.5)\nrebeccapurple\nhwb(200 10% 20%)\n1e90ff',
  supportsPretty: false,
  controls: [
    {
      kind: 'select',
      key: 'output',
      label: 'Output',
      default: 'all',
      options: [
        { value: 'all', label: 'All formats' },
        { value: 'hex', label: 'Hex' },
        { value: 'rgb', label: 'rgb()' },
        { value: 'hsl', label: 'hsl()' },
      ],
    },
  ],
  run: runColor,
};
