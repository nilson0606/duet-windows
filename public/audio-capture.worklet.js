// Collect PCM from the media player's decoder, without decodeAudioData.
class DuetAudioCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = false;
    this.offset = 0;
    this.samples = new Float32Array(2048);
    this.used = 0;
    this.startTime = 0;
    this.port.onmessage = ({ data }) => {
      this.flush();
      this.active = data.type === 'start';
      if (this.active) this.offset = data.mediaTime - data.contextTime;
      if (data.type === 'finish') this.port.postMessage({ type: 'done' });
    };
  }
  flush() {
    if (!this.used) return;
    const samples = this.samples.slice(0, this.used);
    this.port.postMessage(
      { type: 'samples', samples, mediaTime: this.startTime, rate: sampleRate },
      [samples.buffer],
    );
    this.used = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (!this.active || !channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      if (!this.used)
        this.startTime = (currentFrame + i) / sampleRate + this.offset;
      let value = 0;
      for (const channel of channels) value += channel[i] / channels.length;
      this.samples[this.used++] = value;
      if (this.used === this.samples.length) this.flush();
    }
    // Output is deliberately silent; the PCM above is taken before muting.
    return true;
  }
}
registerProcessor('duet-audio-capture', DuetAudioCapture);
