import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLorem, loremMode, generateLorem } from '../src/modes/lorem.js';
import { Rng, LOREM_WORDS, FIRST_NAMES, LAST_NAMES, CITIES } from '../src/lib/lorem.js';

const ctx = (options: Record<string, unknown> = {}, pretty = true) => ({ pretty, options });

test('word lists have the promised sizes', () => {
  assert.ok(LOREM_WORDS.length >= 120, `lorem vocabulary ${LOREM_WORDS.length}`);
  assert.equal(new Set(LOREM_WORDS).size, LOREM_WORDS.length);
  assert.equal(FIRST_NAMES.length, 40);
  assert.equal(LAST_NAMES.length, 40);
  assert.equal(CITIES.length, 30);
});

test('a seed makes the output deterministic; different seeds differ', () => {
  const a = runLorem('', ctx({ seed: 'c64' }));
  const b = runLorem('', ctx({ seed: 'c64' }));
  const c = runLorem('', ctx({ seed: 'other' }));
  assert.equal(a.output, b.output);
  assert.notEqual(a.output, c.output);
  assert.deepEqual(a.notes, ['Seeded with "c64" — deterministic.']);
  const rng1 = new Rng('x');
  const rng2 = new Rng('x');
  assert.equal(rng1.next(), rng2.next());
  assert.ok(new Rng('').next() >= 0);
});

test('non-empty input is used as the seed; the sample runs', () => {
  const fromInput = runLorem('c64', ctx());
  const fromSeed = runLorem('', ctx({ seed: 'c64' }));
  assert.equal(fromInput.output, fromSeed.output);
  assert.deepEqual(fromInput.notes, ['Seeded from the input text — same input, same output.']);
  const s = runLorem(loremMode.sample, ctx(loremMode.sampleOptions));
  assert.equal(s.error, undefined);
  assert.ok(s.output.length > 100);
});

test('empty input with no seed generates random but well-formed text and a note', () => {
  const r = runLorem('', ctx());
  assert.ok(r.output.startsWith('Lorem ipsum dolor sit amet, consectetur adipiscing elit'));
  assert.equal(r.output.split('\n\n').length, 3);
  assert.match(r.notes![0]!, /^Random seed [0-9a-f]{8} — set a seed/);
  assert.match(r.status!, /^Generated 3 paragraphs · \d+ words/);
});

test('count control and every kind produce the right number of items', () => {
  for (const count of [1, 5, 10, 25, 50]) {
    assert.equal(runLorem('', ctx({ kind: 'paragraphs', count: String(count), seed: 's' })).output.split('\n\n').length, count);
    assert.equal(runLorem('', ctx({ kind: 'names', count: String(count), seed: 's' })).output.split('\n').length, count);
    assert.equal(runLorem('', ctx({ kind: 'emails', count: String(count), seed: 's' })).output.split('\n').length, count);
    assert.equal(runLorem('', ctx({ kind: 'addresses', count: String(count), seed: 's' })).output.split('\n').length, count);
    assert.equal(runLorem('', ctx({ kind: 'title', count: String(count), seed: 's' })).output.split('\n').length, count);
    assert.equal(runLorem('', ctx({ kind: 'words', count: String(count), seed: 's', startLorem: false })).output.split(' ').length, count);
    assert.equal(runLorem('', ctx({ kind: 'sentences', count: String(count), seed: 's', startLorem: false })).output.split(/\.\s|\.$/).filter(Boolean).length, count);
  }
  // Unknown values fall back to defaults.
  const fallback = runLorem('', ctx({ kind: 'nope', count: '7', seed: 's' }));
  assert.equal(fallback.output.split('\n\n').length, 3);
});

test('startLorem toggle controls the opening phrase', () => {
  const on = runLorem('', ctx({ kind: 'paragraphs', seed: 'z', startLorem: true }));
  const off = runLorem('', ctx({ kind: 'paragraphs', seed: 'z', startLorem: false }));
  assert.ok(on.output.startsWith('Lorem ipsum dolor sit amet, consectetur adipiscing elit, '));
  assert.ok(!off.output.startsWith('Lorem ipsum dolor sit amet, consectetur'));
  assert.equal(runLorem('', ctx({ kind: 'words', count: '5', seed: 'z' })).output, 'Lorem ipsum dolor sit amet');
  assert.match(runLorem('', ctx({ kind: 'words', count: '10', seed: 'z' })).output, /^Lorem ipsum dolor sit amet consectetur adipiscing elit \S+ \S+$/);
  assert.match(runLorem('', ctx({ kind: 'sentences', count: '1', seed: 'z' })).output, /^Lorem ipsum dolor sit amet, consectetur adipiscing elit, [a-z ]+\.$/);
});

test('sentences and paragraphs are capitalised and end with a period', () => {
  const r = runLorem('', ctx({ kind: 'sentences', count: '10', seed: 'q', startLorem: false }));
  for (const s of r.output.split('. ')) {
    assert.match(s, /^[A-Z]/);
    for (const w of s.replace(/[.,]/g, '').toLowerCase().split(' ')) assert.ok(LOREM_WORDS.includes(w), w);
  }
  assert.ok(r.output.endsWith('.'));
});

test('names, emails and addresses come from the word lists', () => {
  const names = runLorem('', ctx({ kind: 'names', count: '10', seed: 'n' })).output.split('\n');
  for (const n of names) {
    const [f, l] = n.split(' ');
    assert.ok(FIRST_NAMES.includes(f!), n);
    assert.ok(LAST_NAMES.includes(l!), n);
  }
  const emails = runLorem('', ctx({ kind: 'emails', count: '10', seed: 'n' })).output.split('\n');
  for (const e of emails) assert.match(e, /^[a-z0-9.]+@(example\.(com|org|net)|mail\.test|demo\.dev)$/);
  const addrs = runLorem('', ctx({ kind: 'addresses', count: '5', seed: 'n' })).output.split('\n');
  for (const a of addrs) assert.match(a, /^\d{1,4} [A-Z][a-z]+ (St|Ave|Rd|Ln|Blvd|Way|Dr), .+ \d{5}$/);
});

test('json-records emit valid JSON objects with the documented shape', () => {
  const r = runLorem('', ctx({ kind: 'json-records', count: '5', seed: 'j' }));
  const arr = JSON.parse(r.output) as Record<string, unknown>[];
  assert.equal(arr.length, 5);
  arr.forEach((rec, i) => {
    assert.deepEqual(Object.keys(rec), ['id', 'name', 'email', 'city', 'createdAt', 'active', 'score']);
    assert.equal(rec['id'], i + 1);
    assert.equal(typeof rec['name'], 'string');
    assert.match(rec['email'] as string, /@/);
    assert.ok(CITIES.includes(rec['city'] as string));
    assert.match(rec['createdAt'] as string, /^202[0-5]-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/);
    assert.equal(typeof rec['active'], 'boolean');
    assert.ok(typeof rec['score'] === 'number' && rec['score'] >= 0 && rec['score'] <= 100);
  });
  assert.match(r.output, /^\[\n {2}\{\n {4}"id": 1,/);
  const raw = runLorem('', ctx({ kind: 'json-records', count: '5', seed: 'j' }, false));
  assert.ok(!raw.output.includes('\n'));
  assert.deepEqual(JSON.parse(raw.output), arr);
  assert.match(r.status!, /^Generated 5 records/);
  assert.equal(generateLorem('json-records', 1, 'j', true).split('\n').length, 11);
});
