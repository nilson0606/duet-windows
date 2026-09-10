import { decodeAudioTrack } from '../lib/decode-audio-track';
self.onmessage = async ({ data }) => {
  try {
    const mono = await decodeAudioTrack(data.file, data.duration, (progress) =>
      self.postMessage({ type: 'progress', progress }),
    );
    self.postMessage({ type: 'done', mono }, { transfer: [mono.buffer] });
  } catch {
    // Includes EncodingError / decoding failed; the main thread uses the player.
    self.postMessage({ type: 'fallback' });
  }
};
