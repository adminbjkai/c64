/**
 * QR Code mode: turns the input (or a preset such as Wi-Fi / vCard / email
 * built from `key: value` lines) into a QR code rendered as SVG. Pretty
 * output = the SVG markup, Raw = the encoded payload string.
 */

import { type ToolMode, type ModeResult, type RunContext } from './types.js';
import { encodeQr, qrToSvg, type QrEcc } from '../lib/qr.js';

export type QrPreset = 'text' | 'url' | 'wifi' | 'vcard' | 'email' | 'phone' | 'sms';
const PRESETS: QrPreset[] = ['text', 'url', 'wifi', 'vcard', 'email', 'phone', 'sms'];
const ECCS: QrEcc[] = ['L', 'M', 'Q', 'H'];

export interface QrData {
  modules: boolean[][];
  size: number;
  version: number;
  ecc: QrEcc;
  mask: number;
  mode: string;
  bytes: number;
  payload: string;
  svg: string;
  px: number;
  dark: string;
  light: string;
}

/** Parses `key: value` lines (case-insensitive keys) into a map; ignores blank lines. */
export function parseKeyValues(input: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of input.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z][\w -]*?)\s*[:=]\s*(.*)$/.exec(line);
    if (m) out[(m[1] as string).toLowerCase().replace(/[\s_-]+/g, '')] = (m[2] as string).trim();
  }
  return out;
}

const wifiEscape = (s: string) => s.replace(/([\\;,":])/g, '\\$1');
const vcardEscape = (s: string) => s.replace(/([\\;,])/g, '\\$1').replace(/\n/g, '\\n');

/** Builds the payload string for a preset from the free-text input. */
export function buildPayload(preset: QrPreset, input: string): { payload: string; notes: string[] } {
  const notes: string[] = [];
  const text = input.replace(/\r\n/g, '\n');
  switch (preset) {
    case 'text':
      return { payload: text, notes };
    case 'url': {
      let u = text.trim();
      if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) { u = 'https://' + u; notes.push('No scheme given — prefixed https://.'); }
      return { payload: u, notes };
    }
    case 'wifi': {
      let kv = parseKeyValues(text);
      if (Object.keys(kv).length === 0) {
        // Short form: ssid;password;WPA
        const parts = text.trim().split(';');
        kv = { ssid: parts[0] ?? '', password: parts[1] ?? '', type: parts[2] ?? '' };
      }
      const ssid = kv['ssid'] ?? kv['name'] ?? kv['network'] ?? '';
      const password = kv['password'] ?? kv['pass'] ?? kv['psk'] ?? kv['key'] ?? '';
      let type = (kv['type'] ?? kv['security'] ?? kv['auth'] ?? (password ? 'WPA' : 'nopass')).toUpperCase();
      if (type === 'WPA2' || type === 'WPA3' || type === 'WPA/WPA2') type = 'WPA';
      if (type === 'NONE' || type === 'OPEN' || type === 'NOPASS' || type === '') type = 'nopass';
      if (!['WPA', 'WEP', 'nopass'].includes(type)) { notes.push(`Unknown Wi-Fi type "${type}" — used WPA.`); type = 'WPA'; }
      const hidden = /^(true|yes|1)$/i.test(kv['hidden'] ?? '');
      if (ssid === '') notes.push('No ssid given — the code will not join a network.');
      return { payload: `WIFI:T:${type};S:${wifiEscape(ssid)};${type === 'nopass' ? '' : `P:${wifiEscape(password)};`}${hidden ? 'H:true;' : ''};`, notes };
    }
    case 'vcard': {
      const kv = parseKeyValues(text);
      const name = kv['name'] ?? kv['fn'] ?? '';
      const parts = name.trim().split(/\s+/);
      const last = parts.length > 1 ? parts[parts.length - 1] : '';
      const first = parts.length > 1 ? parts.slice(0, -1).join(' ') : name;
      const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${vcardEscape(last as string)};${vcardEscape(first)};;;`, `FN:${vcardEscape(name)}`];
      if (kv['org'] || kv['company']) lines.push(`ORG:${vcardEscape(kv['org'] ?? kv['company'] ?? '')}`);
      if (kv['title'] || kv['role']) lines.push(`TITLE:${vcardEscape(kv['title'] ?? kv['role'] ?? '')}`);
      if (kv['phone'] || kv['tel']) lines.push(`TEL;TYPE=CELL:${kv['phone'] ?? kv['tel'] ?? ''}`);
      if (kv['email']) lines.push(`EMAIL:${kv['email']}`);
      if (kv['url'] || kv['website']) lines.push(`URL:${kv['url'] ?? kv['website'] ?? ''}`);
      if (kv['address'] || kv['adr']) lines.push(`ADR;TYPE=WORK:;;${vcardEscape(kv['address'] ?? kv['adr'] ?? '')};;;;`);
      if (kv['note']) lines.push(`NOTE:${vcardEscape(kv['note'])}`);
      lines.push('END:VCARD');
      if (name === '') notes.push('No name given — add a "name: …" line.');
      return { payload: lines.join('\n'), notes };
    }
    case 'email': {
      const kv = parseKeyValues(text);
      const to = kv['to'] ?? kv['email'] ?? kv['address'] ?? (Object.keys(kv).length === 0 ? text.trim() : '');
      const q: string[] = [];
      if (kv['subject']) q.push(`subject=${encodeURIComponent(kv['subject'])}`);
      if (kv['body']) q.push(`body=${encodeURIComponent(kv['body'])}`);
      if (kv['cc']) q.push(`cc=${encodeURIComponent(kv['cc'])}`);
      return { payload: `mailto:${to}${q.length ? '?' + q.join('&') : ''}`, notes };
    }
    case 'phone': {
      const kv = parseKeyValues(text);
      const num = (kv['phone'] ?? kv['tel'] ?? kv['number'] ?? text).trim().replace(/[\s().-]/g, '');
      return { payload: `tel:${num}`, notes };
    }
    case 'sms': {
      const kv = parseKeyValues(text);
      const to = (kv['to'] ?? kv['phone'] ?? kv['number'] ?? (Object.keys(kv).length === 0 ? text : '')).trim().replace(/[\s().-]/g, '');
      const body = kv['body'] ?? kv['message'] ?? kv['text'] ?? '';
      return { payload: `SMSTO:${to}:${body}`, notes };
    }
  }
}

export function runQrCode(input: string, ctx: RunContext): ModeResult {
  if (input.trim() === '') return { output: '', status: '' };
  const eccOpt = String(ctx.options['ecc'] ?? 'M').toUpperCase();
  const ecc: QrEcc = ECCS.includes(eccOpt as QrEcc) ? (eccOpt as QrEcc) : 'M';
  const pxN = Number(ctx.options['size']);
  const px = [128, 256, 512].includes(pxN) ? pxN : 256;
  const colour = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v.trim()) ? v.trim() : d);
  const dark = colour(ctx.options['dark'], '#000000');
  const light = colour(ctx.options['light'], '#ffffff');
  const presetOpt = ctx.options['preset'];
  const preset: QrPreset = PRESETS.includes(presetOpt as QrPreset) ? (presetOpt as QrPreset) : 'text';

  const { payload, notes } = buildPayload(preset, input);
  if (payload === '') return { output: '', error: { message: 'Nothing to encode.', hint: 'Fill in the fields for this preset.' }, status: 'Nothing to encode' };
  try {
    const qr = encodeQr(payload, { ecc });
    const svg = qrToSvg(qr, { scale: px, margin: 4, dark, light });
    const data: QrData = { modules: qr.modules, size: qr.size, version: qr.version, ecc: qr.ecc, mask: qr.mask, mode: qr.mode, bytes: qr.bytes, payload, svg, px, dark, light };
    return {
      output: ctx.pretty ? svg : payload,
      view: { kind: 'qr', data },
      notes: notes.length ? notes : undefined,
      status: `Version ${qr.version} · ${qr.size}×${qr.size} · ECC ${qr.ecc} · ${qr.bytes} byte${qr.bytes === 1 ? '' : 's'} · ${qr.mode} mode · mask ${qr.mask}`,
    };
  } catch (e) {
    const err = e as { message: string; hint?: string };
    return { output: '', error: { message: err.message, hint: err.hint }, status: 'Too long for a QR code' };
  }
}

export const qrCodeMode: ToolMode = {
  id: 'qr-code',
  label: 'QR Code',
  description: 'Encode text, URLs, Wi-Fi credentials, vCards and more as a QR code, rendered locally as SVG.',
  category: 'Generators',
  icon: 'qr',
  keywords: ['qr', 'qrcode', 'barcode', 'wifi', 'vcard', 'svg', 'png', 'generate'],
  emptyHint: 'Type text or a URL. Presets: wifi = "ssid: …", "password: …", "type: WPA|WEP|nopass"; vcard = name/phone/email/org/url lines; email = to/subject/body; sms = to/body; phone = the number.',
  sample: 'https://c64.bjk.ai',
  sampleOptions: { preset: 'url', ecc: 'M' },
  supportsPretty: true,
  outputLanguage: (ctx) => (ctx.pretty ? 'xml' : undefined),
  controls: [
    {
      kind: 'select',
      key: 'preset',
      label: 'Preset',
      default: 'text',
      options: [
        { value: 'text', label: 'Text' },
        { value: 'url', label: 'URL' },
        { value: 'wifi', label: 'Wi-Fi' },
        { value: 'vcard', label: 'vCard' },
        { value: 'email', label: 'Email' },
        { value: 'phone', label: 'Phone' },
        { value: 'sms', label: 'SMS' },
      ],
    },
    {
      kind: 'select',
      key: 'ecc',
      label: 'ECC',
      default: 'M',
      options: [
        { value: 'L', label: 'L (7%)' },
        { value: 'M', label: 'M (15%)' },
        { value: 'Q', label: 'Q (25%)' },
        { value: 'H', label: 'H (30%)' },
      ],
    },
    {
      kind: 'select',
      key: 'size',
      label: 'Size',
      default: '256',
      options: [
        { value: '128', label: '128 px' },
        { value: '256', label: '256 px' },
        { value: '512', label: '512 px' },
      ],
    },
    { kind: 'text', key: 'dark', label: 'Dark', placeholder: '#000000', default: '#000000' },
    { kind: 'text', key: 'light', label: 'Light', placeholder: '#ffffff', default: '#ffffff' },
  ],
  run: runQrCode,
};
