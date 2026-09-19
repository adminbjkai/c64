/**
 * QR Code encoder (ISO/IEC 18004), hand-rolled and dependency-free.
 * Implements: numeric / alphanumeric / byte (UTF-8) modes with automatic
 * mode selection (one segment per code), versions 1–40 (smallest that fits),
 * error-correction levels L/M/Q/H, Reed–Solomon over GF(256) with the
 * 0x11D primitive polynomial, block interleaving, all 8 mask patterns with
 * the standard penalty scoring, format and version information. Not
 * implemented: Kanji mode, ECI, structured append, mixed-mode segments,
 * Micro QR.
 */

export type QrEcc = 'L' | 'M' | 'Q' | 'H';
export type QrMode = 'numeric' | 'alphanumeric' | 'byte';

export interface QrCode {
  /** Modules per side (21 for version 1 … 177 for version 40). */
  size: number;
  /** modules[row][col] — true = dark. */
  modules: boolean[][];
  version: number;
  ecc: QrEcc;
  mask: number;
  mode: QrMode;
  /** Number of data bytes encoded (UTF-8 for byte mode). */
  bytes: number;
}

export interface QrSvgOptions {
  /** Total rendered width/height in px (viewBox stays in modules). */
  scale?: number;
  /** Quiet zone in modules (spec recommends 4). */
  margin?: number;
  dark?: string;
  light?: string;
}

/* ------------------------------------------------------------ GF(256) */

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255] as number;
})();

export function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[(GF_LOG[a] as number) + (GF_LOG[b] as number)] as number;
}

/** Generator polynomial for `degree` EC codewords, highest-degree coefficient first (always 1). */
export function rsGenerator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    const root = GF_EXP[i] as number;
    for (let j = 0; j < poly.length; j++) {
      next[j] = (next[j] as number) ^ (poly[j] as number);
      next[j + 1] = (next[j + 1] as number) ^ gfMul(poly[j] as number, root);
    }
    poly = next;
  }
  return poly;
}

/** Reed–Solomon remainder of data · x^degree modulo the generator. */
export function rsRemainder(data: number[], degree: number): number[] {
  const gen = rsGenerator(degree);
  const rem = new Array<number>(degree).fill(0);
  for (const b of data) {
    const factor = b ^ (rem.shift() as number);
    rem.push(0);
    for (let i = 0; i < degree; i++) rem[i] = (rem[i] as number) ^ gfMul(gen[i + 1] as number, factor);
  }
  return rem;
}

/* --------------------------------------------------------------- tables */

const ECC_INDEX: Record<QrEcc, number> = { L: 0, M: 1, Q: 2, H: 3 };
/** Format-info bits for each level (L=01, M=00, Q=11, H=10). */
const ECC_FORMAT_BITS: Record<QrEcc, number> = { L: 1, M: 0, Q: 3, H: 2 };

// Index = version (0 unused). Rows: L, M, Q, H.
const ECC_CODEWORDS_PER_BLOCK: number[][] = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_EC_BLOCKS: number[][] = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

/** Number of data-bearing modules (bits) in a version, after removing all function patterns. */
export function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

export function dataCodewords(version: number, ecc: QrEcc): number {
  const i = ECC_INDEX[ecc];
  return Math.floor(rawDataModules(version) / 8) - (ECC_CODEWORDS_PER_BLOCK[i]![version] as number) * (NUM_EC_BLOCKS[i]![version] as number);
}

export function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
  const result = [6];
  const size = version * 4 + 17;
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

/* ------------------------------------------------------------- segments */

const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

export function selectMode(text: string): QrMode {
  if (text.length === 0) return 'byte';
  if (/^[0-9]+$/.test(text)) return 'numeric';
  let alnum = true;
  for (const ch of text) if (!ALNUM.includes(ch)) { alnum = false; break; }
  return alnum ? 'alphanumeric' : 'byte';
}

const MODE_INDICATOR: Record<QrMode, number> = { numeric: 1, alphanumeric: 2, byte: 4 };

function charCountBits(mode: QrMode, version: number): number {
  const idx = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  const table: Record<QrMode, number[]> = { numeric: [10, 12, 14], alphanumeric: [9, 11, 13], byte: [8, 16, 16] };
  return table[mode][idx] as number;
}

class BitBuffer {
  bits: number[] = [];
  push(value: number, count: number): void {
    for (let i = count - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
}

function encodeData(text: string, mode: QrMode, bytes: Uint8Array): { bits: number[]; count: number } {
  const buf = new BitBuffer();
  if (mode === 'numeric') {
    for (let i = 0; i < text.length; i += 3) {
      const chunk = text.slice(i, i + 3);
      buf.push(parseInt(chunk, 10), chunk.length === 3 ? 10 : chunk.length === 2 ? 7 : 4);
    }
    return { bits: buf.bits, count: text.length };
  }
  if (mode === 'alphanumeric') {
    for (let i = 0; i < text.length; i += 2) {
      const a = ALNUM.indexOf(text[i] as string);
      if (i + 1 < text.length) buf.push(a * 45 + ALNUM.indexOf(text[i + 1] as string), 11);
      else buf.push(a, 6);
    }
    return { bits: buf.bits, count: text.length };
  }
  for (const b of bytes) buf.push(b, 8);
  return { bits: buf.bits, count: bytes.length };
}

/* --------------------------------------------------------------- matrix */

class Matrix {
  size: number;
  modules: boolean[][];
  isFunction: boolean[][];
  constructor(size: number) {
    this.size = size;
    this.modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    this.isFunction = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  }
  setFunction(x: number, y: number, dark: boolean): void {
    (this.modules[y] as boolean[])[x] = dark;
    (this.isFunction[y] as boolean[])[x] = true;
  }
  get(x: number, y: number): boolean {
    return (this.modules[y] as boolean[])[x] as boolean;
  }
}

function drawFinder(m: Matrix, cx: number, cy: number): void {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      const x = cx + dx;
      const y = cy + dy;
      if (x >= 0 && x < m.size && y >= 0 && y < m.size) m.setFunction(x, y, dist !== 2 && dist !== 4);
    }
  }
}

function drawAlignment(m: Matrix, cx: number, cy: number): void {
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) m.setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
}

export function formatBits(ecc: QrEcc, mask: number): number {
  const data = (ECC_FORMAT_BITS[ecc] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

export function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

function drawFormat(m: Matrix, ecc: QrEcc, mask: number): void {
  const bits = formatBits(ecc, mask);
  const bit = (i: number) => ((bits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) m.setFunction(8, i, bit(i));
  m.setFunction(8, 7, bit(6));
  m.setFunction(8, 8, bit(7));
  m.setFunction(7, 8, bit(8));
  for (let i = 9; i < 15; i++) m.setFunction(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) m.setFunction(m.size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) m.setFunction(8, m.size - 15 + i, bit(i));
  m.setFunction(8, m.size - 8, true); // always-dark module
}

function drawVersion(m: Matrix, version: number): void {
  if (version < 7) return;
  const bits = versionBits(version);
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) === 1;
    const a = m.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    m.setFunction(a, b, dark);
    m.setFunction(b, a, dark);
  }
}

function drawFunctionPatterns(m: Matrix, version: number, ecc: QrEcc): void {
  for (let i = 0; i < m.size; i++) {
    m.setFunction(6, i, i % 2 === 0);
    m.setFunction(i, 6, i % 2 === 0);
  }
  drawFinder(m, 3, 3);
  drawFinder(m, m.size - 4, 3);
  drawFinder(m, 3, m.size - 4);
  const pos = alignmentPositions(version);
  const n = pos.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      drawAlignment(m, pos[i] as number, pos[j] as number);
    }
  }
  drawFormat(m, ecc, 0); // reserves the area; rewritten once the mask is chosen
  drawVersion(m, version);
}

function drawCodewords(m: Matrix, data: number[]): void {
  let i = 0;
  const total = data.length * 8;
  for (let right = m.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < m.size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? m.size - 1 - vert : vert;
        if (!(m.isFunction[y] as boolean[])[x] && i < total) {
          (m.modules[y] as boolean[])[x] = (((data[i >>> 3] as number) >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
    }
  }
}

export function maskBit(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function applyMask(m: Matrix, mask: number): void {
  for (let y = 0; y < m.size; y++) {
    for (let x = 0; x < m.size; x++) {
      if ((m.isFunction[y] as boolean[])[x]) continue;
      if (maskBit(mask, x, y)) (m.modules[y] as boolean[])[x] = !(m.modules[y] as boolean[])[x];
    }
  }
}

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

export function penaltyScore(modules: boolean[][]): number {
  const size = modules.length;
  let result = 0;
  const line = (get: (i: number) => boolean) => {
    // N1: runs of 5+ same-colour modules.
    let runColor = get(0);
    let runLen = 1;
    for (let i = 1; i < size; i++) {
      const c = get(i);
      if (c === runColor) {
        runLen++;
        if (runLen === 5) result += PENALTY_N1;
        else if (runLen > 5) result++;
      } else {
        runColor = c;
        runLen = 1;
      }
    }
    // N3: 1011101 finder-like pattern with 4 light modules on either side (edge counts as light).
    const at = (i: number) => (i < 0 || i >= size ? false : get(i));
    for (let i = 0; i + 7 <= size; i++) {
      if (at(i) && !at(i + 1) && at(i + 2) && at(i + 3) && at(i + 4) && !at(i + 5) && at(i + 6)) {
        const before = !at(i - 1) && !at(i - 2) && !at(i - 3) && !at(i - 4);
        const after = !at(i + 7) && !at(i + 8) && !at(i + 9) && !at(i + 10);
        if (before) result += PENALTY_N3;
        if (after) result += PENALTY_N3;
      }
    }
  };
  for (let y = 0; y < size; y++) line((x) => (modules[y] as boolean[])[x] as boolean);
  for (let x = 0; x < size; x++) line((y) => (modules[y] as boolean[])[x] as boolean);
  // N2: 2×2 blocks of the same colour.
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = (modules[y] as boolean[])[x];
      if (c === (modules[y] as boolean[])[x + 1] && c === (modules[y + 1] as boolean[])[x] && c === (modules[y + 1] as boolean[])[x + 1]) result += PENALTY_N2;
    }
  }
  // N4: dark-module balance.
  let dark = 0;
  for (const row of modules) for (const c of row) if (c) dark++;
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  result += k * PENALTY_N4;
  return result;
}

/* ---------------------------------------------------------------- encode */

export class QrError extends Error {
  hint?: string;
  constructor(message: string, hint?: string) {
    super(message);
    this.hint = hint;
  }
}

export function encodeQr(text: string, opts: { ecc?: QrEcc; minVersion?: number; mask?: number } = {}): QrCode {
  const ecc: QrEcc = opts.ecc ?? 'M';
  const mode = selectMode(text);
  const bytes = new TextEncoder().encode(text);
  const { bits, count } = encodeData(text, mode, bytes);

  let version = Math.max(1, opts.minVersion ?? 1);
  let capacityBits = 0;
  for (; version <= 40; version++) {
    capacityBits = dataCodewords(version, ecc) * 8;
    if (4 + charCountBits(mode, version) + bits.length <= capacityBits) break;
  }
  if (version > 40) throw new QrError(`Text is too long for a QR code (${count} ${mode === 'byte' ? 'bytes' : 'chars'} at ECC ${ecc}).`, 'Shorten the text or lower the error-correction level.');

  const buf = new BitBuffer();
  buf.push(MODE_INDICATOR[mode], 4);
  buf.push(count, charCountBits(mode, version));
  buf.bits.push(...bits);
  buf.push(0, Math.min(4, capacityBits - buf.bits.length));
  while (buf.bits.length % 8 !== 0) buf.bits.push(0);
  for (let pad = 0xec; buf.bits.length < capacityBits; pad ^= 0xec ^ 0x11) buf.push(pad, 8);

  const data: number[] = [];
  for (let i = 0; i < buf.bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | (buf.bits[i + j] as number);
    data.push(b);
  }

  const codewords = interleave(data, version, ecc);
  const m = new Matrix(version * 4 + 17);
  drawFunctionPatterns(m, version, ecc);
  drawCodewords(m, codewords);

  let mask = opts.mask ?? -1;
  if (mask < 0 || mask > 7) {
    let best = Infinity;
    for (let i = 0; i < 8; i++) {
      applyMask(m, i);
      drawFormat(m, ecc, i);
      const p = penaltyScore(m.modules);
      if (p < best) { best = p; mask = i; }
      applyMask(m, i);
    }
  }
  applyMask(m, mask);
  drawFormat(m, ecc, mask);

  return { size: m.size, modules: m.modules, version, ecc, mask, mode, bytes: bytes.length };
}

function interleave(data: number[], version: number, ecc: QrEcc): number[] {
  const i = ECC_INDEX[ecc];
  const numBlocks = NUM_EC_BLOCKS[i]![version] as number;
  const blockEcLen = ECC_CODEWORDS_PER_BLOCK[i]![version] as number;
  const rawCodewords = Math.floor(rawDataModules(version) / 8);
  const numShort = numBlocks - (rawCodewords % numBlocks);
  const shortLen = Math.floor(rawCodewords / numBlocks);

  const blocks: number[][] = [];
  let k = 0;
  for (let b = 0; b < numBlocks; b++) {
    const dataLen = shortLen - blockEcLen + (b < numShort ? 0 : 1);
    const dat = data.slice(k, k + dataLen);
    k += dataLen;
    const ec = rsRemainder(dat, blockEcLen);
    if (b < numShort) dat.push(-1); // placeholder for the missing byte in short blocks
    blocks.push(dat.concat(ec));
  }
  const out: number[] = [];
  const blockLen = (blocks[0] as number[]).length;
  for (let j = 0; j < blockLen; j++) {
    for (let b = 0; b < numBlocks; b++) {
      const v = (blocks[b] as number[])[j] as number;
      if (v !== -1) out.push(v);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ SVG */

export function qrToSvg(qr: QrCode, opts: QrSvgOptions = {}): string {
  const margin = opts.margin ?? 4;
  const scale = opts.scale ?? 256;
  const dark = opts.dark ?? '#000000';
  const light = opts.light ?? '#ffffff';
  const dim = qr.size + margin * 2;
  const paths: string[] = [];
  for (let y = 0; y < qr.size; y++) {
    const row = qr.modules[y] as boolean[];
    for (let x = 0; x < qr.size; x++) if (row[x]) paths.push(`M${x + margin} ${y + margin}h1v1h-1z`);
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scale}" height="${scale}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges">\n` +
    `  <rect width="${dim}" height="${dim}" fill="${light}"/>\n` +
    `  <path d="${paths.join('')}" fill="${dark}"/>\n` +
    `</svg>\n`
  );
}

/** Reads the 15 format bits back from a matrix (top-left copy) and unmasks them: { ecc, mask }. */
export function readFormatInfo(modules: boolean[][]): { ecc: QrEcc; mask: number } {
  const get = (x: number, y: number) => ((modules[y] as boolean[])[x] ? 1 : 0);
  let bits = 0;
  for (let i = 0; i <= 5; i++) bits |= get(8, i) << i;
  bits |= get(8, 7) << 6;
  bits |= get(8, 8) << 7;
  bits |= get(7, 8) << 8;
  for (let i = 9; i < 15; i++) bits |= get(14 - i, 8) << i;
  const data = (bits ^ 0x5412) >>> 10;
  const eccBits = data >>> 3;
  const ecc = (Object.keys(ECC_FORMAT_BITS) as QrEcc[]).find((k) => ECC_FORMAT_BITS[k] === eccBits) as QrEcc;
  return { ecc, mask: data & 7 };
}
