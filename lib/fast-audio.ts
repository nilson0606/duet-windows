import { abortReason } from './media-deadline.ts';

/** An isolated decoder can be terminated even if Safari never settles decode/flush. */
export function tryFastAudio(
  file: File,
  duration: number,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
  createWorker?: () => Worker,
  limits = { idleMs: 12000, totalMs: 45000 },
): Promise<Float32Array | null> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  if (!createWorker) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    let worker: Worker | undefined;
    let settled = false;
    let idle: ReturnType<typeof setTimeout>;
    const total = setTimeout(() => finish(null), limits.totalMs);
    function finish(mono: Float32Array | null, error?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(idle);
      clearTimeout(total);
      signal.removeEventListener('abort', abort);
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        worker.terminate();
      }
      if (error) reject(error);
      else resolve(mono);
    }
    function abort() {
      finish(null, abortReason(signal));
    }
    function heartbeat() {
      clearTimeout(idle);
      idle = setTimeout(() => finish(null), limits.idleMs);
    }
    signal.addEventListener('abort', abort, { once: true });
    try {
      worker = createWorker();
      worker.onmessage = ({ data }) => {
        if (data?.type === 'progress' && Number.isFinite(data.progress)) {
          heartbeat();
          onProgress(Math.max(0, Math.min(1, data.progress)));
        } else if (data?.type === 'done') {
          const mono = data.mono;
          finish(
            mono instanceof Float32Array &&
              mono.length === Math.ceil(duration * 16000)
              ? mono
              : null,
          );
        } else if (data?.type === 'fallback') finish(null);
      };
      worker.onerror = (event) => {
        event.preventDefault();
        finish(null);
      };
      worker.onmessageerror = () => finish(null);
      heartbeat();
      worker.postMessage({ file, duration });
      if (signal.aborted) abort();
    } catch {
      finish(null);
    }
  });
}
