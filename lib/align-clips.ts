import { RATE, type Clip } from './media.ts';
export function alignClips(
  a: Clip,
  b: Clip,
  signal: AbortSignal,
  createWorker: () => Worker,
  matchSeconds = 0,
): Promise<{
  offset: number;
  score: number;
  margin: number;
  confident: boolean;
}> {
  return new Promise((resolve, reject) => {
    if (!a.mono || !b.mono) {
      reject(new Error('兩部影片都需要可辨識的聲音，或改用手動對齊。'));
      return;
    }
    if (signal.aborted) {
      reject(new DOMException('已取消', 'AbortError'));
      return;
    }
    let worker: Worker;
    try {
      worker = createWorker();
    } catch {
      reject(new Error('音訊分析程式無法啟動，請重新整理後再試。（W01）'));
      return;
    }
    let settled = false;
    const timer = setTimeout(
      () => finish(new Error('對齊逾時，請縮短影片或手動對齊。')),
      60000,
    );
    const cancel = () => finish(new DOMException('已取消', 'AbortError'));
    function finish(
      error?: Error,
      result?: {
        offset: number;
        score: number;
        margin: number;
        confident: boolean;
      },
    ) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      signal.removeEventListener('abort', cancel);
      if (error) reject(error);
      else resolve(result!);
    }
    worker.onmessage = (e) =>
      e.data.error
        ? finish(new Error(e.data.error))
        : finish(undefined, e.data.result);
    worker.onerror = () =>
      finish(new Error('音訊分析程式無法載入，請重新整理頁面後再試。（W02）'));
    worker.onmessageerror = () =>
      finish(new Error('音訊資料傳送失敗，請重新選擇影片。（W03）'));
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) return cancel();
    try {
      const ac = a.mono.slice(),
        bc = b.mono.slice();
      worker.postMessage({ a: ac, b: bc, rate: RATE, matchSeconds }, [
        ac.buffer,
        bc.buffer,
      ]);
    } catch {
      finish(new Error('音訊資料無法送出，請改用較短的影片。（W04）'));
    }
  });
}
