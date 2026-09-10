// All time values are seconds. Positive offset means B started later than A.
export function timeline(a, b, offset) {
  if (![a, b, offset].every(Number.isFinite) || a <= 0 || b <= 0)
    throw new Error('無效的影片時間');
  const starts = [Math.max(0, offset), Math.max(0, -offset)];
  const remaining = [a - starts[0], b - starts[1]];
  if (Math.min(...remaining) <= 0)
    throw new Error('這個時間差沒有共同片段，請重新調整。');
  return {
    starts,
    remaining,
    duration: Math.max(...remaining),
    overlap: Math.min(...remaining),
  };
}
export function isClipActive(time, remaining) {
  return time >= 0 && time < remaining;
}
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
