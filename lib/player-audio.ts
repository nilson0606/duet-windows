// Each media element may be attached to Web Audio only once. Reuse the same
// context and source for analysis, retries and export (as in nivitrack iPhone).
const sources = new WeakMap<
  HTMLVideoElement,
  {
    context: AudioContext;
    source: MediaElementAudioSourceNode;
    monitor: GainNode;
  }
>();
export function playerAudio(context: AudioContext, video: HTMLVideoElement) {
  const existing = sources.get(video);
  if (existing) {
    if (existing.context !== context)
      throw new Error('音訊工作階段已變更，請重新匯入影片。');
    return existing.source;
  }
  const source = context.createMediaElementSource(video);
  const monitor = context.createGain();
  monitor.gain.value = 0;
  source.connect(monitor);
  monitor.connect(context.destination);
  sources.set(video, { context, source, monitor });
  return source;
}
export function releasePlayerAudio(video: HTMLVideoElement) {
  const entry = sources.get(video);
  if (!entry) return;
  entry.source.disconnect();
  entry.monitor.disconnect();
  sources.delete(video);
}
