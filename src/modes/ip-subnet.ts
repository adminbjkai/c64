/**
 * IP / Subnet Calculator mode: one item per line — IPv4/IPv6 address or
 * CIDR, IPv4 with a dotted netmask, or an IPv4 range (→ minimal CIDR list).
 */

import { type ToolMode, type ModeResult, type RunContext } from './types.js';
import {
  IpError, isIPv4, parseIp, parseIPv4, prefixFromNetmask, subnetOf, splitSubnet, rangeToCidrs, formatIp, formatIPv4, expandIPv6, binaryIPv4, reverseDns, classifyIp, ipv4Class,
  type IpVersion, type Subnet,
} from '../lib/ip.js';

export interface SubnetRow { label: string; value: string }

export interface SubnetSplit { cidr: string; first: string; last: string }

export interface SubnetNetItem {
  kind: 'net';
  line: number;
  input: string;
  version: IpVersion;
  cidr: string;
  /** Category-style badge text, e.g. "private (RFC 1918)". */
  type: string;
  rows: SubnetRow[];
  /** Extra prefix bits the user may split by (only offered for IPv4 blocks). */
  splitChoices: number[];
  splits: SubnetSplit[];
  splitPrefix: number | null;
}

export interface SubnetRangeItem {
  kind: 'range';
  line: number;
  input: string;
  version: IpVersion;
  start: string;
  end: string;
  count: string;
  cidrs: string[];
}

export type SubnetItem = SubnetNetItem | SubnetRangeItem;

export interface SubnetData {
  items: SubnetItem[];
}

function splitOption(v: unknown): number {
  const m = /^\+?([1-4])$/.exec(typeof v === 'string' ? v : '');
  return m ? Number(m[1]) : 0;
}

function describe(s: Subnet, input: string, line: number, split: number): SubnetNetItem {
  const v = s.version;
  const f = (x: bigint) => formatIp(x, v);
  const rows: SubnetRow[] = [];
  const cidr = `${f(s.network)}/${s.prefix}`;
  rows.push({ label: 'address', value: f(s.address) });
  if (v === 6) {
    rows.push({ label: 'expanded', value: expandIPv6(s.address) });
  }
  rows.push({ label: 'network', value: cidr });
  rows.push({ label: 'prefix', value: `/${s.prefix}` });
  rows.push({ label: 'netmask', value: f(s.netmask) });
  rows.push({ label: 'wildcard', value: f(s.wildcard) });
  if (v === 4) rows.push({ label: 'broadcast', value: s.prefix >= 31 ? '— (none for /' + s.prefix + ')' : f(s.last) });
  else rows.push({ label: 'last address', value: f(s.last) });
  rows.push({ label: 'first host', value: f(s.firstHost) });
  rows.push({ label: 'last host', value: f(s.lastHost) });
  rows.push({ label: 'usable hosts', value: s.hosts.toLocaleString('en-US') });
  const type = classifyIp(s.address, v);
  rows.push({ label: 'type', value: type });
  if (v === 4) rows.push({ label: 'class', value: ipv4Class(s.address) });
  rows.push({ label: 'integer', value: s.address.toString() });
  rows.push({ label: 'hex', value: '0x' + s.address.toString(16).padStart(v === 4 ? 8 : 32, '0') });
  if (v === 4) rows.push({ label: 'binary', value: binaryIPv4(s.address) });
  rows.push({ label: 'reverse DNS', value: reverseDns(s.address, v) });

  const bits = v === 4 ? 32 : 128;
  const splitChoices = v === 4 ? [1, 2, 3, 4].filter((n) => s.prefix + n <= bits) : [];
  let splits: SubnetSplit[] = [];
  let splitPrefix: number | null = null;
  if (split > 0 && s.prefix + split <= bits) {
    splitPrefix = s.prefix + split;
    splits = splitSubnet(s, split).map((b) => ({ cidr: `${f(b.network)}/${b.prefix}`, first: f(b.firstHost), last: f(b.lastHost) }));
  }
  return { kind: 'net', line, input, version: v, cidr, type, rows, splitChoices, splits, splitPrefix };
}

function parseLine(text: string, line: number, split: number): SubnetItem {
  const t = text.trim();
  // Range: a-b
  const range = /^(\S+)\s*-\s*(\S+)$/.exec(t);
  if (range && !t.includes('/')) {
    const a = parseIp(range[1]!);
    const b = parseIp(range[2]!);
    if (a.version !== b.version) throw new IpError('Range endpoints mix IPv4 and IPv6', 'Both ends of a range must be the same IP version.');
    if (a.value > b.value) throw new IpError(`Range start ${range[1]} is after end ${range[2]}`, 'Write the lower address first, e.g. 10.0.0.1-10.0.0.255.');
    const cidrs = rangeToCidrs(a.value, b.value, a.version).map((c) => `${formatIp(c.network, a.version)}/${c.prefix}`);
    return { kind: 'range', line, input: t, version: a.version, start: formatIp(a.value, a.version), end: formatIp(b.value, a.version), count: (b.value - a.value + 1n).toLocaleString('en-US'), cidrs };
  }
  // Address + netmask
  const nm = /^(\S+)\s+(\S+)$/.exec(t);
  if (nm) {
    if (!isIPv4(nm[1]!) || !isIPv4(nm[2]!)) throw new IpError(`Cannot read "${t}"`, 'Use `address netmask` (IPv4 only), `address/prefix`, a bare address or `start-end`.');
    const addr = parseIPv4(nm[1]!);
    const prefix = prefixFromNetmask(nm[2]!);
    return describe(subnetOf(addr, prefix, 4), t, line, split);
  }
  // CIDR or bare address
  const slash = t.indexOf('/');
  const addrText = slash < 0 ? t : t.slice(0, slash);
  const { value, version } = parseIp(addrText);
  let prefix = version === 4 ? 32 : 128;
  if (slash >= 0) {
    const p = t.slice(slash + 1);
    if (!/^\d{1,3}$/.test(p)) throw new IpError(`Bad prefix length "/${p}"`, `Write the prefix as a number after the slash, e.g. ${formatIp(value, version)}/${version === 4 ? 24 : 64}.`);
    prefix = Number(p);
  }
  return describe(subnetOf(value, prefix, version), t, line, split);
}

function itemText(it: SubnetItem): string {
  if (it.kind === 'range') {
    return [`${it.input}`, `  ${it.count} addresses · ${it.start} – ${it.end}`, ...it.cidrs.map((c) => `  ${c}`)].join('\n');
  }
  const w = Math.max(...it.rows.map((r) => r.label.length));
  const lines = [it.input, ...it.rows.map((r) => `  ${r.label.padEnd(w)}  ${r.value}`)];
  if (it.splits.length) {
    lines.push(`  split into /${it.splitPrefix}:`);
    for (const s of it.splits) lines.push(`    ${s.cidr}  ${s.first} – ${s.last}`);
  }
  return lines.join('\n');
}

export function runIpSubnet(input: string, ctx: RunContext): ModeResult {
  if (input.trim() === '') return { output: '', status: '' };
  const split = splitOption(ctx.options['split']);
  const lines = input.split(/\r?\n/);
  const items: SubnetItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!;
    if (text.trim() === '' || text.trim().startsWith('#')) continue;
    try {
      items.push(parseLine(text, i + 1, split));
    } catch (e) {
      const err = e as IpError;
      return {
        output: items.map(itemText).join('\n\n'),
        error: { message: err.message ?? String(e), line: i + 1, col: text.indexOf(text.trim()) + 1, hint: err.hint },
        status: `Invalid address · line ${i + 1}`,
      };
    }
  }
  const output = ctx.pretty ? items.map(itemText).join('\n\n') : JSON.stringify(items, null, 2);
  const v4 = items.filter((i) => i.version === 4).length;
  const v6 = items.length - v4;
  const data: SubnetData = { items };
  return {
    output,
    status: `${items.length} item${items.length === 1 ? '' : 's'}${v4 ? ` · ${v4} IPv4` : ''}${v6 ? ` · ${v6} IPv6` : ''}${split ? ` · split +${split}` : ''}`,
    view: { kind: 'subnet', data },
  };
}

export const ipSubnetMode: ToolMode = {
  id: 'ip-subnet',
  label: 'IP / Subnet Calculator',
  description: 'Network, broadcast, mask, host range, address type and reverse DNS for IPv4 and IPv6 addresses, CIDR blocks and ranges.',
  category: 'Developer',
  icon: 'network',
  keywords: ['ip', 'ipv4', 'ipv6', 'cidr', 'subnet', 'netmask', 'network', 'broadcast', 'wildcard', 'range', 'rfc1918', 'arpa'],
  emptyHint: 'One per line: `10.1.2.0/24`, `192.168.1.10 255.255.255.0`, `2001:db8::/48`, a bare address, or a range `10.0.0.1-10.0.0.255`.',
  sample: '10.1.2.0/24\n192.168.1.10 255.255.255.0\n2001:db8:85a3::8a2e:370:7334/48\n10.0.0.1-10.0.0.255\n172.16.5.9/31\n8.8.8.8',
  supportsPretty: true,
  controls: [
    {
      kind: 'select',
      key: 'split',
      label: 'Split',
      default: 'none',
      options: [
        { value: 'none', label: 'none' },
        { value: '+1', label: '+1 bit (2 blocks)' },
        { value: '+2', label: '+2 bits (4)' },
        { value: '+3', label: '+3 bits (8)' },
        { value: '+4', label: '+4 bits (16)' },
      ],
    },
  ],
  run: runIpSubnet,
};
