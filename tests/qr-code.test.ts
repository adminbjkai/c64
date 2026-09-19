import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeQr, qrToSvg, rsGenerator, rsRemainder, selectMode, readFormatInfo, alignmentPositions, dataCodewords, formatBits, versionBits, maskBit } from '../src/lib/qr.js';
import { runQrCode, qrCodeMode, buildPayload, parseKeyValues } from '../src/modes/qr-code.js';
import type { QrData } from '../src/modes/qr-code.js';

const ctx = (options: Record<string, unknown> = {}, pretty = false) => ({ pretty, options });

function isFinder(m: boolean[][], x0: number, y0: number): boolean {
  for (let dy = 0; dy < 7; dy++) {
    for (let dx = 0; dx < 7; dx++) {
      const edge = dx === 0 || dx === 6 || dy === 0 || dy === 6;
      const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
      if ((m[y0 + dy] as boolean[])[x0 + dx] !== (edge || core)) return false;
    }
  }
  return true;
}

test('HELLO WORLD at ECC M is version 1 (21×21) in alphanumeric mode', () => {
  const qr = encodeQr('HELLO WORLD', { ecc: 'M' });
  assert.equal(qr.version, 1);
  assert.equal(qr.size, 21);
  assert.equal(qr.modules.length, 21);
  for (const row of qr.modules) assert.equal(row.length, 21);
  assert.equal(qr.mode, 'alphanumeric');
  assert.equal(qr.ecc, 'M');
});

test('finder patterns sit in the three corners with light separators', () => {
  const qr = encodeQr('HELLO WORLD', { ecc: 'M' });
  const m = qr.modules;
  assert.ok(isFinder(m, 0, 0), 'top-left finder');
  assert.ok(isFinder(m, qr.size - 7, 0), 'top-right finder');
  assert.ok(isFinder(m, 0, qr.size - 7), 'bottom-left finder');
  // separators
  for (let i = 0; i < 8; i++) {
    assert.equal((m[7] as boolean[])[i], false);
    assert.equal((m[i] as boolean[])[7], false);
    assert.equal((m[7] as boolean[])[qr.size - 8], false);
    assert.equal((m[qr.size - 8] as boolean[])[i], false);
  }
  // dark module
  assert.equal((m[qr.size - 8] as boolean[])[8], true);
});

test('timing patterns alternate dark/light along row 6 and column 6', () => {
  const qr = encodeQr('HELLO WORLD', { ecc: 'M' });
  for (let i = 8; i < qr.size - 8; i++) {
    assert.equal((qr.modules[6] as boolean[])[i], i % 2 === 0, `row 6 col ${i}`);
    assert.equal((qr.modules[i] as boolean[])[6], i % 2 === 0, `col 6 row ${i}`);
  }
});

test('format info decodes back to the chosen ECC level and mask', () => {
  for (const ecc of ['L', 'M', 'Q', 'H'] as const) {
    const qr = encodeQr('HELLO WORLD', { ecc });
    const info = readFormatInfo(qr.modules);
    assert.equal(info.ecc, ecc);
    assert.equal(info.mask, qr.mask);
  }
  const forced = encodeQr('HELLO WORLD', { ecc: 'M', mask: 5 });
  assert.equal(forced.mask, 5);
  assert.deepEqual(readFormatInfo(forced.modules), { ecc: 'M', mask: 5 });
  // Known format-info codeword: ECC M, mask 0 → 0x5412 (all-zero data XOR mask pattern); ECC L mask 0 → 0x77C4.
  assert.equal(formatBits('M', 0), 0x5412);
  assert.equal(formatBits('L', 0), 0x77c4);
  assert.equal(formatBits('H', 7), 0x083b);
  // Known version-info: v7 → 0x07C94.
  assert.equal(versionBits(7), 0x07c94);
});

test('numeric mode is selected for digits, byte mode for anything else', () => {
  assert.equal(selectMode('0123456789'), 'numeric');
  assert.equal(selectMode('HELLO WORLD'), 'alphanumeric');
  assert.equal(selectMode('hello'), 'byte');
  assert.equal(selectMode('héllo'), 'byte');
  const digits = encodeQr('01234567', { ecc: 'M' });
  assert.equal(digits.mode, 'numeric');
  assert.equal(digits.version, 1);
  // 41 digits fit in version 1-L numerically (capacity 41) but not in byte mode.
  const long = encodeQr('1'.repeat(41), { ecc: 'L' });
  assert.equal(long.version, 1);
});

test('capacity growth: longer text picks a higher version; too long errors', () => {
  const short = encodeQr('a', { ecc: 'M' });
  const long = encodeQr('x'.repeat(200), { ecc: 'M' });
  assert.equal(short.version, 1);
  assert.ok(long.version > 1);
  assert.equal(long.size, long.version * 4 + 17);
  const huge = encodeQr('x'.repeat(2900), { ecc: 'L' });
  assert.equal(huge.version, 40);
  assert.equal(huge.size, 177);
  assert.throws(() => encodeQr('x'.repeat(3000), { ecc: 'L' }), /too long/i);
  // Standard capacities: v1-M 16 data codewords, v40-L 2956.
  assert.equal(dataCodewords(1, 'M'), 16);
  assert.equal(dataCodewords(1, 'L'), 19);
  assert.equal(dataCodewords(40, 'L'), 2956);
  assert.equal(dataCodewords(10, 'H'), 122);
});

test('alignment pattern positions match the standard table', () => {
  assert.deepEqual(alignmentPositions(1), []);
  assert.deepEqual(alignmentPositions(2), [6, 18]);
  assert.deepEqual(alignmentPositions(7), [6, 22, 38]);
  assert.deepEqual(alignmentPositions(32), [6, 34, 60, 86, 112, 138]);
  assert.deepEqual(alignmentPositions(40), [6, 30, 58, 86, 114, 142, 170]);
});

test('Reed–Solomon generator polynomials match the standard tables', () => {
  assert.deepEqual(rsGenerator(7), [1, 127, 122, 154, 164, 11, 68, 117]);
  assert.deepEqual(rsGenerator(10), [1, 216, 194, 159, 111, 199, 94, 95, 113, 157, 193]);
  // "HELLO WORLD" v1-M data codewords → known 10 EC codewords (thonky.com worked example).
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(rsRemainder(data, 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

test('mask patterns follow the spec formulas', () => {
  assert.equal(maskBit(0, 0, 0), true);
  assert.equal(maskBit(0, 1, 0), false);
  assert.equal(maskBit(1, 0, 1), false);
  assert.equal(maskBit(2, 3, 5), true);
  assert.equal(maskBit(3, 1, 2), true);
});

test('svg output contains rect and path with the chosen colours and size', () => {
  const qr = encodeQr('HELLO WORLD', { ecc: 'M' });
  const svg = qrToSvg(qr, { scale: 512, margin: 4, dark: '#123456', light: '#fefefe' });
  assert.match(svg, /<rect/);
  assert.match(svg, /<path d="M/);
  assert.match(svg, /fill="#123456"/);
  assert.match(svg, /fill="#fefefe"/);
  assert.match(svg, /width="512"/);
  assert.match(svg, /viewBox="0 0 29 29"/);
});

test('mode: empty input, sample, Pretty=SVG / Raw=payload, status and view', () => {
  assert.deepEqual(runQrCode('', ctx()), { output: '', status: '' });
  const raw = runQrCode(qrCodeMode.sample, ctx(qrCodeMode.sampleOptions));
  assert.equal(raw.error, undefined);
  assert.equal(raw.output, 'https://c64.bjk.ai');
  const pretty = runQrCode(qrCodeMode.sample, ctx(qrCodeMode.sampleOptions, true));
  assert.match(pretty.output, /^<svg /);
  assert.match(raw.status!, /^Version \d+ · \d+×\d+ · ECC M · 18 bytes/);
  assert.equal(raw.view?.kind, 'qr');
  const d = raw.view?.data as QrData;
  assert.equal(d.payload, 'https://c64.bjk.ai');
  assert.equal(d.px, 256);
  assert.equal(d.modules.length, d.size);
});

test('mode controls: ecc, size, colours', () => {
  const r = runQrCode('HELLO WORLD', ctx({ ecc: 'H', size: '512', dark: '#ff0000', light: '#00ff00' }, true));
  assert.match(r.status!, /ECC H/);
  assert.match(r.output, /width="512"/);
  assert.match(r.output, /fill="#ff0000"/);
  const bad = runQrCode('HELLO WORLD', ctx({ ecc: 'nope', size: '7', dark: 'red' }));
  assert.match(bad.status!, /ECC M/);
  assert.equal((bad.view?.data as QrData).px, 256);
  assert.equal((bad.view?.data as QrData).dark, '#000000');
});

test('presets build the right payloads', () => {
  assert.equal(buildPayload('url', 'example.com').payload, 'https://example.com');
  assert.equal(buildPayload('url', 'http://x.io').payload, 'http://x.io');
  assert.equal(buildPayload('wifi', 'ssid: Home Net\npassword: p;ss\ntype: WPA2').payload, 'WIFI:T:WPA;S:Home Net;P:p\\;ss;;');
  assert.equal(buildPayload('wifi', 'MyNet;secret;WEP').payload, 'WIFI:T:WEP;S:MyNet;P:secret;;');
  assert.equal(buildPayload('wifi', 'ssid: Open\ntype: nopass\nhidden: true').payload, 'WIFI:T:nopass;S:Open;H:true;;');
  const v = buildPayload('vcard', 'name: Ada Lovelace\nphone: +44 1234\nemail: ada@example.com\norg: Analytical Engines').payload;
  assert.match(v, /^BEGIN:VCARD\nVERSION:3\.0\nN:Lovelace;Ada;;;\nFN:Ada Lovelace\n/);
  assert.match(v, /TEL;TYPE=CELL:\+44 1234/);
  assert.match(v, /END:VCARD$/);
  assert.equal(buildPayload('email', 'to: a@b.c\nsubject: Hi there\nbody: Line').payload, 'mailto:a@b.c?subject=Hi%20there&body=Line');
  assert.equal(buildPayload('email', 'a@b.c').payload, 'mailto:a@b.c');
  assert.equal(buildPayload('phone', '+1 (555) 010-2030').payload, 'tel:+15550102030');
  assert.equal(buildPayload('sms', 'to: +1 555 0100\nbody: hello').payload, 'SMSTO:+15550100:hello');
  assert.deepEqual(parseKeyValues('SSID = x\nPass-Word: y\n\nnot a pair'), { ssid: 'x', password: 'y' });
  const r = runQrCode('ssid: Net\npassword: pw', ctx({ preset: 'wifi' }));
  assert.equal(r.output, 'WIFI:T:WPA;S:Net;P:pw;;');
  assert.equal(r.view?.kind, 'qr');
});
