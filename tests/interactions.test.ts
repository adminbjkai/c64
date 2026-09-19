import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearestEdge, tableFromJson, parseJsonOutput } from '../src/pane-interactions.js';
import { arrangeCommands } from '../src/palette.js';

const rect = { left: 100, top: 50, width: 800, height: 400 };

test('nearestEdge: inside an edge band that edge wins', () => {
  assert.equal(nearestEdge(rect, 110, 250), 'left');
  assert.equal(nearestEdge(rect, 890, 250), 'right');
  assert.equal(nearestEdge(rect, 500, 60), 'top');
  assert.equal(nearestEdge(rect, 500, 440), 'bottom');
});

test('nearestEdge: in a corner the nearer edge by pixels wins', () => {
  assert.equal(nearestEdge(rect, 105, 70), 'left'); // 5px vs 20px
  assert.equal(nearestEdge(rect, 130, 55), 'top'); // 30px vs 5px
  assert.equal(nearestEdge(rect, 880, 445), 'bottom'); // 20px vs 5px
});

test('nearestEdge: the centre region (25% inset) compares normalised distances', () => {
  // Dead centre of a wide pane: 400px to left/right vs 200px to top/bottom,
  // normalised both 0.5 → left (first candidate) rather than always "top".
  assert.equal(nearestEdge(rect, 500, 250), 'left');
  // Slightly right of centre → right; slightly below → bottom.
  assert.equal(nearestEdge(rect, 560, 250), 'right');
  assert.equal(nearestEdge(rect, 500, 280), 'bottom');
  // 300px from the left (37.5%) and 120px from the top (30%): both outside
  // the band; normalised 0.75 vs 0.6 → top.
  assert.equal(nearestEdge(rect, 400, 170), 'top');
});

test('nearestEdge: works on rects not at the origin and on tall panes', () => {
  const tall = { left: 0, top: 0, width: 200, height: 1000 };
  assert.equal(nearestEdge(tall, 100, 500), 'left');
  assert.equal(nearestEdge(tall, 150, 500), 'right');
  assert.equal(nearestEdge(tall, 100, 100), 'top');
});

test('tableFromJson: array of objects → columns are the union of keys in first-seen order', () => {
  const t = tableFromJson([{ a: 1, b: 'x' }, { b: 'y', c: null }]);
  assert.ok(t);
  assert.deepEqual(t.header, ['a', 'b', 'c']);
  assert.deepEqual(t.rows, [['1', 'x', ''], ['', 'y', 'null']]);
  assert.equal(t.total, 2);
});

test('tableFromJson: object → key / value rows; scalars and mixed arrays → null', () => {
  const t = tableFromJson({ name: 'c64', tags: ['a', 'b'] });
  assert.deepEqual(t?.header, ['key', 'value']);
  assert.deepEqual(t?.rows, [['name', 'c64'], ['tags', '["a","b"]']]);
  assert.equal(tableFromJson([1, 2, 3]), null);
  assert.equal(tableFromJson([{ a: 1 }, 2]), null);
  assert.equal(tableFromJson([]), null);
  assert.equal(tableFromJson('text'), null);
  assert.equal(tableFromJson(null), null);
});

test('parseJsonOutput: JSON parses, anything else is undefined', () => {
  assert.deepEqual(parseJsonOutput('{"a":1}'), { value: { a: 1 } });
  assert.deepEqual(parseJsonOutput(' 42 '), { value: 42 });
  assert.equal(parseJsonOutput(''), undefined);
  assert.equal(parseJsonOutput('<xml/>'), undefined);
});

test('palette: rows are grouped after ranking so headers print once and the best match leads', () => {
  const rows = [
    { id: 'ws:1', group: 'Workspace' },
    { id: 'mode:json', group: 'Switch tool' },
    { id: 'board:x', group: 'Boards' },
    { id: 'mode:jwt', group: 'Favourite tools' },
    { id: 'pane:1', group: 'Pane' },
    { id: 'mode:xml', group: 'Switch tool' },
    { id: 'focus:1', group: 'Go to pane' },
    { id: 'mode:yaml', group: 'Favourite tools' },
  ];
  const groups = arrangeCommands(rows, 'j', []).map((r) => r.group);
  // Groups are ordered by their best-ranked member (the top match stays first); members stay grouped.
  assert.equal(groups[0], rows[0]!.group);
  assert.deepEqual([...new Set(groups)], ['Switch tool', 'Workspace', 'Boards', 'Favourite tools', 'Pane', 'Go to pane'].filter((g) => groups.includes(g)).sort((a, b) => groups.indexOf(a) - groups.indexOf(b)));
  // Ranking order is preserved inside a group (stable sort).
  assert.deepEqual(arrangeCommands(rows, 'j', []).filter((r) => r.group === 'Switch tool').map((r) => r.c.id), ['mode:json', 'mode:xml']);
  // Headers are unique.
  assert.equal(new Set(groups).size, [...groups].filter((g, i) => groups[i - 1] !== g).length);
});

test('palette: with no query the first five recent commands form one Recent section at the top', () => {
  const rows = [
    { id: 'r1', group: 'Workspace' },
    { id: 'r2', group: 'Boards' },
    { id: 'mode:a', group: 'Switch tool' },
    { id: 'mode:b', group: 'Favourite tools' },
  ];
  const out = arrangeCommands(rows, '', ['r1', 'r2']);
  assert.deepEqual(out.map((r) => r.group), ['Recent', 'Recent', 'Favourite tools', 'Switch tool']);
  assert.deepEqual(out.map((r) => r.c.id), ['r1', 'r2', 'mode:b', 'mode:a']);
});
