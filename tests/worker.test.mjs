import assert from 'node:assert/strict';
import test from 'node:test';
import { alignClips } from '../lib/align-clips.ts';
const clip = () => ({ mono: Float32Array.from([0.2, 0.5, 0.3]) });
function fakeWorker() {
  return {
    terminated: false,
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(data) {
      this.data = data;
    },
    terminate() {
      this.terminated = true;
    },
  };
}
test('worker success preserves source samples and cleans up', async () => {
  const a = clip(),
    b = clip(),
    worker = fakeWorker();
  const pending = alignClips(a, b, new AbortController().signal, () => worker);
  assert.equal(worker.data.matchSeconds, 0);
  assert.notEqual(worker.data.a, a.mono);
  assert.deepEqual(worker.data.a, a.mono);
  const result = { offset: 2.34, score: 0.5, margin: 0.3, confident: true };
  worker.onmessage({ data: { result } });
  assert.deepEqual(await pending, result);
  assert.equal(worker.terminated, true);
  assert.equal(a.mono.byteLength, 12);
});
test('a rejected worker URL reports startup failure', async () => {
  await assert.rejects(
    alignClips(clip(), clip(), new AbortController().signal, () => {
      throw new DOMException('Local file URL blocked', 'SecurityError');
    }),
    /W01/,
  );
});
test('failed script load reports load failure and terminates worker', async () => {
  const worker = fakeWorker(),
    pending = alignClips(
      clip(),
      clip(),
      new AbortController().signal,
      () => worker,
    );
  worker.onerror({ message: 'Script load failed' });
  await assert.rejects(pending, /W02/);
  assert.equal(worker.terminated, true);
});
test('message deserialization failure is distinct', async () => {
  const worker = fakeWorker(),
    pending = alignClips(
      clip(),
      clip(),
      new AbortController().signal,
      () => worker,
    );
  worker.onmessageerror();
  await assert.rejects(pending, /W03/);
  assert.equal(worker.terminated, true);
});
test('synchronous send failure releases the worker', async () => {
  const worker = fakeWorker();
  worker.postMessage = () => {
    throw new Error('send failed');
  };
  await assert.rejects(
    alignClips(clip(), clip(), new AbortController().signal, () => worker),
    /W04/,
  );
  assert.equal(worker.terminated, true);
});
test('aborted requests never create a worker', async () => {
  const abort = new AbortController();
  abort.abort();
  let calls = 0;
  await assert.rejects(
    alignClips(clip(), clip(), abort.signal, () => {
      calls++;
      return fakeWorker();
    }),
    { name: 'AbortError' },
  );
  assert.equal(calls, 0);
});
test('cancel during analysis terminates the worker', async () => {
  const worker = fakeWorker(),
    abort = new AbortController(),
    pending = alignClips(clip(), clip(), abort.signal, () => worker);
  abort.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(worker.terminated, true);
});
test('analysis error from worker preserves useful reason', async () => {
  const worker = fakeWorker(),
    pending = alignClips(
      clip(),
      clip(),
      new AbortController().signal,
      () => worker,
    );
  worker.onmessage({ data: { error: '音訊太短' } });
  await assert.rejects(pending, /音訊太短/);
  assert.equal(worker.terminated, true);
});

test('selected matching duration reaches the worker', async () => {
  for (const seconds of [0, 1, 2, 3, 4, 5]) {
    const worker = fakeWorker();
    const pending = alignClips(
      clip(),
      clip(),
      new AbortController().signal,
      () => worker,
      seconds,
    );
    assert.equal(worker.data.matchSeconds, seconds);
    worker.onmessage({ data: { result: { offset: 0, confident: true } } });
    await pending;
  }
});
