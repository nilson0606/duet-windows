import { seek } from './media.ts';
import { timeline } from './timeline.mjs';
import { abortReason, mediaDeadline } from './media-deadline.ts';
import { playerAudio, releasePlayerAudio } from './player-audio.ts';

type PlayingAudio = {
  node: AudioBufferSourceNode;
  when: number;
  offset: number;
};
type LoadAudio = (
  context: AudioContext,
  signal: AbortSignal,
) => Promise<Float32Array[]>;

/** Dedicated audition players. Simultaneous sound comes from one Web Audio clock. */
export class AuditionPlayer {
  private context: AudioContext | null = null;
  private volume: GainNode | null = null;
  private nativeGains: (GainNode | null)[] = [null, null];
  private buffers: AudioBuffer[] = [];
  private playing: (PlayingAudio | null)[] = [null, null];
  private operation: AbortController | null = null;
  private disposed = false;
  private videos: (HTMLVideoElement | null)[];
  private createContext: () => AudioContext;
  private loadAudio?: LoadAudio;
  constructor(
    videos: (HTMLVideoElement | null)[],
    createContext: () => AudioContext = () => new AudioContext(),
    loadAudio?: LoadAudio,
  ) {
    this.videos = videos;
    this.createContext = createContext;
    this.loadAudio = loadAudio;
  }
  private activate() {
    if (this.disposed) throw new Error('試聽已關閉。');
    if (!this.context) {
      this.context = this.createContext();
      this.volume = this.context.createGain();
      this.volume.gain.value = 0.5;
      this.volume.connect(this.context.destination);
    }
    return this.context.resume();
  }
  isPlaying(index: number) {
    return (
      !!this.playing[index] ||
      !!(this.videos[index] && !this.videos[index]!.paused && !this.operation)
    );
  }
  position(index: number) {
    const playing = this.playing[index];
    if (playing && this.context)
      return Math.min(
        this.buffers[index].duration,
        playing.offset + Math.max(0, this.context.currentTime - playing.when),
      );
    return this.videos[index]?.currentTime ?? 0;
  }
  /** Visual playback may be paused by iOS; it never controls the shared-clock sound. */
  syncPreview(index: number) {
    const video = this.videos[index];
    if (!video || !this.playing[index] || video.readyState < 1 || video.seeking)
      return;
    const time = this.position(index);
    if (Math.abs(video.currentTime - time) > 0.25)
      video.currentTime = Math.min(time, video.duration - 0.001);
  }
  private stopAudio(index: number) {
    const playing = this.playing[index];
    if (!playing) return;
    const time = this.position(index);
    this.playing[index] = null;
    playing.node.onended = null;
    playing.node.stop();
    playing.node.disconnect();
    const video = this.videos[index];
    if (video && video.readyState >= 1)
      video.currentTime = Math.min(time, video.duration - 0.001);
  }
  pauseAll() {
    this.operation?.abort();
    this.operation = null;
    this.videos.forEach((video, index) => {
      this.stopAudio(index);
      video?.pause();
    });
    if (this.volume) this.volume.gain.value = 0;
  }
  pauseOne(index: number) {
    if (this.operation) {
      this.pauseAll();
      return;
    }
    this.stopAudio(index);
    this.videos[index]?.pause();
  }
  seekOne(index: number, time: number) {
    this.pauseOne(index);
    const video = this.videos[index];
    if (!video || !Number.isFinite(time) || video.readyState < 1) return;
    video.currentTime = Math.max(0, Math.min(time, video.duration - 0.001));
  }
  private startAudio(index: number, offset: number, when: number) {
    const video = this.videos[index]!;
    this.stopAudio(index);
    if (this.nativeGains[index]) this.nativeGains[index]!.gain.value = 0;
    video.muted = true;
    const node = this.context!.createBufferSource();
    node.buffer = this.buffers[index];
    node.connect(this.volume!);
    const playing = { node, offset, when };
    this.playing[index] = playing;
    node.onended = () => {
      if (this.playing[index] !== playing) return;
      this.playing[index] = null;
      node.disconnect();
      video.pause();
      video.currentTime = Math.min(
        this.buffers[index].duration,
        video.duration - 0.001,
      );
    };
    node.start(when, offset);
    // These videos are only visual previews. A rejected/paused preview cannot stop audio.
    void video.play().catch(() => {});
  }
  async playOne(index: number) {
    const video = this.videos[index];
    if (!video) return;
    if (this.operation) this.pauseAll();
    const operation = new AbortController();
    this.operation = operation;
    try {
      const resumed = this.activate();
      if (video.ended || video.currentTime >= video.duration - 0.01)
        video.currentTime = 0;
      this.volume!.gain.value = 0.5;
      if (this.buffers[index]) {
        await mediaDeadline(
          resumed,
          operation.signal,
          10000,
          '試聽播放未啟動，請重試。',
        );
        this.startAudio(
          index,
          video.currentTime,
          this.context!.currentTime + 0.05,
        );
      } else {
        if (!this.nativeGains[index]) {
          const gain = this.context!.createGain();
          playerAudio(this.context!, video).connect(gain);
          gain.connect(this.volume!);
          this.nativeGains[index] = gain;
        }
        this.nativeGains[index]!.gain.value = 1;
        video.muted = false;
        await mediaDeadline(
          Promise.all([resumed, video.play()]),
          operation.signal,
          10000,
          '試聽播放未啟動，請再按一次播放。',
        );
      }
    } catch (error) {
      if (this.operation === operation) {
        this.stopAudio(index);
        video.pause();
      }
      throw error;
    } finally {
      if (this.operation === operation) this.operation = null;
    }
  }
  async playTogether(offset: number, position: number) {
    const [a, b] = this.videos;
    if (!a || !b) throw new Error('請先載入兩部影片。');
    const plan = timeline(a.duration, b.duration, offset);
    if (!Number.isFinite(position) || position < 0 || position >= plan.overlap)
      throw new Error('試聽位置須在兩部影片都有內容的範圍內。');
    this.pauseAll();
    const operation = new AbortController();
    this.operation = operation;
    try {
      const resumed = this.activate();
      this.volume!.gain.value = 0;
      this.nativeGains.forEach((gain) => {
        if (gain) gain.gain.value = 0;
      });
      if (!this.buffers.length) {
        if (!this.loadAudio) throw new Error('試聽聲音尚未準備好。');
        // Invoke within the tap gesture: the fallback loader primes muted video players.
        const loading = this.loadAudio(this.context!, operation.signal);
        const [, pcm] = await mediaDeadline(
          Promise.all([resumed, loading]),
          operation.signal,
          420000,
          '準備試聽逾時，請重試。',
        );
        if (operation.signal.aborted) throw abortReason(operation.signal);
        const buffers = pcm.map((mono, index) => {
          if (
            !mono.length ||
            mono.length !== Math.ceil(this.videos[index]!.duration * 16000)
          )
            throw new Error('試聽聲音不完整，請重試。');
          const buffer = this.context!.createBuffer(1, mono.length, 16000);
          buffer.getChannelData(0).set(mono);
          return buffer;
        });
        if (buffers.length !== 2) throw new Error('試聽聲音不完整，請重試。');
        this.buffers = buffers;
      } else
        await mediaDeadline(
          resumed,
          operation.signal,
          10000,
          '試聽播放未啟動，請重試。',
        );
      a.muted = b.muted = true;
      await Promise.all(
        [a, b].map((video, index) =>
          seek(video, plan.starts[index] + position, operation.signal),
        ),
      );
      if (operation.signal.aborted) throw abortReason(operation.signal);
      await mediaDeadline(
        this.context!.resume(),
        operation.signal,
        10000,
        '試聽播放未啟動，請重試。',
      );
      if (operation.signal.aborted) throw abortReason(operation.signal);
      const when = this.context!.currentTime + 0.05;
      this.startAudio(0, plan.starts[0] + position, when);
      this.startAudio(1, plan.starts[1] + position, when);
      this.volume!.gain.value = 0.5;
    } catch (error) {
      if (this.operation === operation) this.pauseAll();
      throw error;
    } finally {
      if (this.operation === operation) this.operation = null;
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.pauseAll();
    this.videos.forEach((video) => {
      if (video) releasePlayerAudio(video);
    });
    this.nativeGains.forEach((gain) => gain?.disconnect());
    this.volume?.disconnect();
    this.buffers = [];
    void this.context?.close().catch(() => {});
  }
}
