import assert from 'node:assert/strict';
import test from 'node:test';
import { mediaDeadline } from '../lib/media-deadline.ts';
import { renderMovie } from '../lib/render-movie.ts';

test('pending media operations time out rather than hanging', async () => {
  await assert.rejects(
    mediaDeadline(
      new Promise(() => {}),
      new AbortController().signal,
      15,
      'startup timeout',
    ),
    /startup timeout/,
  );
});
test('cancel interrupts a pending media operation', async () => {
  const abort = new AbortController();
  const work = mediaDeadline(
    new Promise(() => {}),
    abort.signal,
    1000,
    'timeout',
  );
  abort.abort();
  await assert.rejects(work, { name: 'AbortError' });
});

// Exercise the orchestration with real EventTargets and controlled decoder clocks.
// Browser codec/device support is intentionally not claimed by this simulation.
function environment({
  lag = 0,
  playPending = false,
  clockDuration = 1,
  startFault = false,
  stopPending = false,
  onTick,
  frameStep = 0.05,
} = {}) {
  const saved = {};
  const keys = [
    'document',
    'navigator',
    'MediaRecorder',
    'requestAnimationFrame',
    'cancelAnimationFrame',
  ];
  for (const k of keys)
    saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
  const body = {
    appendChild(v) {
      v.parentNode = this;
    },
  };
  const doc = new EventTarget();
  doc.hidden = false;
  doc.body = body;
  class Video extends EventTarget {
    constructor(i) {
      super();
      this.index = i;
      this._time = 0;
      this.duration = clockDuration;
      this.readyState = 2;
      this.muted = true;
      this.paused = true;
      this.rateAssignments = [];
      this.playbackRate = 1;
      this.parentNode = body;
      this.seeks = [];
      this.playCalls = 0;
    }
    get playbackRate() {
      return this._rate;
    }
    set playbackRate(rate) {
      this._rate = rate;
      this.rateAssignments.push(rate);
    }
    get currentTime() {
      return this._time;
    }
    set currentTime(t) {
      this._time = t;
      this.seeks.push(t);
      queueMicrotask(() => this.dispatchEvent(new Event('seeked')));
    }
    play() {
      this.playCalls++;
      assert.equal(
        this.muted,
        this.index !== args.audio,
        'Only the chosen audio player is unmuted',
      );
      this.paused = false;
      return playPending ? new Promise(() => {}) : Promise.resolve();
    }
    pause() {
      this.paused = true;
    }
  }
  const videos = [new Video(0), new Video(1)];
  const track = () => ({
    stopped: false,
    stop() {
      this.stopped = true;
    },
  });
  const audioTrack = track(),
    videoTrack = track();
  const audioSource = { video: null, connect() {}, disconnect() {} };
  const gains = [];
  let sourceCalls = 0;
  const context = {
    currentTime: 0,
    resume: () => Promise.resolve(),
    decodeAudioData: () => {
      throw new Error('Whole-file audio decoding must never run');
    },
    createMediaElementSource(video) {
      sourceCalls++;
      if (sourceCalls > 1)
        throw new Error('Media element cannot be attached twice');
      audioSource.video = video;
      return audioSource;
    },
    destination: {},
    createGain() {
      const gain = { gain: { value: 1 }, connect() {}, disconnect() {} };
      gains.push(gain);
      return gain;
    },
    createMediaStreamDestination: () => ({
      stream: {
        getAudioTracks: () => [audioTrack],
        getTracks: () => [audioTrack],
      },
      disconnect() {},
    }),
  };
  const draws = [];
  const ctx = {
    fillStyle: '',
    fillRect(...args) {
      draws.push(['black', ...args]);
    },
    drawImage(video, ...args) {
      draws.push(['video', video.index, video.currentTime, ...args]);
    },
  };
  const stream = {
    tracks: [videoTrack],
    getTracks() {
      return this.tracks;
    },
    addTrack(t) {
      this.tracks.push(t);
    },
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    captureStream: () => stream,
  };
  let recording = false,
    failedOnce = false;
  class Recorder {
    static isTypeSupported() {
      return true;
    }
    constructor() {
      this.state = 'inactive';
      this.mimeType = 'video/mp4';
    }
    start() {
      if (startFault) throw new Error('encoder start failed');
      this.state = 'recording';
      recording = true;
    }
    stop() {
      this.state = 'inactive';
      if (stopPending) return;
      queueMicrotask(() => {
        this.ondataavailable?.({ data: new Blob([new Uint8Array(2048)]) });
        this.onstop?.();
      });
    }
  }
  Object.defineProperty(globalThis, 'document', {
    value: doc,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: {},
    configurable: true,
  });
  Object.defineProperty(globalThis, 'MediaRecorder', {
    value: Recorder,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: (cb) =>
      setTimeout(() => {
        context.currentTime += frameStep;
        for (const v of videos)
          if (!v.paused) v._time += frameStep * v.playbackRate;
        if (recording && lag && !failedOnce) {
          videos[1]._time -= lag;
          failedOnce = true;
        }
        onTick?.(context, videos, recording);
        cb();
      }, 0),
  });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    value: clearTimeout,
  });
  const clips = videos.map((video) => ({
    video,
    duration: clockDuration,
    file: { arrayBuffer: async () => new ArrayBuffer(20) },
  }));
  const abort = new AbortController(),
    stages = [],
    progress = [];
  const args = {
    clips,
    boxes: [
      { x: 0, y: 0, width: 0.5, height: 1 },
      { x: 0.5, y: 0, width: 0.5, height: 1 },
    ],
    order: [0, 1],
    offset: 0,
    width: 854,
    height: 480,
    audio: 0,
    context,
    canvas,
    sourceHost: {
      appendChild(v) {
        v.parentNode = this;
      },
    },
    signal: abort.signal,
    onProgress: (p) => progress.push(p),
    onStage: (...p) => stages.push(p),
  };
  return {
    args,
    abort,
    videos,
    stages,
    progress,
    draws,
    audioSource,
    gains,
    tracks: [audioTrack, videoTrack],
    restore() {
      for (const k of keys) {
        if (saved[k]) Object.defineProperty(globalThis, k, saved[k]);
        else delete globalThis[k];
      }
    },
  };
}
test('fusion produces progress and a finished video', async () => {
  const env = environment();
  try {
    const blob = await renderMovie(env.args);
    assert.ok(blob.size >= 2048);
    assert.equal(blob.type, 'video/mp4');
    assert.deepEqual(
      [...new Set(env.stages.map((s) => s[0]))],
      ['preparing', 'recording', 'finalizing'],
    );
    assert.equal(env.progress[0], 0);
    assert.equal(env.progress.at(-1), 1);
    assert.ok(env.tracks.every((t) => t.stopped));
    assert.ok(env.videos.every((v) => v.paused));
  } finally {
    env.restore();
  }
});
test('fusion never seeks or changes speed after the initial trim, even with playback lag', async () => {
  const env = environment({ lag: 3, clockDuration: 2 });
  try {
    await renderMovie(env.args);
    for (const video of env.videos) {
      assert.deepEqual(video.seeks, []);
      assert.ok(video.rateAssignments.every((rate) => rate === 1));
      assert.equal(
        video.playCalls,
        2,
        'Only startup priming and the final play',
      );
    }
    assert.equal(env.progress.at(-1), 1);
  } finally {
    env.restore();
  }
});
test('trim offsets are applied before recording and to the chosen audio', async () => {
  const env = environment({ clockDuration: 4 });
  env.args.offset = -1;
  env.args.audio = 1;
  try {
    await renderMovie(env.args);
    assert.deepEqual(env.videos[1].seeks, [1]);
    assert.deepEqual(env.videos[0].seeks, []);
    assert.equal(env.audioSource.video, env.videos[1]);
    assert.equal(env.gains[0].gain.value, 0, 'Speaker monitor stays silent');
    assert.equal(
      env.gains[1].gain.value,
      0,
      'Recording gate is closed on completion',
    );
    assert.ok(
      env.draws.some((d) => d[0] === 'black' && d[1] === 427),
      'Ended shorter clip becomes black',
    );
  } finally {
    env.restore();
  }
});
test('large source offsets are cropped before playback', async () => {
  const env = environment({ clockDuration: 8 });
  env.args.offset = 4;
  try {
    await renderMovie(env.args);
    assert.deepEqual(env.videos[0].seeks, [4]);
    assert.deepEqual(env.videos[1].seeks, []);
    assert.ok(
      env.videos.every((v) => v.rateAssignments.every((rate) => rate === 1)),
    );
    assert.equal(env.audioSource.video, env.videos[0]);
  } finally {
    env.restore();
  }
});
test('cancellation during startup returns without waiting for play()', async () => {
  const env = environment({ playPending: true });
  try {
    const work = renderMovie(env.args);
    env.abort.abort();
    await assert.rejects(work, { name: 'AbortError' });
    assert.ok(env.videos.every((v) => v.paused));
  } finally {
    env.restore();
  }
});
test('encoder startup failure is returned and tracks are released', async () => {
  const env = environment({ startFault: true });
  try {
    await assert.rejects(renderMovie(env.args), /encoder start failed/);
    assert.ok(env.tracks.every((t) => t.stopped));
  } finally {
    env.restore();
  }
});

test('120 Hz display composites only the 30 fps output frames', async () => {
  const env = environment({ frameStep: 1 / 120, clockDuration: 1 });
  try {
    await renderMovie(env.args);
    const frames = env.draws.filter(
      (d) => d[0] === 'video' && d[1] === 0,
    ).length;
    assert.ok(frames <= 32, 'Too many composite frames: ' + frames);
    assert.ok(frames >= 28);
    assert.ok(env.progress.length <= 7);
  } finally {
    env.restore();
  }
});
test('jittery playback does not trigger repeated decoder seeks during fusion', async () => {
  const env = environment({
    frameStep: 1 / 60,
    clockDuration: 2,
    onTick: (context, videos, recording) => {
      if (recording)
        videos[1]._time =
          context.currentTime +
          (Math.floor(context.currentTime * 60) % 2 ? 0.24 : -0.24);
    },
  });
  try {
    await renderMovie(env.args);
    assert.equal(env.videos[1].seeks.length, 0);
    assert.equal(env.progress.at(-1), 1);
  } finally {
    env.restore();
  }
});

test('repeated exports reuse the player source without another file decode or attachment', async () => {
  const env = environment();
  try {
    await renderMovie(env.args);
    await renderMovie(env.args);
    assert.equal(env.progress.at(-1), 1);
    assert.ok(env.videos.every((v) => v.paused && v.muted));
  } finally {
    env.restore();
  }
});
