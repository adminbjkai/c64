import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, countSentences, tokenizeWords, formatMinutes, formatStats, runTextStats, textStatsMode, STOP_WORDS, type TextStats } from '../src/modes/text-stats.js';

const ctx = (options: Record<string, unknown> = {}) => ({ pretty: false, options });

test('tokenizeWords keeps apostrophes and unicode, splits on punctuation', () => {
  assert.deepEqual(tokenizeWords("It's a well-known café, 42 times."), ["It's", 'a', 'well', 'known', 'café', '42', 'times']);
});

test('countSentences', () => {
  assert.equal(countSentences(''), 0);
  assert.equal(countSentences('One. Two! Three?'), 3);
  assert.equal(countSentences('No terminal punctuation'), 1);
  assert.equal(countSentences('Wait... what? ok'), 3);
  assert.equal(countSentences('v1.2 is out.'), 1);
});

test('computeStats: basic counts', () => {
  const s = computeStats('Hello world.\n\nHello again!');
  assert.equal(s.characters, 26);
  assert.equal(s.charactersNoSpaces, 22);
  assert.equal(s.bytes, 26);
  assert.equal(s.words, 4);
  assert.equal(s.uniqueWords, 3);
  assert.equal(s.sentences, 2);
  assert.equal(s.paragraphs, 2);
  assert.equal(s.lines, 3);
  assert.equal(s.avgWordLength, 5);
  assert.equal(s.avgSentenceLength, 2);
  assert.deepEqual(s.classes, { letters: 20, digits: 0, spaces: 4, punctuation: 2, other: 0 });
});

test('computeStats: bytes and character classes for multibyte text', () => {
  const s = computeStats('héllo 12 ☃');
  assert.equal(s.characters, 10);
  assert.equal(s.bytes, 13);
  assert.equal(s.classes.letters, 5);
  assert.equal(s.classes.digits, 2);
  assert.equal(s.classes.spaces, 2);
  assert.equal(s.classes.punctuation, 1); // ☃ is a symbol (\p{S})
});

test('top words: case-insensitive, stop words toggle, ties alphabetical', () => {
  const text = 'The cat and the Cat and THE dog';
  const on = computeStats(text, true);
  assert.deepEqual(on.topWords, [
    { word: 'cat', count: 2 },
    { word: 'dog', count: 1 },
  ]);
  const off = computeStats(text, false);
  assert.deepEqual(off.topWords[0], { word: 'the', count: 3 });
  assert.equal(off.topWords.length, 4);
  assert.ok(STOP_WORDS.has('the'));
});

test('top words capped at 10', () => {
  const s = computeStats(Array.from({ length: 15 }, (_, i) => `w${i}`).join(' '));
  assert.equal(s.topWords.length, 10);
});

test('reading and speaking time', () => {
  const s = computeStats(Array(400).fill('word').join(' '));
  assert.equal(s.readingMinutes, 2);
  assert.equal(formatMinutes(s.readingMinutes), '2 min');
  assert.equal(formatMinutes(s.speakingMinutes), '3 min 5 s');
  assert.equal(formatMinutes(0.25), '15 s');
});

test('formatStats: aligned key/value lines', () => {
  const out = formatStats(computeStats('a b'));
  const lines = out.split('\n');
  assert.equal(lines[0], 'Characters               3');
  assert.ok(lines.includes('Words                    2'));
  assert.ok(out.includes('Top words'));
  assert.ok(out.includes('Reading time (200 wpm)   1 s'));
});

test('runTextStats: empty, sample, view, control', () => {
  assert.deepEqual(runTextStats('', ctx()), { output: '', status: '' });
  const r = runTextStats(textStatsMode.sample, ctx());
  assert.equal(r.error, undefined);
  assert.equal(r.view?.kind, 'stats');
  const d = r.view?.data as TextStats;
  assert.equal(d.sentences, 5);
  assert.equal(d.paragraphs, 2);
  assert.equal(d.topWords[0]?.word, 'dog');
  assert.match(r.status ?? '', /^\d+ words · \d+ chars · 5 sentences · \d+ s read$/);
  const noStop = runTextStats(textStatsMode.sample, ctx({ ignoreStopWords: false }));
  assert.equal((noStop.view?.data as TextStats).topWords[0]?.word, 'the');
});

test('whitespace-only input still counts characters but no words', () => {
  const s = computeStats('   \n');
  assert.equal(s.words, 0);
  assert.equal(s.sentences, 0);
  assert.equal(s.paragraphs, 0);
  assert.equal(s.avgWordLength, 0);
  assert.deepEqual(s.topWords, []);
});
