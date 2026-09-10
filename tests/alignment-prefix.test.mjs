import assert from 'node:assert/strict';
import test from 'node:test';
import { alignFeatures, FEATURE_RATE } from '../lib/alignment.mjs';

function noise(seconds, seed) {
  return Array.from({ length: 6 }, () =>
    Float32Array.from({ length: seconds * FEATURE_RATE }, () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2147483648 - 1;
    }),
  );
}
function copyMatch(a, b, startA, startB, length) {
  for (let band = 0; band < a.length; band++)
    b[band].set(a[band].subarray(startA, startA + length), startB);
}

test('five matching opening seconds succeed despite long unrelated tails, in both directions', () => {
  const a = noise(180, 11),
    b = noise(170, 22);
  copyMatch(a, b, 117, 0, 250);
  for (const [x, y, offset] of [
    [a, b, 2.34],
    [b, a, -2.34],
  ]) {
    const result = alignFeatures(x, y, 5);
    assert.equal(result.offset, offset);
    assert.ok(result.confident, JSON.stringify(result));
    assert.ok(result.score > 0.999, JSON.stringify(result));
  }
});

test('matching opening survives a silent tail', () => {
  const a = noise(30, 33),
    b = a.map((band) => band.slice());
  for (const band of b) band.fill(0, 250);
  const result = alignFeatures(a, b);
  assert.equal(result.offset, 0);
  assert.ok(result.confident, JSON.stringify(result));
});

test('whole-track search accepts a clear later match even when the opening differs', () => {
  const a = noise(60, 44),
    b = noise(60, 55);
  copyMatch(a, b, 500, 500, 2500);
  const result = alignFeatures(a, b);
  assert.equal(result.confident, true);
  assert.equal(result.offset, 0);
});

test('repeated opening with competing offsets remains uncertain', () => {
  const a = noise(30, 66),
    b = noise(20, 77);
  copyMatch(b, a, 0, 100, 250);
  copyMatch(b, a, 0, 600, 250);
  assert.equal(alignFeatures(a, b).confident, false);
});

test('short clips can match with less than five seconds available', () => {
  const a = noise(4, 88),
    b = noise(3, 99);
  copyMatch(a, b, 50, 0, 150);
  const result = alignFeatures(a, b);
  assert.equal(result.offset, 1);
  assert.ok(result.confident, JSON.stringify(result));
});

for (const seconds of [1, 2, 3, 4, 5]) {
  test(`${seconds}-second option accepts only that matching opening, in both directions`, () => {
    const a = noise(60, 110),
      b = noise(55, 120);
    copyMatch(a, b, 117, 0, seconds * FEATURE_RATE);
    for (const [x, y, offset] of [
      [a, b, 2.34],
      [b, a, -2.34],
    ]) {
      const result = alignFeatures(x, y, seconds);
      assert.equal(result.offset, offset);
      assert.ok(result.confident, JSON.stringify(result));
      assert.ok(result.score > 0.999, JSON.stringify(result));
    }
  });
}

test('changing the option changes how much audio contributes to the score', () => {
  const a = noise(30, 130),
    b = noise(30, 140);
  copyMatch(a, b, 0, 0, 50);
  const short = alignFeatures(a, b, 1),
    long = alignFeatures(a, b, 5);
  assert.ok(short.confident);
  assert.ok(short.score > long.score + 0.5);
});

test('invalid match lengths are rejected', () => {
  const a = noise(3, 150);
  for (const seconds of [-1, 6, 1.5, NaN, Infinity, '2'])
    assert.throws(() => alignFeatures(a, a, seconds), /0 至 5/);
});

test('default zero finds a brief matching anchor without requiring one second', () => {
  const a = noise(60, 160),
    b = noise(55, 170);
  copyMatch(a, b, 117, 0, 15);
  for (const [x, y, offset] of [
    [a, b, 2.34],
    [b, a, -2.34],
  ]) {
    const result = alignFeatures(x, y);
    assert.equal(result.offset, offset);
    assert.ok(result.confident, JSON.stringify(result));
    assert.ok(result.score > 0.999, JSON.stringify(result));
    assert.deepEqual(result, alignFeatures(x, y, 0));
  }
});

test('zero mode rejects unrelated long recordings and silence', () => {
  assert.equal(
    alignFeatures(noise(180, 180), noise(175, 190)).confident,
    false,
  );
  const silence = Array.from({ length: 6 }, () => new Float32Array(500));
  assert.equal(alignFeatures(silence, silence, 0).confident, false);
});

test('whole-track search finds a two-second offset from a middle segment with different opening and tails', () => {
  const a = noise(90, 211),
    b = noise(85, 223);
  copyMatch(a, b, 22 * FEATURE_RATE, 20 * FEATURE_RATE, 10 * FEATURE_RATE);
  for (const seconds of [0, 1, 2, 3, 4, 5]) {
    for (const [x, y, expected] of [
      [a, b, 2],
      [b, a, -2],
    ]) {
      const result = alignFeatures(x, y, seconds);
      assert.equal(result.confident, true, JSON.stringify(result));
      assert.equal(result.offset, expected);
    }
  }
});
