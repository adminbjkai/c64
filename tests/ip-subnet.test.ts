import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIPv4, parseIPv6, formatIPv4, expandIPv6, compressIPv6, subnetOf, rangeToCidrs, prefixFromNetmask, classifyIp, ipv4Class, reverseDns, binaryIPv4, splitSubnet, formatIp } from '../src/lib/ip.js';
import { runIpSubnet, ipSubnetMode, type SubnetData, type SubnetNetItem, type SubnetRangeItem } from '../src/modes/ip-subnet.js';

const ctx = (options: Record<string, unknown> = {}, pretty = true) => ({ pretty, options });
const rows = (it: SubnetNetItem): Record<string, string> => Object.fromEntries(it.rows.map((r) => [r.label, r.value]));
const first = (input: string, options: Record<string, unknown> = {}): SubnetNetItem => {
  const r = runIpSubnet(input, ctx(options));
  assert.equal(r.error, undefined, r.error?.message);
  return (r.view!.data as SubnetData).items[0] as SubnetNetItem;
};

test('empty input is empty', () => {
  assert.deepEqual(runIpSubnet('', ctx()), { output: '', status: '' });
});

test('sample runs; pretty is text, raw is JSON', () => {
  const p = runIpSubnet(ipSubnetMode.sample, ctx());
  assert.equal(p.error, undefined);
  assert.match(p.output, /network\s+10\.1\.2\.0\/24/);
  assert.equal(p.status, '6 items · 5 IPv4 · 1 IPv6');
  const raw = runIpSubnet(ipSubnetMode.sample, ctx({}, false));
  const parsed = JSON.parse(raw.output) as unknown[];
  assert.equal(parsed.length, 6);
  assert.equal(p.view?.kind, 'subnet');
});

test('IPv4 CIDR: network, broadcast, mask, wildcard, hosts, reverse DNS, binary', () => {
  const it = first('10.1.2.77/24');
  const r = rows(it);
  assert.equal(it.cidr, '10.1.2.0/24');
  assert.equal(r['network'], '10.1.2.0/24');
  assert.equal(r['broadcast'], '10.1.2.255');
  assert.equal(r['netmask'], '255.255.255.0');
  assert.equal(r['wildcard'], '0.0.0.255');
  assert.equal(r['first host'], '10.1.2.1');
  assert.equal(r['last host'], '10.1.2.254');
  assert.equal(r['usable hosts'], '254');
  assert.equal(r['reverse DNS'], '77.2.1.10.in-addr.arpa');
  assert.equal(r['binary'], '00001010.00000001.00000010.01001101');
  assert.equal(r['hex'], '0x0a01024d');
  assert.equal(r['integer'], String(10 * 2 ** 24 + 1 * 2 ** 16 + 2 * 256 + 77));
});

test('IPv4 classification covers RFC 1918, loopback, link-local, multicast, CGNAT, documentation, public', () => {
  const c = (s: string) => classifyIp(parseIPv4(s), 4);
  assert.match(c('10.0.0.1'), /private/);
  assert.match(c('172.16.0.1'), /private/);
  assert.match(c('172.31.255.255'), /private/);
  assert.match(c('172.32.0.1'), /public/);
  assert.match(c('192.168.1.1'), /private/);
  assert.match(c('127.0.0.1'), /loopback/);
  assert.match(c('169.254.10.10'), /link-local/);
  assert.match(c('224.0.0.1'), /multicast/);
  assert.match(c('100.64.1.1'), /CGNAT/);
  assert.match(c('192.0.2.5'), /documentation/);
  assert.match(c('198.51.100.5'), /documentation/);
  assert.match(c('203.0.113.5'), /documentation/);
  assert.match(c('255.255.255.255'), /broadcast/);
  assert.match(c('240.0.0.1'), /reserved/);
  assert.match(c('8.8.8.8'), /public/);
  assert.equal(ipv4Class(parseIPv4('8.8.8.8')), 'A');
  assert.equal(ipv4Class(parseIPv4('172.16.0.1')), 'B');
  assert.equal(ipv4Class(parseIPv4('192.168.0.1')), 'C');
  assert.match(ipv4Class(parseIPv4('224.0.0.1')), /^D/);
});

test('/31 has two usable hosts and no broadcast; /32 is a single host', () => {
  const a = rows(first('172.16.5.9/31'));
  assert.equal(a['network'], '172.16.5.8/31');
  assert.equal(a['first host'], '172.16.5.8');
  assert.equal(a['last host'], '172.16.5.9');
  assert.equal(a['usable hosts'], '2');
  assert.match(a['broadcast']!, /none/);
  const b = rows(first('8.8.8.8'));
  assert.equal(b['prefix'], '/32');
  assert.equal(b['usable hosts'], '1');
  assert.equal(b['first host'], '8.8.8.8');
  assert.equal(b['netmask'], '255.255.255.255');
  const c = rows(first('10.0.0.0/30'));
  assert.equal(c['usable hosts'], '2');
  assert.equal(c['first host'], '10.0.0.1');
  assert.equal(c['broadcast'], '10.0.0.3');
});

test('/0 and /8 extremes', () => {
  const z = subnetOf(parseIPv4('1.2.3.4'), 0, 4);
  assert.equal(formatIPv4(z.netmask), '0.0.0.0');
  assert.equal(z.hosts, 4294967294n);
  const eight = rows(first('10.200.3.4/8'));
  assert.equal(eight['network'], '10.0.0.0/8');
  assert.equal(eight['usable hosts'], '16,777,214');
});

test('address with dotted netmask', () => {
  const it = first('192.168.1.10 255.255.255.0');
  assert.equal(it.cidr, '192.168.1.0/24');
  assert.equal(rows(it)['address'], '192.168.1.10');
  assert.equal(prefixFromNetmask('255.255.255.128'), 25);
  assert.equal(prefixFromNetmask('255.255.0.0'), 16);
  assert.equal(prefixFromNetmask('0.0.0.0'), 0);
  assert.equal(prefixFromNetmask('255.255.255.255'), 32);
  assert.throws(() => prefixFromNetmask('255.0.255.0'), /not a contiguous netmask/);
  const r = runIpSubnet('192.168.1.10 255.0.255.0', ctx());
  assert.equal(r.error?.line, 1);
  assert.match(r.error!.hint!, /run of 1-bits/);
});

test('IPv6 compression and expansion (RFC 5952)', () => {
  const v = parseIPv6('2001:0db8:0000:0000:0000:ff00:0042:8329');
  assert.equal(compressIPv6(v), '2001:db8::ff00:42:8329');
  assert.equal(expandIPv6(v), '2001:0db8:0000:0000:0000:ff00:0042:8329');
  assert.equal(compressIPv6(parseIPv6('::1')), '::1');
  assert.equal(compressIPv6(parseIPv6('::')), '::');
  assert.equal(expandIPv6(parseIPv6('::')), '0000:0000:0000:0000:0000:0000:0000:0000');
  // Longest zero run wins; ties go to the first; single zero groups are not compressed.
  assert.equal(compressIPv6(parseIPv6('1:0:0:1:0:0:0:1')), '1:0:0:1::1');
  assert.equal(compressIPv6(parseIPv6('1:0:0:1:0:0:1:1')), '1::1:0:0:1:1');
  assert.equal(compressIPv6(parseIPv6('1:0:2:3:4:5:6:7')), '1:0:2:3:4:5:6:7');
  assert.equal(compressIPv6(parseIPv6('FE80::ABCD')), 'fe80::abcd');
  // Embedded IPv4.
  assert.equal(expandIPv6(parseIPv6('::ffff:192.168.1.1')), '0000:0000:0000:0000:0000:ffff:c0a8:0101');
});

test('IPv6 CIDR: network, mask, hosts, type, reverse DNS', () => {
  const it = first('2001:db8:85a3::8a2e:370:7334/48');
  const r = rows(it);
  assert.equal(it.version, 6);
  assert.equal(it.cidr, '2001:db8:85a3::/48');
  assert.equal(r['expanded'], '2001:0db8:85a3:0000:0000:8a2e:0370:7334');
  assert.equal(r['netmask'], 'ffff:ffff:ffff::');
  assert.equal(r['last address'], '2001:db8:85a3:ffff:ffff:ffff:ffff:ffff');
  assert.equal(r['usable hosts'], (2n ** 80n - 1n).toLocaleString('en-US'));
  assert.equal(r['type'], 'documentation');
  assert.equal(r['reverse DNS'], '4.3.3.7.0.7.3.0.e.2.a.8.0.0.0.0.0.0.0.0.3.a.5.8.8.b.d.0.1.0.0.2.ip6.arpa');
  assert.equal(it.splitChoices.length, 0, 'no split select for IPv6');
  const s = subnetOf(parseIPv6('2001:db8::1'), 64, 6);
  assert.equal(formatIp(s.firstHost, 6), '2001:db8::1');
  assert.equal(subnetOf(parseIPv6('2001:db8::1'), 128, 6).hosts, 1n);
  assert.equal(subnetOf(parseIPv6('2001:db8::1'), 127, 6).hosts, 2n);
});

test('IPv6 classification', () => {
  const c = (s: string) => classifyIp(parseIPv6(s), 6);
  assert.equal(c('::1'), 'loopback');
  assert.equal(c('::'), 'unspecified');
  assert.match(c('fd12:3456::1'), /unique local/);
  assert.match(c('fe80::1'), /link-local/);
  assert.equal(c('ff02::1'), 'multicast');
  assert.equal(c('::ffff:1.2.3.4'), 'IPv4-mapped');
  assert.equal(c('2002:0102:0304::1'), '6to4');
  assert.equal(c('2a00:1450:4001::8a'), 'global unicast');
  assert.equal(reverseDns(parseIPv6('::1'), 6), '1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.ip6.arpa');
});

test('IPv4 range → minimal CIDR list', () => {
  const list = (a: string, b: string) => rangeToCidrs(parseIPv4(a), parseIPv4(b), 4).map((c) => `${formatIPv4(c.network)}/${c.prefix}`);
  assert.deepEqual(list('10.0.0.1', '10.0.0.255'), ['10.0.0.1/32', '10.0.0.2/31', '10.0.0.4/30', '10.0.0.8/29', '10.0.0.16/28', '10.0.0.32/27', '10.0.0.64/26', '10.0.0.128/25']);
  assert.deepEqual(list('10.0.0.0', '10.0.0.255'), ['10.0.0.0/24']);
  assert.deepEqual(list('10.0.0.0', '10.0.1.255'), ['10.0.0.0/23']);
  assert.deepEqual(list('192.168.0.0', '192.168.2.255'), ['192.168.0.0/23', '192.168.2.0/24']);
  assert.deepEqual(list('1.1.1.1', '1.1.1.1'), ['1.1.1.1/32']);
  assert.deepEqual(list('0.0.0.0', '255.255.255.255'), ['0.0.0.0/0']);
  const r = runIpSubnet('10.0.0.1 - 10.0.0.6', ctx());
  const it = (r.view!.data as SubnetData).items[0] as SubnetRangeItem;
  assert.equal(it.kind, 'range');
  assert.equal(it.count, '6');
  assert.deepEqual(it.cidrs, ['10.0.0.1/32', '10.0.0.2/31', '10.0.0.4/31', '10.0.0.6/32']);
  assert.match(r.output, /6 addresses/);
});

test('split option lists sub-blocks and is offered for IPv4 only', () => {
  const it = first('10.1.2.0/24', { split: '+2' });
  assert.equal(it.splitPrefix, 26);
  assert.deepEqual(it.splits.map((s) => s.cidr), ['10.1.2.0/26', '10.1.2.64/26', '10.1.2.128/26', '10.1.2.192/26']);
  assert.equal(it.splits[1]!.first, '10.1.2.65');
  assert.equal(it.splits[1]!.last, '10.1.2.126');
  assert.deepEqual(it.splitChoices, [1, 2, 3, 4]);
  const none = first('10.1.2.0/24', { split: 'none' });
  assert.equal(none.splitPrefix, null);
  assert.equal(none.splits.length, 0);
  // /30 can only be split by 1 or 2 bits.
  assert.deepEqual(first('10.1.2.0/30').splitChoices, [1, 2]);
  assert.deepEqual(first('10.1.2.0/32').splitChoices, []);
  assert.equal(splitSubnet(subnetOf(0n, 0, 4), 4).length, 16);
  assert.equal(splitSubnet(subnetOf(0n, 0, 4), 10, 64).length, 64, 'capped');
  assert.match(runIpSubnet('10.1.2.0/24', ctx({ split: '+1' })).output, /split into \/25:/);
});

test('bad input errors carry the line and a hint', () => {
  const a = runIpSubnet('10.1.2.0/24\n300.1.1.1', ctx());
  assert.equal(a.error?.line, 2);
  assert.match(a.error!.message, /octet "300"/);
  assert.match(a.error!.hint!, /0 and 255/);
  assert.match(a.output, /10\.1\.2\.0\/24/, 'earlier items are kept');
  const b = runIpSubnet('10.1.2.0/33', ctx());
  assert.match(b.error!.message, /out of range/);
  const c = runIpSubnet('2001:db8:::1', ctx());
  assert.match(c.error!.message, /more than one "::"/);
  const d = runIpSubnet('2001:db8::1%eth0', ctx());
  assert.match(d.error!.message, /zone id/);
  const e = runIpSubnet('10.0.0.9-10.0.0.1', ctx());
  assert.match(e.error!.message, /after end/);
  const f = runIpSubnet('hello', ctx());
  assert.equal(f.error?.line, 1);
  assert.match(f.error!.hint!, /four decimal numbers/);
  const g = runIpSubnet('1:2:3:4:5:6:7', ctx());
  assert.match(g.error!.message, /7 groups/);
  const h = runIpSubnet('10.0.0.1/abc', ctx());
  assert.match(h.error!.message, /Bad prefix length/);
});

test('blank and # comment lines are skipped', () => {
  const r = runIpSubnet('# corp\n\n10.0.0.0/8\n\n', ctx());
  assert.equal((r.view!.data as SubnetData).items.length, 1);
  assert.equal(r.status, '1 item · 1 IPv4');
});

test('binary and integer helpers', () => {
  assert.equal(binaryIPv4(parseIPv4('255.0.128.1')), '11111111.00000000.10000000.00000001');
  assert.equal(parseIPv4('255.255.255.255'), 4294967295n);
  assert.equal(formatIPv4(0n), '0.0.0.0');
});
