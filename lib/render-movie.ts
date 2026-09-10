import type { TextLayer } from './text-overlay.ts';
import { timeline } from './timeline.mjs';
import { playerAudio } from './player-audio.ts';
import {
  drawComposition,
  seek,
  supportedMime,
  type Clip,
  type Box,
} from './media.ts';
import { mediaDeadline, abortReason } from './media-deadline.ts';
export type ExportPhase =
  | 'preparing'
  | 'recording'
  | 'finalizing'
  | 'done'
  | 'error'
  | 'cancelled';
export async function renderMovie(args: {
  clips: Clip[];
  boxes: Box[];
  order: number[];
  textLayers?: TextLayer[];
  offset: number;
  width: number;
  height: number;
  audio: number;
  context: AudioContext;
  canvas: HTMLCanvasElement;
  sourceHost: HTMLElement;
  signal: AbortSignal;
  onProgress: (n: number) => void;
  onStage: (phase: ExportPhase, message: string) => void;
}): Promise<Blob> {
  const {
    clips,
    boxes,
    order,
    textLayers = [],
    offset,
    width,
    height,
    audio,
    context,
    canvas,
    sourceHost,
    signal,
    onProgress,
    onStage,
  } = args;
  const plan = timeline(clips[0].duration, clips[1].duration, offset);
  const session = new AbortController();
  const cancel = () => session.abort(abortReason(signal));
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  const visibility = () => {
    if (document.hidden)
      session.abort(
        new Error('輸出已中止：請保持網站在前景，勿鎖定螢幕。（E01）'),
      );
  };
  document.addEventListener('visibilitychange', visibility);
  const run = <T>(promise: Promise<T>, ms: number, message: string) =>
    mediaDeadline(promise, session.signal, ms, message);
  const parents = clips.map((c) => c.video.parentNode);
  let stream: MediaStream | undefined,
    destination: MediaStreamAudioDestinationNode | undefined;
  let recorder: MediaRecorder | undefined,
    source: MediaElementAudioSourceNode | undefined;
  let audioGate: GainNode | undefined;
  let wake: WakeLockSentinel | undefined,
    stopping = false;
  try {
    onStage('preparing', '正在啟動影片與音訊…');
    onProgress(0);
    if (session.signal.aborted) throw abortReason(session.signal);
    const mime = supportedMime();
    if (!mime)
      throw new Error(
        '此瀏覽器不支援影片輸出，請使用支援影片錄製的 Chrome 或 Edge。（E02）',
      );
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false })!;
    if (!ctx || !canvas.captureStream)
      throw new Error('此瀏覽器無法錄製合成畫面。（E03）');
    // The selected player's audio feeds the recorder, like nivitrack iPhone.
    // The monitor is silent; the other video stays muted.
    source = playerAudio(context, clips[audio].video);
    audioGate = context.createGain();
    audioGate.gain.value = 0;
    destination = context.createMediaStreamDestination();
    source.connect(audioGate);
    audioGate.connect(destination);
    const resumed = context.resume();
    const primed = clips.map((c, i) => {
      c.video.muted = i !== audio;
      c.video.volume = 1;
      c.video.playsInline = true;
      c.video.playbackRate = 1;
      sourceHost.appendChild(c.video);
      return c.video.play();
    });
    await run(
      Promise.all([resumed, ...primed]),
      12000,
      '影片尚未開始播放。請確認 Chrome 或 Edge 允許此網站播放，並重新融合。（E04）',
    );
    clips.forEach((c) => c.video.pause());
    onStage('preparing', '正在定位兩部影片的同步起點…');
    await run(
      Promise.all(
        clips.map((c, i) => seek(c.video, plan.starts[i], session.signal)),
      ),
      15000,
      '影片定位逾時，請重試。（E07）',
    );
    drawComposition(
      ctx,
      clips,
      boxes,
      width,
      height,
      0,
      plan.remaining,
      order,
      textLayers,
    );
    // A wake-lock prompt must never delay the recording startup.
    void navigator.wakeLock
      ?.request('screen')
      .then((lock) => {
        if (session.signal.aborted || stopping)
          void lock.release().catch(() => {});
        else wake = lock;
      })
      .catch(() => {});
    stream = canvas.captureStream(30);
    destination.stream
      .getAudioTracks()
      .forEach((track) => stream!.addTrack(track));
    recorder = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond:
        width * height > 1280 * 720
          ? 8_000_000
          : width * height <= 854 * 480
            ? 1_600_000
            : 3_500_000,
      audioBitsPerSecond: 128_000,
    });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    const finished = new Promise<Blob>((resolve, reject) => {
      recorder!.onstop = () => {
        if (!stopping)
          session.abort(new Error('瀏覽器提前停止錄製，請重試。（E08）'));
        resolve(new Blob(chunks, { type: recorder!.mimeType }));
      };
      recorder!.onerror = () => {
        const error = new Error('影片編碼失敗，請改用較短的影片。（E09）');
        session.abort(error);
        reject(error);
      };
    });
    void finished.catch(() => {});
    await run(
      Promise.all(clips.map((c) => c.video.play())),
      12000,
      '同步播放尚未啟動，請重新融合。（E10）',
    );
    // Both videos start at their fixed trim positions and run at normal speed.
    // The audio clock controls duration and black tails, never decoder seeking.
    const startClock = context.currentTime;
    recorder.start(1000);
    audioGate.gain.value = 1;
    onStage(
      'recording',
      '已跳過未對齊的開頭，正在以原速融合；請保持畫面開啟。',
    );
    await new Promise<void>((resolve, reject) => {
      let raf = 0,
        settled = false,
        lastReport = -1,
        nextDraw = 0;
      const cleanup = () => {
        settled = true;
        cancelAnimationFrame(raf);
        clearTimeout(timer);
        session.signal.removeEventListener('abort', abort);
      };
      const fail = (error: Error) => {
        if (settled) return;
        cleanup();
        reject(error);
      };
      const abort = () => fail(abortReason(session.signal));
      const timer = setTimeout(
        () => fail(new Error('輸出逾時，請重試。（E11）')),
        (plan.duration + 20) * 1000,
      );
      session.signal.addEventListener('abort', abort, { once: true });
      function frame() {
        if (settled) return;
        if (session.signal.aborted) return abort();
        const elapsed = Math.max(0, context.currentTime - startClock);
        if (elapsed >= plan.duration) {
          cleanup();
          resolve();
          return;
        }
        if (elapsed >= plan.remaining[audio]) audioGate!.gain.value = 0;
        for (let i = 0; i < clips.length; i++) {
          const video = clips[i].video;
          if (elapsed >= plan.remaining[i] && !video.paused) video.pause();
        }
        // A 60/120 Hz display does not need 60/120 canvas composites for a
        // 30 fps recording. Avoid duplicate drawing and frequent React renders.
        if (elapsed + 0.000001 >= nextDraw) {
          drawComposition(
            ctx,
            clips,
            boxes,
            width,
            height,
            elapsed,
            plan.remaining,
            order,
            textLayers,
          );
          nextDraw = (Math.floor(elapsed * 30 + 0.000001) + 1) / 30;
        }
        if (elapsed - lastReport >= 0.25) {
          onProgress(Math.min(0.99, elapsed / plan.duration));
          lastReport = elapsed;
        }
        raf = requestAnimationFrame(frame);
      }
      frame();
    });
    onStage('finalizing', '正在完成影片檔案…');
    onProgress(0.99);
    stopping = true;
    recorder.stop();
    const blob = await run(
      finished,
      15000,
      '影片封裝逾時，請重新融合。（E14）',
    );
    if (blob.size < 1000) throw new Error('沒有產生有效影片，請重試。（E15）');
    onProgress(1);
    return blob;
  } catch (error) {
    if (session.signal.aborted) throw abortReason(session.signal);
    throw error;
  } finally {
    stopping = true;
    session.abort();
    signal.removeEventListener('abort', cancel);
    document.removeEventListener('visibilitychange', visibility);
    try {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    } catch {
      /* Best-effort cleanup. */
    }
    if (audioGate) {
      audioGate.gain.value = 0;
      source?.disconnect(audioGate);
      audioGate.disconnect();
    }
    destination?.disconnect();
    stream?.getTracks().forEach((t) => t.stop());
    destination?.stream.getTracks().forEach((t) => t.stop());
    clips.forEach((c, i) => {
      c.video.pause();
      c.video.muted = true;
      c.video.playbackRate = 1;
      if (parents[i]) parents[i]!.appendChild(c.video);
    });
    void wake?.release().catch(() => {});
  }
}
