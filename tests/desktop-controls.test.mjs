import test from 'node:test';
import assert from 'node:assert/strict';
import { keyboardMove } from '../lib/desktop-controls.ts';

const box = { x: 0.2, y: 0.3, width: 0.4, height: 0.4 };
test('desktop arrows move one output pixel in landscape, portrait and square', () => {
  for (const [w, h] of [
    [1280, 720],
    [720, 1280],
    [720, 720],
    [854, 480],
  ]) {
    const right = keyboardMove(box, 'ArrowRight', false, w, h);
    const up = keyboardMove(box, 'ArrowUp', false, w, h);
    assert.ok(Math.abs((right.x - box.x) * w - 1) < 1e-9);
    assert.ok(Math.abs((up.y - box.y) * h + 1) < 1e-9);
    assert.equal(right.width, box.width);
    assert.equal(up.height, box.height);
    assert.deepEqual(keyboardMove(box, 'Tab', false, w, h), null);
  }
});
test('Shift moves ten pixels and off-canvas content remains reachable', () => {
  const next = keyboardMove(box, 'ArrowDown', true, 1280, 720);
  assert.ok(Math.abs((next.y - box.y) * 720 - 10) < 1e-9);
  assert.equal(
    keyboardMove({ ...box, x: 0.97 }, 'ArrowRight', true, 1280, 720).x,
    0.97,
  );
  const left = keyboardMove({ ...box, x: -0.37 }, 'ArrowLeft', true, 1280, 720);
  assert.ok(Math.abs(left.x + left.width - 0.03) < 1e-9);
  assert.equal(keyboardMove(box, 'ArrowRight', false, 0, 720), null);
});
