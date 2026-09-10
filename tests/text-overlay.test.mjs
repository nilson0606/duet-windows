import test from 'node:test';
import assert from 'node:assert/strict';
import { drawComposition } from '../lib/media.ts';
import { textLayout } from '../lib/text-overlay.ts';
const layer = {
  id: 'title',
  text: '合拍 DUET\n第二行',
  x: 0.1,
  y: 0.2,
  size: 0.06,
  color: '#ff00ff',
};
function canvas() {
  const calls = [];
  const ctx = {
    font: '',
    save() {
      calls.push(['save']);
    },
    restore() {
      calls.push(['restore']);
    },
    measureText(text) {
      return {
        width: [...text].length * Number(this.font.match(/[\d.]+/)[0]) * 0.6,
      };
    },
    fillRect(...v) {
      calls.push(['background', ...v]);
    },
    drawImage(...v) {
      calls.push(['video', ...v]);
    },
    strokeText(...v) {
      calls.push(['stroke', ...v]);
    },
    fillText(...v) {
      calls.push(['text', ...v, this.fillStyle]);
    },
  };
  return { ctx, calls };
}
test('text stays above opaque black tails and preserves multilines and layer order', () => {
  const { ctx, calls } = canvas();
  drawComposition(
    ctx,
    [],
    [{ x: 0, y: 0, width: 1, height: 1 }],
    1280,
    720,
    10,
    [5],
    [0],
    [layer, { ...layer, id: 'top', text: '上層' }],
  );
  assert.equal(calls[1][0], 'background');
  assert.deepEqual(
    calls.filter((c) => c[0] === 'text').map((c) => c[1]),
    ['合拍 DUET', '第二行', '上層'],
  );
  assert.equal(calls.at(-1)[0], 'restore');
  const text = calls.filter((c) => c[0] === 'text');
  assert.equal(text[0].at(-1), '#ff00ff');
  assert.ok(text[1][3] > text[0][3]);
});
test('720p and 1080p keep the same relative font size and normalized origin', () => {
  const a = canvas(),
    b = canvas();
  const small = textLayout(a.ctx, layer, 1280, 720),
    large = textLayout(b.ctx, layer, 1920, 1080);
  assert.equal(large.fontSize / small.fontSize, 1.5);
  drawComposition(a.ctx, [], [], 1280, 720, 0, [], [], [layer]);
  drawComposition(b.ctx, [], [], 1920, 1080, 0, [], [], [layer]);
  const ta = a.calls.find((c) => c[0] === 'text'),
    tb = b.calls.find((c) => c[0] === 'text');
  assert.ok(
    Math.abs((ta[2] - small.padding) / 1280 - (tb[2] - large.padding) / 1920) <
      1e-9,
  );
  assert.ok(
    Math.abs(
      (ta[3] - small.padding - small.fontSize) / 720 -
        (tb[3] - large.padding - large.fontSize) / 1080,
    ) < 1e-9,
  );
});
