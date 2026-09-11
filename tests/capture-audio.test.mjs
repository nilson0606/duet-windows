import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { captureClipAudio, addSamples } from '../lib/capture-audio.ts';
import { playerAudio, releasePlayerAudio } from '../lib/player-audio.ts';
import { loadClip, disposeClip } from '../lib/media.ts';
import { fingerprints, alignFeatures } from '../lib/alignment.mjs';

function capturedPcm(input, rate, clockStart) {
  const sums = new Float32Array(Math.ceil((input.length * 16000) / rate));
  const counts = new Uint16Array(sums.length);
  let Processor;
  const globals = {
    sampleRate: rate,
    currentFrame: Math.round(clockStart * rate),
    AudioWorkletProcessor: class {
      constructor() {
        this.port = {
          postMessage(data) {
            if (data.type === 'samples')
              addSamples(sums, counts, data.samples, data.mediaTime, data.rate);
          },
        };
      }
    },
    registerProcessor(name, type) {
      assert.equal(name, 'duet-audio-capture');
      Processor = type;
    },
  };
  vm.runInNewContext(
    fs.readFileSync('public/audio-capture.worklet.js', 'utf8'),
    globals,
  );
  const processor = new Processor();
  processor.port.onmessage({
    data: { type: 'start', mediaTime: 0, contextTime: clockStart },
  });
  let stalled = false;
  for (let i = 0; i < input.length; i += 128) {
    if (!stalled && i > rate) {
      processor.port.onmessage({ data: { type: 'pause' } });
      globals.currentFrame += rate * 2;
      processor.process([[new Float32Array(128)]]);
      processor.port.onmessage({
        data: {
          type: 'start',
          mediaTime: i / rate,
          contextTime: globals.currentFrame / rate,
        },
      });
      stalled = true;
    }
    processor.process([[input.subarray(i, i + 128)]]);
    globals.currentFrame += 128;
  }
  processor.port.onmessage({ data: { type: 'finish' } });
  for (let i = 0; i < sums.length; i++) if (counts[i]) sums[i] /= counts[i];
  return sums;
}

test('player PCM keeps the known AAC offset despite different startup clocks and a playback stall', () => {
  const decode = (name, rate) => {
    const bytes = execFileSync(
      'ffmpeg',
      [
        '-v',
        'error',
        '-i',
        `public/demo/camera-${name}.mp4`,
        '-f',
        'f32le',
        '-ac',
        '1',
        '-ar',
        String(rate),
        '-',
      ],
      { maxBuffer: 32 * 1024 * 1024 },
    );
    return new Float32Array(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
  };
  const a = capturedPcm(decode('a', 48000), 48000, 4);
  const b = capturedPcm(decode('b', 44100), 44100, 10);
  const result = alignFeatures(fingerprints(a, 16000), fingerprints(b, 16000));
  assert.ok(result.confident, JSON.stringify(result));
  assert.ok(Math.abs(result.offset - 2.34) < 1 / 30, JSON.stringify(result));
});

test('PCM chunks use media positions and ignore samples outside the clip', () => {
  const sums = new Float32Array(4),
    counts = new Uint16Array(4);
  addSamples(sums, counts, Float32Array.from([9, 1, 2, 3, 4, 9]), -1, 1, 1);
  assert.deepEqual([...sums], [1, 2, 3, 4]);
  assert.deepEqual([...counts], [1, 1, 1, 1]);
});

function environment(t, mode = 'success') {
  const saved = ['document', 'AudioWorkletNode'].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]);
  const doc = new EventTarget();
  doc.hidden = false;
  const originalHost = {
    appendChild(video) {
      video.parentNode = this;
    },
  };
  const host = {
    appendChild(video) {
      video.parentNode = this;
    },
  };
  const abort = new AbortController();
  const nodes = [],
    sourceMap = new Map();
  let moduleCalls = 0;
  class Worklet extends EventTarget {
    constructor() {
      super();
      nodes.push(this);
      this.closed = false;
      this.port = {
        onmessage: null,
        close: () => {
          this.closed = true;
        },
        postMessage: (data) => {
          if (data.type === 'finish')
            queueMicrotask(() =>
              this.port.onmessage?.({ data: { type: 'done' } }),
            );
        },
      };
    }
    connect() {}
    disconnect() {}
  }
  class Video extends EventTarget {
    constructor(index) {
      super();
      this.index = index;
      this._time = 0;
      this.duration = 3;
      this.readyState = 2;
      this.muted = true;
      this.paused = true;
      this.parentNode = originalHost;
      this.playCalls = 0;
    }
    get currentTime() {
      return this._time;
    }
    set currentTime(value) {
      this._time = value;
      queueMicrotask(() => this.dispatchEvent(new Event('seeked')));
    }
    play() {
      this.paused = false;
      this.playCalls++;
      if (!this.muted)
        queueMicrotask(() => {
          const node = sourceMap.get(this).node;
          this.dispatchEvent(new Event('playing'));
          if (mode === 'processor-error') {
            node.dispatchEvent(new Event('processorerror'));
            return;
          }
          if (
            mode === 'cancel' ||
            (mode === 'cancel-second' && this.index === 1)
          ) {
            abort.abort();
            return;
          }
          if (mode === 'hidden') {
            doc.hidden = true;
            doc.dispatchEvent(new Event('visibilitychange'));
            return;
          }
          const samples = new Float32Array(3 * 16000).fill(
            mode === 'silence' ? 0 : 0.2,
          );
          node.port.onmessage({
            data: { type: 'samples', samples, mediaTime: 0, rate: 16000 },
          });
          this._time = 3;
          this.dispatchEvent(new Event('ended'));
        });
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
    }
  }
  const context = {
    currentTime: 0,
    destination: {},
    resume: () => Promise.resolve(),
    audioWorklet: {
      addModule: async (url) => {
        assert.equal(url, 'https://example.test/duet-windows/audio-capture.worklet.js');
        moduleCalls++;
      },
    },
    createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
    createMediaElementSource(video) {
      assert.ok(!sourceMap.has(video), 'must reuse the original media source');
      const source = {
        node: null,
        connect(target) {
          if (target instanceof Worklet) this.node = target;
        },
        disconnect() {},
      };
      sourceMap.set(video, source);
      return source;
    },
  };
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: Object.assign(doc, { baseURI: 'https://example.test/duet-windows/' }),
  });
  Object.defineProperty(globalThis, 'AudioWorkletNode', {
    configurable: true,
    value: Worklet,
  });
  const clips = [0, 1].map((index) => ({
    video: new Video(index),
    duration: 3,
    mono: null,
  }));
  t.after(() => {
    clips.forEach((clip) => releasePlayerAudio(clip.video));
    for (const [key, value] of saved) {
      if (value) Object.defineProperty(globalThis, key, value);
      else delete globalThis[key];
    }
  });
  return {
    clips,
    context,
    abort,
    host,
    nodes,
    originalHost,
    sourceMap,
    get moduleCalls() {
      return moduleCalls;
    },
    run: (factory) =>
      captureClipAudio(clips, context, abort.signal, () => {}, host, factory),
  };
}

test('successful player capture is cached for duration-option retries and reused by export', async (t) => {
  const env = environment(t);
  await env.run();
  const calls = env.clips.map((clip) => clip.video.playCalls);
  assert.ok(env.clips.every((clip) => clip.mono.length === 48000));
  assert.ok(
    env.clips.every(
      (clip) =>
        clip.video.paused &&
        clip.video.muted &&
        clip.video.parentNode === env.originalHost,
    ),
  );
  assert.ok(env.nodes.every((node) => node.closed));
  await env.run();
  assert.deepEqual(
    env.clips.map((clip) => clip.video.playCalls),
    calls,
  );
  assert.equal(env.moduleCalls, 1);
  assert.equal(
    playerAudio(env.context, env.clips[0].video),
    env.sourceMap.get(env.clips[0].video),
  );
});

for (const [mode, pattern] of [
  ['cancel', { name: 'AbortError' }],
  ['hidden', /前景/],
  ['silence', /可辨識/],
  ['processor-error', /擷取中斷/],
]) {
  test(`${mode} releases players and discards incomplete capture`, async (t) => {
    const env = environment(t, mode);
    await assert.rejects(env.run(), pattern);
    assert.ok(
      env.clips.every(
        (clip) => !clip.mono && clip.video.paused && clip.video.muted,
      ),
    );
    assert.ok(env.nodes.every((node) => node.closed));
  });
}

test('cancelling the second clip keeps only the completed first capture', async (t) => {
  const env = environment(t, 'cancel-second');
  await assert.rejects(env.run(), { name: 'AbortError' });
  assert.ok(env.clips[0].mono);
  assert.equal(env.clips[1].mono, null);
});

test('importing an iPhone movie uses the video element without reading or decoding its file bytes', async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  class ImportVideo extends EventTarget {
    constructor() {
      super();
      this.duration = 5;
      this.videoWidth = 1920;
      this.videoHeight = 1080;
    }
    setAttribute() {}
    removeAttribute() {}
    remove() {}
    pause() {}
    load() {
      queueMicrotask(() => this.dispatchEvent(new Event('loadeddata')));
    }
  }
  const video = new ImportVideo();
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      body: { appendChild() {} },
      createElement(name) {
        return name === 'video'
          ? video
          : {
              getContext: () => ({ drawImage() {} }),
              toDataURL: () => 'data:image/jpeg;base64,test',
            };
      },
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else delete globalThis.document;
  });
  const file = new File([new Uint8Array(20)], 'iPhone.MOV', {
    type: 'video/quicktime',
  });
  file.arrayBuffer = () => {
    throw new Error('Import must not read bytes for whole-file audio decoding');
  };
  for (const duration of [3, 181, 600]) {
    video.duration = duration;
    const accepted = await loadClip(file);
    assert.equal(accepted.duration, duration);
    disposeClip(accepted);
  }
  for (const duration of [2.99, 600.001, Infinity, NaN]) {
    video.duration = duration;
    await assert.rejects(loadClip(file), /3 秒至 10 分鐘/);
  }
  video.duration = 5;
  const clip = await loadClip(file);
  assert.equal(clip.video, video);
  assert.equal(clip.mono, null);
  assert.equal(clip.audioError, undefined);
  assert.equal(clip.width, 1920);
  disposeClip(clip);
});

function fakeFastWorker(action) {
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
test('fast success skips full playback and worklet loading, then reuses cache', async (t) => {
  const env = environment(t);
  const workers = [];
  const factory = () => {
    const w = fakeFastWorker((worker) =>
      worker.onmessage({
        data: {
          type: 'done',
          mono: new Float32Array(48000).fill(0.2),
        },
      }),
    );
    workers.push(w);
    return w;
  };
  await env.run(factory);
  assert.equal(env.moduleCalls, 0);
  assert.ok(
    env.clips.every(
      (c) => c.video.playCalls === 1 && c.audioReadMethod === 'fast',
    ),
  );
  assert.ok(workers.every((w) => w.terminated));
  await env.run(factory);
  assert.equal(workers.length, 2);
});
test('EncodingError after fast A falls back only for B and keeps both audio caches usable', async (t) => {
  const env = environment(t);
  let calls = 0;
  await env.run(() =>
    fakeFastWorker((worker) => {
      if (++calls === 1)
        worker.onmessage({
          data: { type: 'done', mono: new Float32Array(48000).fill(0.3) },
        });
      else
        worker.onerror({
          message: 'EncodingError: decoding failed',
          preventDefault() {},
        });
    }),
  );
  assert.deepEqual(
    env.clips.map((c) => c.audioReadMethod),
    ['fast', 'player'],
  );
  assert.deepEqual(
    env.clips.map((c) => c.video.playCalls),
    [1, 2],
  );
  assert.equal(env.moduleCalls, 1);
  assert.ok(env.clips.every((c) => c.mono.length === 48000 && c.video.paused));
});
test('cancelling fast extraction terminates worker without starting player fallback', async (t) => {
  const env = environment(t);
  const worker = fakeFastWorker(() => env.abort.abort());
  await assert.rejects(
    env.run(() => worker),
    { name: 'AbortError' },
  );
  assert.equal(worker.terminated, true);
  assert.equal(env.moduleCalls, 0);
  assert.ok(
    env.clips.every(
      (c) => !c.mono && c.video.playCalls === 1 && c.video.paused,
    ),
  );
});
