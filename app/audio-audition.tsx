'use client';
/* oxlint-disable jsx-a11y/media-has-caption -- User videos used only for independent audio audition. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AuditionPlayer } from '../lib/audition-player';
import { captureClipAudio } from '../lib/capture-audio';
import type { Clip } from '../lib/media';
// oxlint-disable-next-line import/default -- Vite emits a browser worker URL.
import decodeWorkerUrl from './decode-audio.worker.ts?worker&url';

type Source = { file: File; url: string; duration: number } | null;
const names = ['A', 'B'];
const seconds = (n: number) => `${n.toFixed(2)} 秒`;
export function AudioAudition({
  sources,
  disabled,
}: {
  sources: Source[];
  disabled: boolean;
}) {
  const videos = useRef<(HTMLVideoElement | null)[]>([null, null]);
  const player = useRef<AuditionPlayer | null>(null);
  const initialSources = useRef(sources);
  const analysisHost = useRef<HTMLDivElement>(null);
  const [preparation, setPreparation] = useState('');
  const [playing, setPlaying] = useState([false, false]);
  const [positions, setPositions] = useState([0, 0]);
  const [ready, setReady] = useState([false, false]);
  const [offset, setOffset] = useState('0');
  const [start, setStart] = useState('0');
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const update = useCallback((index: number) => {
    const video = videos.current[index];
    if (!video || !mounted.current) return;
    setPlaying((old) =>
      old.map((value, i) =>
        i === index ? (player.current?.isPlaying(index) ?? false) : value,
      ),
    );
    setPositions((old) =>
      old.map((value, i) =>
        i === index
          ? (player.current?.position(index) ?? video.currentTime)
          : value,
      ),
    );
  }, []);
  useEffect(() => {
    mounted.current = true;
    const clips = initialSources.current.map((source, index) =>
      source
        ? ({
            ...source,
            video: videos.current[index]!,
            mono: null,
            peaks: [],
            width: 1,
            height: 1,
            thumbnail: '',
          } as Clip)
        : null,
    );
    player.current = new AuditionPlayer(
      videos.current.slice(),
      undefined,
      async (context, signal) => {
        await captureClipAudio(
          clips.filter((clip): clip is Clip => !!clip),
          context,
          signal,
          (index, progress, method) => {
            if (mounted.current)
              setPreparation(
                `${method === 'fast' ? '快速讀取' : '相容模式讀取'}影片 ${names[index]} 聲音 ${Math.round(progress * 100)}%`,
              );
          },
          analysisHost.current!,
          () =>
            new Worker(new URL(decodeWorkerUrl, window.location.href), {
              type: 'module',
            }),
        );
        return clips.map((clip) => clip!.mono!);
      },
    );
    const tick = setInterval(() => {
      for (const index of [0, 1]) {
        player.current?.syncPreview(index);
        update(index);
      }
    }, 100);
    const hide = () => {
      if (document.hidden) player.current?.pauseAll();
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      mounted.current = false;
      clearInterval(tick);
      document.removeEventListener('visibilitychange', hide);
      player.current?.dispose();
      player.current = null;
    };
  }, [update]);
  useEffect(() => {
    if (disabled) player.current?.pauseAll();
  }, [disabled]);
  async function play(index?: number) {
    if (disabled || preparing || !player.current) return;
    setError('');
    if (
      index === undefined &&
      (offset.trim() === '' ||
        start.trim() === '' ||
        !Number.isFinite(Number(offset)) ||
        !Number.isFinite(Number(start)))
    ) {
      setError('請輸入有效的試聽時間差與位置。');
      return;
    }
    setPreparing(true);
    try {
      if (index === undefined)
        await player.current.playTogether(Number(offset), Number(start));
      else await player.current.playOne(index);
    } catch (error) {
      if (
        mounted.current &&
        !(error instanceof DOMException && error.name === 'AbortError')
      )
        setError(
          error instanceof Error ? error.message : '試聽無法播放，請重試。',
        );
    } finally {
      if (mounted.current) {
        setPreparing(false);
        setPreparation('');
      }
    }
  }
  const locked = disabled || preparing;
  return (
    <section className="audition" aria-label="獨立雙影片試聽">
      <h3>雙影片試聽</h3>
      <p className="hint">僅供試聽，這裡的時間差不會套用到編輯。</p>
      <div className="audition-videos">
        {sources.map((source, index) => (
          <div className="audition-clip" key={names[index]}>
            <b>影片 {names[index]}</b>
            {source ? (
              <video
                ref={(node) => {
                  videos.current[index] = node;
                }}
                src={source.url}
                playsInline
                preload="metadata"
                aria-label={`影片 ${names[index]} 試聽畫面`}
                onLoadedMetadata={() =>
                  setReady((old) => old.map((v, i) => (i === index ? true : v)))
                }
                onPlay={() => update(index)}
                onPause={() => update(index)}
                onEnded={() => update(index)}
                onTimeUpdate={() => update(index)}
                onError={() => {
                  player.current?.pauseAll();
                  setError(`影片 ${names[index]} 無法試聽，請重新載入。`);
                }}
              />
            ) : (
              <div className="audition-empty">尚未載入</div>
            )}
            <button
              type="button"
              className="secondary"
              disabled={locked || !ready[index]}
              onClick={() =>
                playing[index]
                  ? player.current?.pauseOne(index)
                  : void play(index)
              }
            >
              {playing[index] ? '暫停' : '播放'} {names[index]}
            </button>
            <input
              type="range"
              min="0"
              max={Math.max(0, (source?.duration ?? 0) - 0.04)}
              step="0.02"
              aria-label={`影片 ${names[index]} 試聽位置`}
              value={positions[index]}
              disabled={locked || !ready[index]}
              onChange={(event) => {
                player.current?.seekOne(index, Number(event.target.value));
                update(index);
              }}
            />
            <span className="audition-time">
              {seconds(positions[index])} / {seconds(source?.duration ?? 0)}
            </span>
          </div>
        ))}
      </div>
      <label className="audition-field">
        試聽時間差（秒）
        <input
          type="number"
          step="0.02"
          value={offset}
          disabled={locked}
          onChange={(event) => {
            player.current?.pauseAll();
            setOffset(event.target.value);
          }}
        />
      </label>
      <p className="hint">正數讓 A 跳過開頭，負數讓 B 跳過開頭。</p>
      <label className="audition-field">
        共同試聽位置（秒）
        <input
          type="number"
          min="0"
          step="0.1"
          value={start}
          disabled={locked}
          onChange={(event) => {
            player.current?.pauseAll();
            setStart(event.target.value);
          }}
        />
      </label>
      <div className="audition-actions">
        <button
          type="button"
          disabled={locked || !ready.every(Boolean)}
          onClick={() => void play()}
        >
          {preparing ? '準備中…' : '同時播放'}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => player.current?.pauseAll()}
          disabled={disabled}
        >
          全部暫停
        </button>
      </div>
      <p className="hint">
        同時播放會從指定位置開始。首次需準備聲音；相容模式會依序讀取兩部影片，完成後可直接重播。
      </p>
      <div
        ref={analysisHost}
        className="audition-analysis"
        hidden={!preparing}
      />
      {preparation && (
        <output className="hint">{preparation}，請保持畫面開啟。</output>
      )}
      {error && (
        <p className="audition-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
