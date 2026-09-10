import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fft, fingerprints, alignFeatures } from '../lib/alignment.mjs';
import { timeline, isClipActive } from '../lib/timeline.mjs';
import { drawComposition } from '../lib/media.ts';
const decode = (path) => {
  const bytes = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', '16000', '-'],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  return new Float32Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
};
const a = fingerprints(decode('public/demo/camera-a.mp4'), 16000),
  b = fingerprints(decode('public/demo/camera-b.mp4'), 16000);
test('AAC encoded videos with independent noise align within one video frame', () => {
  const r = alignFeatures(a, b);
  assert.ok(Math.abs(r.offset - 2.34) < 1 / 30, JSON.stringify(r));
  assert.ok(r.confident, JSON.stringify(r));
  console.log('Measured noisy AAC alignment:', r);
});
test('noisy AAC opening remains aligned when the rest is unrelated', () => {
  let seed = 123;
  const changed = b.map((band) => {
    const out = new Float32Array(50 * 120);
    out.set(band.subarray(0, 250));
    for (let i = 250; i < out.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      out[i] = (seed / 2147483648 - 1) * 4;
    }
    return out;
  });
  for (const [x, y, offset] of [
    [a, changed, 2.34],
    [changed, a, -2.34],
  ]) {
    const result = alignFeatures(x, y);
    assert.ok(
      Math.abs(result.offset - offset) < 1 / 30,
      JSON.stringify(result),
    );
    assert.ok(result.confident, JSON.stringify(result));
  }
});
test('reversing sources reverses the time offset', () => {
  const r = alignFeatures(b, a);
  assert.ok(Math.abs(r.offset + 2.34) < 1 / 30, JSON.stringify(r));
  assert.ok(r.confident);
});
test('identical clips align to zero', () => {
  const r = alignFeatures(a, a);
  assert.equal(r.offset, 0);
  assert.ok(r.confident);
});
test('silence is never confidently aligned', () => {
  const z = new Float32Array(16000 * 8);
  assert.equal(
    alignFeatures(fingerprints(z, 16000), fingerprints(z, 16000)).confident,
    false,
  );
});
test('unrelated random audio is not confidently aligned', () => {
  let seed = 321;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 4294967296) * 2 - 1;
  };
  const x = Float32Array.from({ length: 16000 * 15 }, rand),
    y = Float32Array.from({ length: 16000 * 17 }, rand);
  assert.equal(
    alignFeatures(fingerprints(x, 16000), fingerprints(y, 16000)).confident,
    false,
  );
});
test('keep all of longer tail and black the finished clip', () => {
  const p = timeline(22, 14, 2.34);
  assert.deepEqual(p.starts, [2.34, 0]);
  assert.equal(p.duration, 19.66);
  assert.equal(p.remaining[1], 14);
  assert.equal(isClipActive(14, p.remaining[1]), false);
  assert.equal(isClipActive(14, p.remaining[0]), true);
});
test('negative offsets trim B, and invalid offsets reject', () => {
  assert.deepEqual(timeline(14, 22, -2.34).starts, [0, 2.34]);
  assert.throws(() => timeline(10, 10, 10));
  assert.throws(() => timeline(10, 10, NaN));
  assert.throws(() => timeline(0, 10, 0));
});
test('compositor explicitly paints expired overlay black, preserving geometry', () => {
  const ops = [];
  const ctx = {
    fillStyle: '',
    fillRect: (...args) => ops.push(['black', ...args]),
    drawImage: (...args) => ops.push(['video', ...args]),
  };
  const clips = [{ video: 'A' }, { video: 'B' }],
    boxes = [
      { x: 0, y: 0, width: 1, height: 1 },
      { x: 0.6, y: 0.6, width: 0.3, height: 0.3 },
    ];
  drawComposition(ctx, clips, boxes, 1000, 1000, 15, [20, 14], [0, 1]);
  assert.deepEqual(ops, [
    ['black', 0, 0, 1000, 1000],
    ['video', 'A', 0, 0, 1000, 1000],
    ['black', 600, 600, 300, 300],
  ]);
});
test('both videos render before shorter source ends', () => {
  const ops = [];
  const ctx = {
    fillStyle: '',
    fillRect: () => {},
    drawImage: (v) => ops.push(v),
  };
  drawComposition(
    ctx,
    [{ video: 'A' }, { video: 'B' }],
    [
      { x: 0, y: 0, width: 0.5, height: 1 },
      { x: 0.5, y: 0, width: 0.5, height: 1 },
    ],
    1280,
    720,
    13.9,
    [19.66, 14],
    [1, 0],
  );
  assert.deepEqual(ops, ['B', 'A']);
});
test('FFT inverse preserves signal', () => {
  const r = Float64Array.from([1, 0, 3, -1, 0, 0, 0, 0]),
    i = new Float64Array(8);
  fft(r, i);
  fft(r, i, true);
  assert.ok(Math.abs(r[2] - 3) < 1e-9);
  assert.ok(Math.abs(r[3] + 1) < 1e-9);
});

test('startup silence must not replace the real music offset with a 60 ms mute-boundary match', () => {
  const samplesA = decode('public/demo/camera-a.mp4');
  const samplesB = decode('public/demo/camera-b.mp4');
  for (const [silentA, silentB] of [
    [0.18, 0.12],
    [0.04, 0.1],
    [0.3, 0.36],
  ]) {
    const x = samplesA.slice(),
      y = samplesB.slice();
    x.fill(0, 0, Math.round(silentA * 16000));
    y.fill(0, 0, Math.round(silentB * 16000));
    const fa = fingerprints(x, 16000),
      fb = fingerprints(y, 16000);
    for (const seconds of [0, 2, 3, 4, 5]) {
      for (const [a, b, expected] of [
        [fa, fb, 2.34],
        [fb, fa, -2.34],
      ]) {
        const result = alignFeatures(a, b, seconds);
        assert.ok(
          result.confident,
          JSON.stringify({ silentA, silentB, seconds, result }),
        );
        assert.ok(
          Math.abs(result.offset - expected) < 1 / 30,
          JSON.stringify({ silentA, silentB, seconds, result }),
        );
      }
    }
  }
});

test('unrelated audio after a common digital silence edge is never a confirmed match', () => {
  let seed = 778;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 2147483648 - 1) * 0.2;
  };
  const a = Float32Array.from({ length: 16000 * 12 }, random);
  const b = Float32Array.from({ length: 16000 * 12 }, random);
  a.fill(0, 0, 16000 * 0.18);
  b.fill(0, 0, 16000 * 0.12);
  const fa = fingerprints(a, 16000),
    fb = fingerprints(b, 16000);
  for (const seconds of [0, 1, 2, 3, 4, 5])
    assert.equal(alignFeatures(fa, fb, seconds).confident, false);
});

test('an exact two-second audio offset survives a 60 ms difference in startup silence', () => {
  const a = decode('public/demo/camera-a.mp4');
  const b = a.slice(2 * 16000);
  a.fill(0, 0, Math.round(0.18 * 16000));
  b.fill(0, 0, Math.round(0.12 * 16000));
  const result = alignFeatures(fingerprints(a, 16000), fingerprints(b, 16000));
  assert.equal(result.confident, true);
  assert.equal(result.offset, 2);
});

test('the same music still aligns with intermittent speech-like tones and claps over one recording', () => {
  const a = decode('public/demo/camera-a.mp4');
  const b = decode('public/demo/camera-b.mp4');
  let seed = 981;
  for (let i = 0; i < b.length; i++) {
    const t = i / 16000;
    if ((t > 0.7 && t < 2.5) || (t > 5 && t < 7)) {
      const syllable = Math.pow(Math.sin(2 * Math.PI * 3 * t), 2);
      b[i] +=
        0.15 *
        syllable *
        (Math.sin(2 * Math.PI * 190 * t) +
          0.5 * Math.sin(2 * Math.PI * 730 * t));
    }
    for (const clap of [0.12, 3.4, 8.1]) {
      const dt = t - clap;
      if (dt >= 0 && dt < 0.08) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        b[i] += 0.6 * Math.exp(-dt * 60) * (seed / 2147483648 - 1);
      }
    }
  }
  const fa = fingerprints(a, 16000),
    fb = fingerprints(b, 16000);
  for (const seconds of [0, 1, 2, 3, 4, 5]) {
    const result = alignFeatures(fa, fb, seconds);
    assert.ok(result.confident, JSON.stringify({ seconds, result }));
    assert.ok(
      Math.abs(result.offset - 2.34) < 1 / 30,
      JSON.stringify({ seconds, result }),
    );
  }
});
