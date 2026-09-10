import assert from 'node:assert/strict';
import test from 'node:test';
import { adjustCrop, cropImageStyle, FULL_CROP } from '../lib/crop.ts';
import { drawComposition } from '../lib/media.ts';

test('crop edges stay within the source and retain a nonempty region', () => {
  for (const edge of ['left', 'right', 'top', 'bottom', 'corner']) {
    for (const d of [-10, -0.3, 0, 0.3, 10]) {
      const c = adjustCrop(
        { x: 0.2, y: 0.1, width: 0.5, height: 0.7 },
        edge,
        d,
        d,
      );
      assert.ok(c.x >= 0 && c.y >= 0);
      assert.ok(c.width >= 0.05 - 1e-10 && c.height >= 0.05 - 1e-10);
      assert.ok(c.x + c.width <= 1 + 1e-10 && c.y + c.height <= 1 + 1e-10);
    }
  }
});
test('moving a crop preserves size and cannot leave the source', () => {
  const c = adjustCrop(
    { x: 0.1, y: 0.2, width: 0.4, height: 0.5 },
    'move',
    100,
    -100,
  );
  assert.deepEqual(c, { x: 0.6, y: 0, width: 0.4, height: 0.5 });
  assert.deepEqual(adjustCrop(FULL_CROP, 'move', 1, 1), FULL_CROP);
});
test('CSS viewport maps the same crop corners to the visible frame', () => {
  const c = { x: 0.25, y: 0.1, width: 0.5, height: 0.8 };
  const style = cropImageStyle(c);
  const w = parseFloat(style.width),
    h = parseFloat(style.height);
  const x = parseFloat(style.left),
    y = parseFloat(style.top);
  assert.equal(x + c.x * w, 0);
  assert.equal(y + c.y * h, 0);
  assert.equal(x + (c.x + c.width) * w, 100);
  assert.equal(y + (c.y + c.height) * h, 100);
});
test('compositor crops each source independently, places it, then blacks the whole ended region', () => {
  const ops = [];
  const ctx = {
    fillRect: (...a) => ops.push(['black', ...a]),
    drawImage: (...a) => ops.push(['video', ...a]),
  };
  const clips = [
    {
      video: 'A',
      width: 1000,
      height: 800,
      crop: { x: 0.2, y: 0.25, width: 0.5, height: 0.5 },
    },
    {
      video: 'B',
      width: 800,
      height: 1000,
      crop: { x: 0, y: 0.1, width: 1, height: 0.8 },
    },
  ];
  const boxes = [
    { x: 0.1, y: 0.2, width: 0.5, height: 0.4 },
    { x: 0.5, y: 0, width: 0.5, height: 1 },
  ];
  drawComposition(ctx, clips, boxes, 1000, 1000, 0, [10, 12], [1, 0]);
  assert.deepEqual(ops, [
    ['black', 0, 0, 1000, 1000],
    ['video', 'B', 0, 100, 800, 800, 500, 0, 500, 1000],
    ['video', 'A', 200, 200, 500, 400, 100, 200, 500, 400],
  ]);
  ops.length = 0;
  drawComposition(ctx, clips, boxes, 1000, 1000, 11, [10, 12], [1, 0]);
  assert.deepEqual(ops.at(-1), ['black', 100, 200, 500, 400]);
  clips[0].crop = FULL_CROP;
  ops.length = 0;
  drawComposition(ctx, clips, boxes, 1000, 1000, 0, [10, 12], [1, 0]);
  assert.deepEqual(ops.at(-1), [
    'video',
    'A',
    0,
    0,
    1000,
    800,
    100,
    200,
    500,
    400,
  ]);
});
