/**
 * ip.ts — IPv4 / IPv6 parsing, formatting and subnet arithmetic with BigInt.
 *
 * What it implements
 * ------------------
 * - IPv4 dotted-quad parsing (strict: four decimal octets 0–255, no leading
 *   `+`, no octal/hex shorthand) and dotted netmask → prefix length.
 * - IPv6 parsing per RFC 4291 §2.2: hextets, one `::` gap, embedded dotted
 *   IPv4 in the last 32 bits. Zone ids (`%eth0`) are rejected.
 * - Expansion (`2001:0db8:0000:…`) and RFC 5952 compression (longest run of
 *   ≥2 zero hextets → `::`, lowercase hex).
 * - Subnet maths: network, broadcast, wildcard, first/last usable host, host
 *   count with the /31 (RFC 3021) and /32 special cases; /127 and /128 for v6.
 * - Address classification: IPv4 class A–E and RFC 1918 / loopback /
 *   link-local / multicast / CGNAT (RFC 6598) / documentation / benchmarking /
 *   reserved; IPv6 loopback / unspecified / ULA / link-local / multicast /
 *   documentation / IPv4-mapped / 6to4 / Teredo / global.
 * - Reverse DNS names (in-addr.arpa / ip6.arpa) and IPv4 range → minimal
 *   CIDR list.
 */

export class IpError extends Error {
  constructor(message: string, public hint: string) {
    super(message);
  }
}

const V4_MAX = (1n << 32n) - 1n;
const V6_MAX = (1n << 128n) - 1n;

export type IpVersion = 4 | 6;

/* --------------------------------------------------------------- parsing */

export function parseIPv4(s: string): bigint {
  const parts = s.trim().split('.');
  if (parts.length !== 4) throw new IpError(`"${s}" is not an IPv4 address`, 'An IPv4 address is four decimal numbers 0–255 separated by dots, e.g. 192.168.1.10.');
  let v = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) throw new IpError(`"${s}" is not an IPv4 address: octet "${p}" is out of range`, 'Each octet must be a decimal number between 0 and 255.');
    v = (v << 8n) | BigInt(Number(p));
  }
  return v;
}

export function isIPv4(s: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(s.trim());
}

export function parseIPv6(s: string): bigint {
  const src = s.trim();
  if (src.includes('%')) throw new IpError(`"${src}" has a zone id`, 'Remove the `%zone` suffix; only bare addresses are supported.');
  if (!/^[0-9a-fA-F:.]+$/.test(src) || !src.includes(':')) throw new IpError(`"${src}" is not an IPv6 address`, 'An IPv6 address is up to eight hex groups separated by colons, e.g. 2001:db8::1.');
  const halves = src.split('::');
  if (halves.length > 2 || src.includes(':::')) throw new IpError(`"${src}" has more than one "::"`, 'Only one `::` gap is allowed in an IPv6 address.');
  const toHextets = (part: string): bigint[] => {
    if (part === '') return [];
    const groups = part.split(':');
    const out: bigint[] = [];
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i]!;
      if (i === groups.length - 1 && g.includes('.')) {
        const v4 = parseIPv4(g);
        out.push(v4 >> 16n, v4 & 0xffffn);
      } else if (/^[0-9a-fA-F]{1,4}$/.test(g)) {
        out.push(BigInt(parseInt(g, 16)));
      } else {
        throw new IpError(`"${src}" is not an IPv6 address: bad group "${g}"`, 'Each group is 1–4 hex digits; an empty group is only allowed as the single `::` gap.');
      }
    }
    return out;
  };
  const head = toHextets(halves[0]!);
  const tail = halves.length === 2 ? toHextets(halves[1]!) : [];
  const total = head.length + tail.length;
  if (halves.length === 2 ? total > 7 : total !== 8) {
    throw new IpError(`"${src}" is not an IPv6 address: ${total} groups`, halves.length === 2 ? 'With `::` present the address may hold at most seven explicit groups.' : 'Without `::` an IPv6 address needs exactly eight groups.');
  }
  const hextets = [...head, ...new Array<bigint>(8 - total).fill(0n), ...tail];
  let v = 0n;
  for (const x of hextets) v = (v << 16n) | x;
  return v;
}

export function parseIp(s: string): { value: bigint; version: IpVersion } {
  const t = s.trim();
  if (t.includes(':')) return { value: parseIPv6(t), version: 6 };
  return { value: parseIPv4(t), version: 4 };
}

/* ------------------------------------------------------------ formatting */

export function formatIPv4(v: bigint): string {
  return [v >> 24n, (v >> 16n) & 255n, (v >> 8n) & 255n, v & 255n].map(String).join('.');
}

export function hextetsOf(v: bigint): number[] {
  const out: number[] = [];
  for (let i = 7; i >= 0; i--) out.push(Number((v >> BigInt(i * 16)) & 0xffffn));
  return out;
}

export function expandIPv6(v: bigint): string {
  return hextetsOf(v).map((x) => x.toString(16).padStart(4, '0')).join(':');
}

/** RFC 5952 canonical text form. */
export function compressIPv6(v: bigint): string {
  const hx = hextetsOf(v);
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (hx[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && hx[j] === 0) j++;
    if (j - i > bestLen) {
      bestStart = i;
      bestLen = j - i;
    }
    i = j;
  }
  const s = (a: number[]) => a.map((x) => x.toString(16)).join(':');
  if (bestLen < 2) return s(hx);
  return `${s(hx.slice(0, bestStart))}::${s(hx.slice(bestStart + bestLen))}`;
}

export function formatIp(v: bigint, version: IpVersion): string {
  return version === 4 ? formatIPv4(v) : compressIPv6(v);
}

export function binaryIPv4(v: bigint): string {
  return [v >> 24n, (v >> 16n) & 255n, (v >> 8n) & 255n, v & 255n].map((o) => o.toString(2).padStart(8, '0')).join('.');
}

export function reverseDns(v: bigint, version: IpVersion): string {
  if (version === 4) return formatIPv4(v).split('.').reverse().join('.') + '.in-addr.arpa';
  return expandIPv6(v).replace(/:/g, '').split('').reverse().join('.') + '.ip6.arpa';
}

/* ---------------------------------------------------------------- masks */

export function maskOf(prefix: number, version: IpVersion): bigint {
  const bits = version === 4 ? 32n : 128n;
  const max = version === 4 ? V4_MAX : V6_MAX;
  if (prefix === 0) return 0n;
  return (max << (bits - BigInt(prefix))) & max;
}

/** Dotted IPv4 netmask → prefix length; throws for non-contiguous masks. */
export function prefixFromNetmask(mask: string): number {
  const v = parseIPv4(mask);
  const bin = v.toString(2).padStart(32, '0');
  const ones = bin.indexOf('0') < 0 ? 32 : bin.indexOf('0');
  if (bin.slice(ones).includes('1')) throw new IpError(`"${mask}" is not a contiguous netmask`, 'A netmask is a run of 1-bits followed by 0-bits, e.g. 255.255.255.0 (/24).');
  return ones;
}

/* ------------------------------------------------------- classification */

interface Range4 { cidr: string; type: string }

const V4_TYPES: Range4[] = [
  { cidr: '0.0.0.0/8', type: '"this" network' },
  { cidr: '10.0.0.0/8', type: 'private (RFC 1918)' },
  { cidr: '100.64.0.0/10', type: 'shared / CGNAT (RFC 6598)' },
  { cidr: '127.0.0.0/8', type: 'loopback' },
  { cidr: '169.254.0.0/16', type: 'link-local (APIPA)' },
  { cidr: '172.16.0.0/12', type: 'private (RFC 1918)' },
  { cidr: '192.0.0.0/24', type: 'IETF protocol assignments' },
  { cidr: '192.0.2.0/24', type: 'documentation (TEST-NET-1)' },
  { cidr: '192.88.99.0/24', type: '6to4 relay anycast (deprecated)' },
  { cidr: '192.168.0.0/16', type: 'private (RFC 1918)' },
  { cidr: '198.18.0.0/15', type: 'benchmarking (RFC 2544)' },
  { cidr: '198.51.100.0/24', type: 'documentation (TEST-NET-2)' },
  { cidr: '203.0.113.0/24', type: 'documentation (TEST-NET-3)' },
  { cidr: '224.0.0.0/4', type: 'multicast' },
  { cidr: '255.255.255.255/32', type: 'limited broadcast' },
  { cidr: '240.0.0.0/4', type: 'reserved (class E)' },
];

const V6_TYPES: Range4[] = [
  { cidr: '::/128', type: 'unspecified' },
  { cidr: '::1/128', type: 'loopback' },
  { cidr: '::ffff:0:0/96', type: 'IPv4-mapped' },
  { cidr: '64:ff9b::/96', type: 'IPv4/IPv6 translation (NAT64)' },
  { cidr: '2001::/32', type: 'Teredo' },
  { cidr: '2001:db8::/32', type: 'documentation' },
  { cidr: '2002::/16', type: '6to4' },
  { cidr: 'fc00::/7', type: 'unique local (ULA)' },
  { cidr: 'fe80::/10', type: 'link-local' },
  { cidr: 'ff00::/8', type: 'multicast' },
  { cidr: '2000::/3', type: 'global unicast' },
];

function inCidr(v: bigint, cidr: string, version: IpVersion): boolean {
  const [addr, p] = cidr.split('/');
  const base = version === 4 ? parseIPv4(addr!) : parseIPv6(addr!);
  const mask = maskOf(Number(p), version);
  return (v & mask) === (base & mask);
}

export function classifyIp(v: bigint, version: IpVersion): string {
  const table = version === 4 ? V4_TYPES : V6_TYPES;
  for (const r of table) if (inCidr(v, r.cidr, version)) return r.type;
  return version === 4 ? 'public (global unicast)' : 'reserved / unassigned';
}

export function ipv4Class(v: bigint): string {
  const first = Number(v >> 24n);
  if (first < 128) return 'A';
  if (first < 192) return 'B';
  if (first < 224) return 'C';
  if (first < 240) return 'D (multicast)';
  return 'E (reserved)';
}

/* --------------------------------------------------------------- subnets */

export interface Subnet {
  version: IpVersion;
  address: bigint;
  prefix: number;
  network: bigint;
  /** Last address of the block (the broadcast address for IPv4). */
  last: bigint;
  netmask: bigint;
  wildcard: bigint;
  firstHost: bigint;
  lastHost: bigint;
  hosts: bigint;
}

export function subnetOf(address: bigint, prefix: number, version: IpVersion): Subnet {
  const bits = version === 4 ? 32 : 128;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) throw new IpError(`Prefix /${prefix} is out of range`, `An IPv${version} prefix length is between 0 and ${bits}.`);
  const max = version === 4 ? V4_MAX : V6_MAX;
  const netmask = maskOf(prefix, version);
  const wildcard = netmask ^ max;
  const network = address & netmask;
  const last = network | wildcard;
  const size = 1n << BigInt(bits - prefix);
  let firstHost: bigint;
  let lastHost: bigint;
  let hosts: bigint;
  if (version === 4) {
    if (prefix >= 31) {
      // RFC 3021 point-to-point (/31) and single host (/32): every address is usable.
      firstHost = network;
      lastHost = last;
      hosts = size;
    } else {
      firstHost = network + 1n;
      lastHost = last - 1n;
      hosts = size - 2n;
    }
  } else {
    // IPv6 has no broadcast; the subnet-router anycast (::0) is conventionally skipped for prefixes < 127.
    firstHost = prefix >= 127 ? network : network + 1n;
    lastHost = last;
    hosts = prefix >= 127 ? size : size - 1n;
  }
  return { version, address, prefix, network, last, netmask, wildcard, firstHost, lastHost, hosts };
}

/** Split a block into 2^n equal sub-blocks. */
export function splitSubnet(s: Subnet, extraBits: number, cap = 64): Subnet[] {
  const bits = s.version === 4 ? 32 : 128;
  const newPrefix = Math.min(bits, s.prefix + extraBits);
  const count = Math.min(cap, 2 ** (newPrefix - s.prefix));
  const step = 1n << BigInt(bits - newPrefix);
  const out: Subnet[] = [];
  for (let i = 0; i < count; i++) out.push(subnetOf(s.network + step * BigInt(i), newPrefix, s.version));
  return out;
}

/** Minimal list of CIDR blocks exactly covering [start, end]. */
export function rangeToCidrs(start: bigint, end: bigint, version: IpVersion): { network: bigint; prefix: number }[] {
  const bits = version === 4 ? 32 : 128;
  const out: { network: bigint; prefix: number }[] = [];
  let cur = start;
  while (cur <= end) {
    let size = 0;
    // Largest aligned block at `cur` that does not pass `end`.
    while (size < bits) {
      const next = 1n << BigInt(size + 1);
      if (cur % next !== 0n || cur + next - 1n > end) break;
      size++;
    }
    out.push({ network: cur, prefix: bits - size });
    cur += 1n << BigInt(size);
  }
  return out;
}
