export function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('已取消', 'AbortError');
}
/** Bound every browser operation; media promises can remain pending on iOS. */
export function mediaDeadline<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(value as T);
    };
    const abort = () => finish(abortReason(signal));
    const timer = setTimeout(() => finish(new Error(message)), timeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    // Attach handlers even to an already-aborted operation to consume late failures.
    operation.then(
      (value) => finish(undefined, value),
      (error) => finish(error),
    );
    if (signal.aborted) abort();
  });
}
