import { Input, BlobSource, MP4, QTFF, AudioSampleSink } from 'mediabunny';
import { addSamples } from './audio-samples.ts';

/** Decode only the selected audio track. Keep presentation timestamps, including edit-list offsets. */
export async function decodeAudioTrack(
  file: Blob,
  duration: number,
  onProgress: (progress: number) => void,
): Promise<Float32Array> {
  if (!Number.isFinite(duration) || duration < 3 || duration > 600)
    throw new Error('Invalid media duration');
  const input = new Input({
    source: new BlobSource(file),
    formats: [MP4, QTFF],
  });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode()))
      throw new Error('Unsupported audio codec');
    const first = Math.max(0, await track.getFirstTimestamp());
    const end = Math.min(duration, await track.computeDuration());
    if (!Number.isFinite(first) || !Number.isFinite(end) || end - first < 1)
      throw new Error('Insufficient audio');
    const sums = new Float32Array(Math.ceil(duration * 16000));
    const counts = new Uint16Array(sums.length);
    const sink = new AudioSampleSink(track);
    let lastProgress = 0;
    for await (const sample of sink.samples()) {
      try {
        const {
          numberOfFrames: frames,
          numberOfChannels: channels,
          sampleRate,
          timestamp,
        } = sample;
        if (
          !Number.isFinite(timestamp) ||
          sampleRate < 16000 ||
          sampleRate > 192000 ||
          channels < 1 ||
          channels > 16 ||
          frames > sampleRate * 10
        )
          throw new Error('Invalid audio sample');
        const mono = new Float32Array(frames);
        const plane = new Float32Array(frames);
        for (let channel = 0; channel < channels; channel++) {
          sample.copyTo(plane, { format: 'f32-planar', planeIndex: channel });
          for (let i = 0; i < frames; i++) mono[i] += plane[i] / channels;
        }
        addSamples(sums, counts, mono, timestamp, sampleRate);
        if (performance.now() - lastProgress > 100) {
          onProgress(
            Math.max(
              0,
              Math.min(0.99, (timestamp + sample.duration) / duration),
            ),
          );
          lastProgress = performance.now();
        }
      } finally {
        sample.close();
      }
    }
    let received = 0,
      energy = 0;
    for (let i = 0; i < sums.length; i++) {
      if (counts[i]) {
        sums[i] /= counts[i];
        received++;
      }
      energy += sums[i] ** 2;
    }
    // A decoder which silently drops most packets must not populate the cache.
    if (
      received < (end - first) * 16000 * 0.95 ||
      !Number.isFinite(energy) ||
      energy / sums.length < 1e-10
    )
      throw new Error('Incomplete or silent audio');
    onProgress(1);
    return sums;
  } finally {
    input.dispose();
  }
}
