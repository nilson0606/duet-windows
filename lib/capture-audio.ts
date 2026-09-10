import { addSamples } from './audio-samples.ts';
export { addSamples } from './audio-samples.ts';
import { tryFastAudio } from './fast-audio.ts';
import { RATE, seek, type Clip } from './media.ts';
import { playerAudio } from './player-audio.ts';
import { abortReason, mediaDeadline } from './media-deadline.ts';

const modules = new WeakMap<AudioContext, Promise<void>>();
function loadProcessor(context: AudioContext) {
  let pending = modules.get(context);
  if (!pending) {
    pending = context.audioWorklet.addModule('/audio-capture.worklet.js');
    modules.set(context, pending);
    void pending.catch(() => modules.delete(context));
  }
  return pending;
}

async function captureOne(
  clip: Clip,
  context: AudioContext,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
): Promise<Float32Array> {
  const video = clip.video;
  const originalTime = video.currentTime;
  const node = new AudioWorkletNode(context, 'duet-audio-capture');
  const source = playerAudio(context, video);
  const sums = new Float32Array(Math.ceil(clip.duration * RATE));
  const counts = new Uint16Array(sums.length);
  let complete: () => void = () => {};
  const flushed = new Promise<void>((resolve) => {
    complete = resolve;
  });
  node.port.onmessage = ({ data }) => {
    if (data.type === 'done') complete();
    else if (data.type === 'samples')
      addSamples(sums, counts, data.samples, data.mediaTime, data.rate);
  };
  const playing = () =>
    node.port.postMessage({
      type: 'start',
      mediaTime: video.currentTime,
      contextTime: context.currentTime,
    });
  const waiting = () => node.port.postMessage({ type: 'pause' });
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    source.connect(node);
    node.connect(context.destination);
    await seek(video, 0, signal);
    video.muted = false;
    video.volume = 1;
    video.playbackRate = 1;
    video.addEventListener('playing', playing);
    video.addEventListener('waiting', waiting);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let lastTime = 0,
        lastMovement = performance.now();
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        video.removeEventListener('ended', ended);
        video.removeEventListener('error', failed);
        node.removeEventListener('processorerror', processorError);
        signal.removeEventListener('abort', aborted);
        if (error) reject(error);
        else resolve();
      };
      const ended = () => finish();
      const failed = () =>
        finish(new Error('播放器無法讀取這段影片的聲音，請重新匯入。'));
      const processorError = () =>
        finish(new Error('音訊擷取中斷，請再按一次自動對齊。'));
      const aborted = () => finish(abortReason(signal));
      video.addEventListener('ended', ended);
      video.addEventListener('error', failed);
      node.addEventListener('processorerror', processorError);
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) {
        aborted();
        return;
      }
      timer = setInterval(() => {
        onProgress(Math.min(1, video.currentTime / clip.duration));
        if (video.currentTime > lastTime + 0.01) {
          lastMovement = performance.now();
          lastTime = video.currentTime;
        } else if (performance.now() - lastMovement > 15000) {
          finish(new Error('讀取聲音停滯，請保持頁面在前景並重試。'));
        }
      }, 250);
      // Activate before play to include the opening; playing reanchors the media
      // clock after startup buffering. Waiting/playing similarly excludes stalls.
      playing();
      try {
        void mediaDeadline(
          video.play(),
          signal,
          12000,
          '播放器未啟動，請再按一次自動對齊。',
        ).catch((error) => finish(error));
      } catch (error) {
        finish(error instanceof Error ? error : new Error('播放器無法啟動'));
      }
    });
    node.port.postMessage({ type: 'finish' });
    await mediaDeadline(flushed, signal, 3000, '音訊擷取未完成，請重試。');
    let energy = 0,
      received = 0;
    for (let i = 0; i < sums.length; i++) {
      if (counts[i]) {
        sums[i] /= counts[i];
        received++;
      }
      energy += sums[i] * sums[i];
    }
    if (received < RATE || energy / sums.length < 1e-10)
      throw new Error(
        '播放器沒有提供可辨識的聲音，請確認影片有聲音，或使用手動對齊。',
      );
    onProgress(1);
    return sums;
  } finally {
    clearInterval(timer);
    video.pause();
    video.muted = true;
    video.removeEventListener('playing', playing);
    video.removeEventListener('waiting', waiting);
    source.disconnect(node);
    node.disconnect();
    node.port.onmessage = null;
    node.port.close();
    // Restore the preview position without retaining any partial PCM on failure.
    if (!signal.aborted)
      await seek(video, originalTime, signal).catch(() => {});
  }
}

export async function captureClipAudio(
  clips: Clip[],
  context: AudioContext,
  signal: AbortSignal,
  onProgress: (
    index: number,
    progress: number,
    method: 'fast' | 'player',
  ) => void,
  host: HTMLElement,
  createFastWorker?: () => Worker,
) {
  const missing = clips
    .map((clip, index) => ({ clip, index }))
    .filter(({ clip }) => !clip.mono);
  if (!missing.length) return;
  const parents = missing.map(({ clip }) => clip.video.parentNode);
  const session = new AbortController();
  const cancel = () => session.abort(abortReason(signal));
  const hidden = () => {
    if (document.hidden)
      session.abort(
        new Error('讀取聲音已中止，請保持網站在前景，勿鎖定螢幕。'),
      );
  };
  signal.addEventListener('abort', cancel, { once: true });
  document.addEventListener('visibilitychange', hidden);
  if (signal.aborted) cancel();
  try {
    if (session.signal.aborted) throw abortReason(session.signal);
    // Start resume and playback while still inside the user's tap gesture.
    const resumed = context.resume();
    const primed = missing.map(({ clip }) => {
      playerAudio(context, clip.video);
      host.appendChild(clip.video);
      clip.video.muted = true;
      return clip.video.play().then(() => clip.video.pause());
    });
    await mediaDeadline(
      Promise.all([resumed, ...primed]),
      session.signal,
      12000,
      '音訊播放未啟動，請再按一次自動對齊。',
    );
    for (const { clip, index } of missing) {
      onProgress(index, 0, 'fast');
      const fast = await tryFastAudio(
        clip.file,
        clip.duration,
        session.signal,
        (p) => onProgress(index, p, 'fast'),
        createFastWorker,
      );
      if (session.signal.aborted) throw abortReason(session.signal);
      if (fast) {
        clip.mono = fast;
        clip.audioReadMethod = 'fast';
      } else {
        onProgress(index, 0, 'player');
        await mediaDeadline(
          loadProcessor(context),
          session.signal,
          15000,
          '音訊分析程式無法載入，請重新整理後重試。',
        );
        clip.mono = await captureOne(clip, context, session.signal, (p) =>
          onProgress(index, p, 'player'),
        );
        clip.audioReadMethod = 'player';
      }
      const mono = clip.mono;
      clip.peaks = Array.from({ length: 64 }, (_, i) => {
        let peak = 0;
        const start = Math.floor((i * mono.length) / 64);
        const end = Math.floor(((i + 1) * mono.length) / 64);
        for (let j = start; j < end; j += 16)
          peak = Math.max(peak, Math.abs(mono[j]));
        return peak;
      });
      clip.audioError = undefined;
    }
  } finally {
    missing.forEach(({ clip }, i) => {
      clip.video.pause();
      clip.video.muted = true;
      if (parents[i]) parents[i]!.appendChild(clip.video);
    });
    signal.removeEventListener('abort', cancel);
    document.removeEventListener('visibilitychange', hidden);
  }
}
