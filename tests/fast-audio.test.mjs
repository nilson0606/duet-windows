import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { decodeAudioTrack } from '../lib/decode-audio-track.ts';
import { tryFastAudio } from '../lib/fast-audio.ts';
import { fingerprints, alignFeatures } from '../lib/alignment.mjs';

function worker(action) {
  return {
    terminated: false,
    postMessage() {
      queueMicrotask(() => action(this));
    },
    terminate() {
      this.terminated = true;
    },
  };
}
const file = new File(['test'], 'iPhone.MOV');
for (const mode of [
  'unsupported',
  'error',
  'messageerror',
  'partial',
  'timeout',
]) {
  test(`fast ${mode} returns fallback and terminates the decoder`, async () => {
    const w = worker((w) => {
      if (mode === 'unsupported') w.onmessage({ data: { type: 'fallback' } });
      if (mode === 'error') w.onerror({ preventDefault() {} });
      if (mode === 'messageerror') w.onmessageerror({});
      if (mode === 'partial')
        w.onmessage({ data: { type: 'done', mono: new Float32Array(100) } });
    });
    const result = await tryFastAudio(
      file,
      3,
      new AbortController().signal,
      () => {},
      () => w,
      { idleMs: 10, totalMs: 50 },
    );
    assert.equal(result, null);
    assert.equal(w.terminated, true);
  });
}
test('worker construction failure uses fallback; prior cancellation never starts work', async () => {
  const abort = new AbortController();
  assert.equal(
    await tryFastAudio(
      file,
      3,
      abort.signal,
      () => {},
      () => {
        throw new Error('Unavailable');
      },
    ),
    null,
  );
  abort.abort();
  await assert.rejects(
    tryFastAudio(
      file,
      3,
      abort.signal,
      () => {},
      () => {
        assert.fail('Must not start');
      },
    ),
    { name: 'AbortError' },
  );
});
test('continuous progress cannot evade the total decoder deadline', async () => {
  let interval;
  const w = worker((w) => {
    interval = setInterval(
      () => w.onmessage?.({ data: { type: 'progress', progress: 0.5 } }),
      2,
    );
  });
  try {
    assert.equal(
      await tryFastAudio(
        file,
        3,
        new AbortController().signal,
        () => {},
        () => w,
        { idleMs: 20, totalMs: 40 },
      ),
      null,
    );
    assert.equal(w.terminated, true);
  } finally {
    clearInterval(interval);
  }
});

test('real MOV audio-only decoding preserves sample rates and delayed edit-list timestamps', async (t) => {
  fs.mkdirSync('.tmp', { recursive: true });
  const dir = fs.mkdtempSync(path.resolve('.tmp/fast-audio-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ffmpeg = (args) =>
    execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);
  const aFile = path.join(dir, 'a.mov');
  const bFile = path.join(dir, 'b.mov');
  const delayedFile = path.join(dir, 'delayed.mov');
  ffmpeg([
    '-i',
    'public/demo/camera-a.mp4',
    '-c:v',
    'copy',
    '-c:a',
    'pcm_s16le',
    '-ar',
    '48000',
    '-ac',
    '2',
    aFile,
  ]);
  ffmpeg([
    '-i',
    'public/demo/camera-b.mp4',
    '-c:v',
    'copy',
    '-c:a',
    'pcm_s16le',
    '-ar',
    '44100',
    '-ac',
    '2',
    bFile,
  ]);
  ffmpeg([
    '-i',
    'public/demo/camera-b.mp4',
    '-itsoffset',
    '0.37',
    '-i',
    'public/demo/camera-b.mp4',
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-c:v',
    'copy',
    '-c:a',
    'pcm_s16le',
    '-ar',
    '48000',
    delayedFile,
  ]);
  const decode = async (p, d) =>
    decodeAudioTrack(new Blob([fs.readFileSync(p)]), d, () => {});
  const a = await decode(aFile, 22),
    b = await decode(bFile, 14),
    delayed = await decode(delayedFile, 14.37);
  assert.equal(a.length, 352000);
  assert.equal(b.length, 224000);
  assert.ok(
    delayed.subarray(0, Math.floor(0.36 * 16000)).every((x) => x === 0),
    'Must retain leading empty edit',
  );
  const features = fingerprints(a, 16000);
  for (const [pcm, expected] of [
    [b, 2.34],
    [delayed, 1.97],
  ]) {
    const result = alignFeatures(features, fingerprints(pcm, 16000), 0);
    assert.equal(result.confident, true);
    assert.ok(
      Math.abs(result.offset - expected) < 0.04,
      `Expected ${expected}, got ${result.offset}`,
    );
  }
});
test('corrupt MOV and unsupported native AAC decoding are rejected for player fallback', async () => {
  await assert.rejects(decodeAudioTrack(file, 3, () => {}));
  // Node has no native AudioDecoder; real AAC metadata is parsed but no fake PCM is returned.
  assert.equal(typeof globalThis.AudioDecoder, 'undefined');
  await assert.rejects(
    decodeAudioTrack(
      new Blob([fs.readFileSync('public/demo/camera-a.mp4')]),
      22,
      () => {},
    ),
    /Unsupported audio codec/,
  );
});
