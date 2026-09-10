const RATE = 16000;

// Place samples by media timestamps, not arrival time or the duration of a stall.
export function addSamples(
  sums: Float32Array,
  counts: Uint16Array,
  data: Float32Array,
  mediaTime: number,
  inputRate: number,
  rate = RATE,
) {
  for (let i = 0; i < data.length; i++) {
    const at = Math.floor((mediaTime + i / inputRate) * rate + 1e-6);
    if (at < 0 || at >= sums.length) continue;
    sums[at] += data[i];
    counts[at]++;
  }
}
