import assert from 'node:assert/strict';
import test from 'node:test';
import { AuditionPlayer } from '../lib/audition-player.ts';

class Video extends EventTarget {
  constructor(duration = 20) {
    super();
    this.duration = duration;
    this._time = 0;
    this.readyState = 2;
    this.paused = true;
    this.ended = false;
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
    this.playCalls++;
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}
function setup(t, options = {}) {
  const videos = options.videos ?? [new Video(20), new Video(15)];
  const sources = [],
    gains = [],
    nodes = [];
  let loads = 0;
  const context = {
    currentTime: 100,
    destination: {},
    closed: false,
    resume() {
      return Promise.resolve();
    },
    close() {
      this.closed = true;
      return Promise.resolve();
    },
    createGain() {
      const gain = {
        gain: { value: 1 },
        connect() {},
        disconnect() {
          this.disconnected = true;
        },
      };
      gains.push(gain);
      return gain;
    },
    createBuffer(channels, length, rate) {
      const pcm = new Float32Array(length);
      return { duration: length / rate, getChannelData: () => pcm };
    },
    createBufferSource() {
      const node = {
        connect(target) {
          this.target = target;
        },
        disconnect() {
          this.disconnected = true;
        },
        start(when, offset) {
          this.when = when;
          this.offset = offset;
        },
        stop() {
          this.stopped = true;
        },
      };
      nodes.push(node);
      return node;
    },
    createMediaElementSource(video) {
      assert.ok(!sources.some((s) => s.video === video));
      const source = {
        video,
        connect(to) {
          this.target = to;
        },
        disconnect() {
          this.disconnected = true;
        },
      };
      sources.push(source);
      return source;
    },
  };
  const load =
    options.load ??
    (async () =>
      videos.map((video) =>
        new Float32Array(Math.ceil(video.duration * 16000)).fill(0.2),
      ));
  const player = new AuditionPlayer(
    videos,
    () => context,
    (...args) => {
      loads++;
      return load(...args);
    },
  );
  t.after(() => player.dispose());
  return {
    videos,
    player,
    context,
    gains,
    sources,
    nodes,
    get loads() {
      return loads;
    },
  };
}
test('single-clip native audition works without preparing PCM', async (t) => {
  const env = setup(t, { videos: [new Video(), null] });
  await env.player.playOne(0);
  assert.equal(env.videos[0].paused, false);
  assert.equal(env.loads, 0);
  env.player.pauseOne(0);
  assert.equal(env.videos[0].paused, true);
  await assert.rejects(env.player.playTogether(0, 0), /兩部影片/);
});
for (const [offset, expected] of [
  [2, [5, 3]],
  [-2, [3, 5]],
]) {
  test(`shared audio clock applies ${offset} second offset and caches for replay`, async (t) => {
    const env = setup(t);
    await env.player.playTogether(offset, 3);
    assert.deepEqual(
      env.nodes.map((n) => n.offset),
      expected,
    );
    assert.deepEqual(
      env.nodes.map((n) => n.when),
      [100.05, 100.05],
    );
    assert.ok(env.videos.every((v) => v.muted));
    assert.equal(
      env.sources.length,
      0,
      'Simultaneous sound must not use native media sources',
    );
    env.context.currentTime = 101.05;
    assert.deepEqual(
      [env.player.position(0), env.player.position(1)],
      expected.map((v) => v + 1),
    );
    env.player.pauseAll();
    assert.ok(env.nodes.every((n) => n.stopped && n.disconnected));
    await env.player.playTogether(0, 1);
    assert.equal(env.loads, 1);
    assert.deepEqual(
      env.nodes.slice(2).map((n) => n.offset),
      [1, 1],
    );
  });
}
test('Safari pausing a preview cannot cancel either shared-clock audio source', async (t) => {
  const env = setup(t);
  env.videos[1].play = () => {
    env.videos[0].pause();
    env.videos[1].paused = false;
    return Promise.resolve();
  };
  await env.player.playTogether(2, 0);
  assert.equal(
    env.videos[0].paused,
    true,
    'Reproduce browser pausing one native player',
  );
  assert.ok(env.player.isPlaying(0) && env.player.isPlaying(1));
  assert.ok(env.nodes.every((n) => !n.stopped));
  assert.equal(env.nodes[0].when, env.nodes[1].when);
  env.context.currentTime += 1;
  env.player.syncPreview(0);
  assert.ok(Math.abs(env.videos[0].currentTime - 2.95) < 0.001);
});
test('a rejected silent video preview still permits both audio streams', async (t) => {
  const env = setup(t);
  env.videos[1].play = () =>
    Promise.reject(new DOMException('Blocked', 'NotAllowedError'));
  await env.player.playTogether(0, 0);
  assert.ok(env.player.isPlaying(0) && env.player.isPlaying(1));
});
test('pause, seek, and replay A leave buffered B playing', async (t) => {
  const env = setup(t);
  await env.player.playTogether(0, 0);
  env.player.pauseOne(0);
  assert.equal(env.nodes[0].stopped, true);
  assert.ok(!env.nodes[1].stopped && env.player.isPlaying(1));
  env.player.seekOne(0, 4);
  await env.player.playOne(0);
  assert.equal(env.nodes[2].offset, 4);
  assert.ok(!env.nodes[1].stopped);
  assert.equal(env.loads, 1);
});
test('preparing after native solo playback mutes the native route before mixing', async (t) => {
  const env = setup(t);
  await env.player.playOne(0);
  const directGain = env.sources[0].target;
  assert.equal(directGain.gain.value, 1);
  await env.player.playTogether(0, 0);
  assert.equal(directGain.gain.value, 0);
  assert.ok(env.videos.every((v) => v.muted));
});
test('invalid settings are rejected before loading audio', async (t) => {
  const env = setup(t);
  for (const [offset, position] of [
    [NaN, 0],
    [30, 0],
    [0, -1],
    [0, 15],
    [0, NaN],
  ])
    await assert.rejects(env.player.playTogether(offset, position));
  assert.equal(env.loads, 0);
});
test('cancellation during audio preparation cannot start late playback', async (t) => {
  let resolve, signal;
  const env = setup(t, {
    load: (_context, s) => {
      signal = s;
      return new Promise((r) => {
        resolve = r;
      });
    },
  });
  const pending = env.player.playTogether(0, 0);
  env.player.pauseAll();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(signal.aborted, true);
  resolve([new Float32Array(320000), new Float32Array(240000)]);
  await Promise.resolve();
  assert.equal(env.nodes.length, 0);
  assert.ok(env.videos.every((v) => v.paused));
});
test('failed or incomplete audio is not cached as a usable pair', async (t) => {
  let attempt = 0;
  const env = setup(t, {
    load: async () => {
      if (++attempt === 1)
        throw new DOMException('decoding failed', 'EncodingError');
      return [new Float32Array(1), new Float32Array(1)];
    },
  });
  await assert.rejects(env.player.playTogether(0, 0), {
    name: 'EncodingError',
  });
  await assert.rejects(env.player.playTogether(0, 0), /不完整/);
  assert.equal(env.loads, 2);
  assert.equal(env.nodes.length, 0);
});
test('disposal stops scheduled sound and closes audition resources', async (t) => {
  const env = setup(t);
  await env.player.playTogether(0, 0);
  env.player.dispose();
  assert.ok(env.nodes.every((n) => n.stopped && n.disconnected));
  assert.equal(env.context.closed, true);
  await assert.rejects(env.player.playOne(0), /已關閉/);
});
