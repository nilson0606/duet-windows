'use client';
/* oxlint-disable next/no-img-element -- Thumbnails are local data URLs; they must never go through a server image optimizer. */
/* oxlint-disable jsx-a11y/media-has-caption -- This is a user-supplied video editing preview; no caption track is available. */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { CropEditor } from './crop-editor';
import { AudioAudition } from './audio-audition';
import { TextOverlayStage, TextOverlayControls } from './text-overlays';
import type { TextLayer } from '../lib/text-overlay';
import { FULL_CROP, cropImageStyle, type Crop } from '../lib/crop';
import { renderMovie, type ExportPhase } from '../lib/render-movie';
import {
  Layers2,
  Plus,
  AudioLines,
  Move,
  ArrowUpRight,
  FlaskConical,
  Check,
  SlidersHorizontal,
  Download,
  X,
  LoaderCircle,
  Grip,
  Volume2,
} from 'lucide-react';
import {
  disposeClip,
  loadClip,
  seek,
  snapshot,
  supportedMime,
  type Clip,
  type Box,
} from '../lib/media';
import { keyboardMove } from '../lib/desktop-controls';
import { timeline, clamp } from '../lib/timeline.mjs';
import { alignClips } from '../lib/align-clips';
import { captureClipAudio } from '../lib/capture-audio';
// oxlint-disable-next-line import/default -- Vite emits this worker URL as a virtual default export.
import analysisWorkerUrl from './align.worker.ts?worker&url';
// oxlint-disable-next-line import/default -- Vite emits the isolated audio decoder URL.
import decodeWorkerUrl from './decode-audio.worker.ts?worker&url';
const names = ['A', 'B'];
const subscribeCapabilities = () => () => {};
function readExportFormat() {
  const mime = supportedMime();
  if (
    !mime ||
    typeof AudioContext === 'undefined' ||
    typeof HTMLCanvasElement.prototype.captureStream !== 'function'
  )
    return 'unsupported';
  return mime.includes('mp4') ? 'MP4' : 'WebM';
}
const sec = (n: number) => `${n.toFixed(2)} 秒`;
function Wave({ peaks, color }: { peaks: number[]; color: string }) {
  const max = Math.max(0.001, ...peaks);
  return (
    <svg
      className="wave"
      viewBox="0 0 256 34"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {peaks.map((p, i) => (
        <rect
          key={i}
          x={i * 4}
          y={17 - Math.max(1, (p / max) * 15)}
          width="2"
          height={Math.max(2, (p / max) * 30)}
          rx="1"
          fill={color}
        />
      ))}
    </svg>
  );
}
export default function Home() {
  const [clips, setClips] = useState<(Clip | null)[]>([null, null]);
  const clipRef = useRef<(Clip | null)[]>([null, null]);
  const [busy, setBusy] = useState('');
  const busyRef = useRef(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [dragTarget, setDragTarget] = useState<number | null>(null);
  const exportFormat = useSyncExternalStore(
    subscribeCapabilities,
    readExportFormat,
    () => '',
  );
  const exportSupported = exportFormat !== 'unsupported';
  const [aligned, setAligned] = useState(false);
  const [matchSeconds, setMatchSeconds] = useState(0);
  const [offset, setOffset] = useState(0);
  const [manual, setManual] = useState('0');
  const [alignment, setAlignment] = useState<{
    score: number;
    confident: boolean;
  } | null>(null);
  const [ratio, setRatio] = useState('16:9');
  const [boxes, setBoxes] = useState<Box[]>([
    { x: 0, y: 0.25, width: 0.5, height: 0.5 },
    { x: 0.5, y: 0.25, width: 0.5, height: 0.5 },
  ]);
  const [selected, setSelected] = useState(0);
  const [textLayers, setTextLayers] = useState<TextLayer[]>([]);
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [lockAspect, setLockAspect] = useState(true);
  const [order, setOrder] = useState([0, 1]);
  const [audio, setAudio] = useState(0);
  const [progress, setProgress] = useState(0);
  const [quality, setQuality] = useState('720');
  const [exportPhase, setExportPhase] = useState<ExportPhase>('preparing');
  const [exportMessage, setExportMessage] = useState('');
  const exportDialog = useRef<HTMLDialogElement>(null);
  const exportCanvas = useRef<HTMLCanvasElement>(null);
  const sourceHost = useRef<HTMLDivElement>(null);
  const analysisHost = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<{
    url: string;
    blob: Blob;
    file: File;
  } | null>(null);
  const resultRef = useRef<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const stage = useRef<HTMLDivElement>(null),
    controller = useRef<AbortController | null>(null),
    context = useRef<AudioContext | null>(null);
  const mounted = useRef(true);
  const apiRef = useRef({ aligned: false, offset: 0, duration: 0, loaded: 0 });
  const short = quality === '1080' ? 1080 : quality === '480' ? 480 : 720,
    long = quality === '1080' ? 1920 : quality === '480' ? 854 : 1280;
  const dims =
    ratio === '9:16'
      ? [short, long]
      : ratio === '1:1'
        ? [short, short]
        : [long, short];
  let plan: {
    starts: number[];
    remaining: number[];
    duration: number;
    overlap: number;
  } | null = null;
  try {
    if (clips[0] && clips[1])
      plan = timeline(clips[0].duration, clips[1].duration, offset);
  } catch {}
  const duration = plan?.duration ?? 0;
  useEffect(() => {
    apiRef.current = {
      aligned,
      offset,
      duration,
      loaded: clips.filter(Boolean).length,
    };
  }, [aligned, offset, duration, clips]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
      clipRef.current.forEach((c) => {
        if (c) disposeClip(c);
      });
      if (resultRef.current) URL.revokeObjectURL(resultRef.current);
      void context.current?.close().catch(() => {});
    };
  }, []);
  useEffect(() => {
    type Registry = {
      registerTool: (
        tool: unknown,
        options: { signal: AbortSignal },
      ) => unknown;
    };
    const registry = (document as Document & { modelContext?: Registry })
      .modelContext;
    if (!registry?.registerTool) return;
    const life = new AbortController();
    try {
      void Promise.resolve(
        registry.registerTool(
          {
            name: 'read_video_composition_status',
            description:
              'Read loaded clip count, audio offset and composition duration. Does not access video content.',
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
            annotations: { readOnlyHint: true },
            execute: (input: unknown) => {
              if (
                !input ||
                typeof input !== 'object' ||
                Object.keys(input).length
              )
                throw new Error('Expected an empty object');
              return { ...apiRef.current };
            },
          },
          { signal: life.signal },
        ),
      ).catch(() => {});
    } catch {}
    return () => life.abort();
  }, []);
  function clearResult() {
    if (resultRef.current) URL.revokeObjectURL(resultRef.current);
    resultRef.current = null;
    setResult(null);
  }
  function start(label: string) {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(label);
    setError('');
    setMessage('');
    controller.current = new AbortController();
    return true;
  }
  function end() {
    busyRef.current = false;
    setBusy('');
  }
  function report(e: unknown) {
    if (e instanceof DOMException && e.name === 'AbortError')
      setMessage('已取消。');
    else setError(e instanceof Error ? e.message : '操作失敗，請重試。');
  }
  function preset(kind: string, items = clipRef.current, currentRatio = ratio) {
    const [w, h] =
      currentRatio === '9:16'
        ? [720, 1280]
        : currentRatio === '1:1'
          ? [720, 720]
          : [1280, 720];
    const aspect = w / h;
    const fit = (i: number, x: number, y: number, cw: number, ch: number) => {
      const c = items[i];
      const crop = c?.crop ?? FULL_CROP;
      const r = c ? (c.width * crop.width) / (c.height * crop.height) : 16 / 9;
      let width = cw,
        height = (width * aspect) / r;
      if (height > ch) {
        height = ch;
        width = (height * r) / aspect;
      }
      return {
        x: x + (cw - width) / 2,
        y: y + (ch - height) / 2,
        width,
        height,
      };
    };
    const next =
      kind === 'pip'
        ? [fit(0, 0, 0, 1, 1), fit(1, 0.62, 0.6, 0.34, 0.34)]
        : kind === 'stack'
          ? [fit(0, 0, 0, 1, 0.5), fit(1, 0, 0.5, 1, 0.5)]
          : [fit(0, 0, 0, 0.5, 1), fit(1, 0.5, 0, 0.5, 1)];
    setBoxes(next);
    setOrder([0, 1]);
    clearResult();
  }
  async function importOne(file: File, index: number) {
    if (busyRef.current) return;
    if (!start(`讀取影片 ${names[index]}…`)) return;
    try {
      const clip = await loadClip(file);
      if (!mounted.current) {
        disposeClip(clip);
        return;
      }
      const old = clipRef.current[index];
      if (old) {
        disposeClip(old);
      }
      const next = [...clipRef.current];
      next[index] = clip;
      clipRef.current = next;
      setClips(next);
      setAligned(false);
      setAlignment(null);
      setOffset(0);
      setManual('0');
      setPlayhead(0);
      clearResult();
      preset('side', next);
      if (clip.audioError) setError(clip.audioError);
    } catch (e) {
      report(e);
    } finally {
      end();
    }
  }
  async function demo() {
    if (!start('載入測試影片…')) return;
    const loaded: Clip[] = [];
    try {
      for (const name of names) {
        const response = await fetch(new URL(`demo/camera-${name.toLowerCase()}.mp4`, document.baseURI));
        if (!response.ok) throw new Error('測試影片載入失敗，請稍後重試。');
        loaded.push(
          await loadClip(
            new File([await response.blob()], `測試視角 ${name}.mp4`, {
              type: 'video/mp4',
            }),
          ),
        );
      }
      if (!mounted.current) throw new DOMException('已取消', 'AbortError');
      clipRef.current.forEach((c) => {
        if (c) {
          disposeClip(c);
        }
      });
      clipRef.current = loaded;
      setClips(loaded);
      setAligned(false);
      setAlignment(null);
      setOffset(0);
      setManual('0');
      setPlayhead(0);
      clearResult();
      preset('side', loaded);
      const audioErrors = loaded.flatMap((clip, i) =>
        clip.audioError ? [`影片 ${names[i]}：${clip.audioError}`] : [],
      );
      if (audioErrors.length) setError(audioErrors.join(' '));
      setMessage(
        '已載入實際測試影片：B 從較後面的歌曲段落開始（差 2.34 秒），且比 A 早結束，兩段都有獨立噪音。按下音訊對齊試試看。',
      );
    } catch (e) {
      loaded.forEach(disposeClip);
      report(e);
    } finally {
      end();
    }
  }
  async function updateFrames(time: number, newOffset = offset) {
    const items = clipRef.current;
    if (!items[0] || !items[1]) return;
    const p = timeline(items[0].duration, items[1].duration, newOffset);
    const thumbs = await Promise.all(
      items.map(async (c, i) => {
        await seek(c!.video, Math.min(p.starts[i] + time, c!.duration - 0.04));
        return snapshot(c!.video);
      }),
    );
    const next = items.map((c, i) => ({
      ...c!,
      thumbnail: thumbs[i],
      alignedThumbnail: time === 0 ? thumbs[i] : c!.alignedThumbnail,
    }));
    clipRef.current = next;
    setClips(next);
    setPlayhead(time);
  }
  async function autoAlign() {
    if (
      !clips[0] ||
      !clips[1] ||
      !start(
        matchSeconds === 0
          ? '尋找音訊對齊點…'
          : `比對全段音樂，以 ${matchSeconds} 秒片段確認…`,
      )
    )
      return;
    try {
      context.current ??= new AudioContext();
      await captureClipAudio(
        clips as Clip[],
        context.current,
        controller.current!.signal,
        (index, progress, method) =>
          setBusy(
            method === 'fast'
              ? `快速讀取影片 ${names[index]} 聲音 ${Math.round(progress * 100)}%…`
              : `改用相容模式讀取影片 ${names[index]} 聲音 ${Math.round(progress * 100)}%…請保持畫面開啟`,
          ),
        analysisHost.current!,
        () =>
          new Worker(new URL(decodeWorkerUrl, window.location.href), {
            type: 'module',
          }),
      );
      setBusy(
        matchSeconds === 0
          ? '尋找音訊對齊點…'
          : `比對全段音樂，以 ${matchSeconds} 秒片段確認…`,
      );
      const result = await alignClips(
        clips[0],
        clips[1],
        controller.current!.signal,
        () =>
          new Worker(new URL(analysisWorkerUrl, window.location.href), {
            type: 'module',
          }),
        matchSeconds,
      );
      timeline(clips[0].duration, clips[1].duration, result.offset);
      setOffset(result.offset);
      setManual(result.offset.toFixed(2));
      setAlignment(result);
      await updateFrames(0, result.offset);
      setAligned(result.confident);
      clearResult();
      setMessage(
        result.confident
          ? '已對齊。前端不同步的部分會裁掉，較短影片結束後顯示黑幕。'
          : '尚未找到明確 match。可更換比對秒數，再按「用音訊自動對齊」重試；也可手動調整時間差。',
      );
    } catch (e) {
      report(e);
    } finally {
      void context.current?.suspend().catch(() => {});
      end();
    }
  }
  async function applyManual() {
    const value = Number(manual);
    if (manual.trim() === '' || !Number.isFinite(value)) {
      setError('請輸入有效的秒數。');
      return;
    }
    if (!start('更新同步畫面…')) return;
    try {
      if (!clips[0] || !clips[1]) throw new Error('請先選擇兩部影片。');
      timeline(clips[0].duration, clips[1].duration, value);
      await updateFrames(0, value);
      setOffset(value);
      setAligned(true);
      setAlignment(null);
      clearResult();
      setMessage('已套用手動時間差。');
    } catch (e) {
      report(e);
    } finally {
      end();
    }
  }
  async function scrub(value: number) {
    if (seeking || busyRef.current) return;
    setSeeking(true);
    busyRef.current = true;
    try {
      await updateFrames(value);
    } catch (e) {
      report(e);
    } finally {
      busyRef.current = false;
      setSeeking(false);
    }
  }
  function applyCrop(crop: Crop) {
    if (busyRef.current || seeking) return;
    const clip = clipRef.current[selected];
    if (!clip) return;
    const previous = clip.crop ?? FULL_CROP;
    const next = clipRef.current.map((c, i) =>
      i === selected ? { ...clip, crop } : c,
    );
    clipRef.current = next;
    setClips(next);
    setBoxes((old) =>
      old.map((b, i) => {
        if (i !== selected) return b;
        const width = (b.width * crop.width) / previous.width;
        const height = (b.height * crop.height) / previous.height;
        return { ...b, width, height };
      }),
    );
    clearResult();
    setMessage(
      '已套用影片 ' + names[selected] + ' 的畫面裁切，可繼續調整大小與位置。',
    );
  }
  function changeTextLayers(next: TextLayer[]) {
    if (busyRef.current || seeking) return;
    setTextLayers(next);
    clearResult();
  }
  function changeBox(next: Box) {
    setBoxes((old) => old.map((b, i) => (i === selected ? next : b)));
    clearResult();
  }
  function pointerDown(
    e: React.PointerEvent,
    index: number,
    mode: 'move' | 'corner' | 'left' | 'right' | 'top' | 'bottom' = 'move',
  ) {
    if (!aligned || busy || seeking) return;
    e.preventDefault();
    e.stopPropagation();
    setSelected(index);
    setSelectedText(null);
    const el = e.currentTarget as HTMLElement;
    el.closest<HTMLButtonElement>('button.video-box')?.focus({
      preventScroll: true,
    });
    el.setPointerCapture(e.pointerId);
    const bounds = stage.current!.getBoundingClientRect(),
      original = { ...boxes[index] },
      startX = e.clientX,
      startY = e.clientY;
    clearResult();
    const move = (ev: PointerEvent) => {
      let next: Box;
      const dx = (ev.clientX - startX) / bounds.width;
      const dy = (ev.clientY - startY) / bounds.height;
      if (mode === 'left' || mode === 'right') {
        // Edge handles only alter this axis, even when corner aspect lock is on.
        const width = clamp(
          original.width + (mode === 'left' ? -dx : dx),
          0.05,
          2,
        );
        next = {
          ...original,
          width,
          x: mode === 'left' ? original.x + original.width - width : original.x,
        };
      } else if (mode === 'top' || mode === 'bottom') {
        const height = clamp(
          original.height + (mode === 'top' ? -dy : dy),
          0.05,
          2,
        );
        next = {
          ...original,
          height,
          y:
            mode === 'top' ? original.y + original.height - height : original.y,
        };
      } else if (mode === 'corner') {
        const width = clamp(
          original.width + (ev.clientX - startX) / bounds.width,
          0.1,
          2,
        );
        const height = lockAspect
          ? (original.height * width) / original.width
          : clamp(
              original.height + (ev.clientY - startY) / bounds.height,
              0.05,
              2,
            );
        next = { ...original, width, height };
      } else
        next = {
          ...original,
          x: clamp(
            original.x + (ev.clientX - startX) / bounds.width,
            -original.width + 0.03,
            0.97,
          ),
          y: clamp(
            original.y + (ev.clientY - startY) / bounds.height,
            -original.height + 0.03,
            0.97,
          ),
        };
      setBoxes((old) => old.map((b, i) => (i === index ? next : b)));
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
  async function fuse() {
    if (!aligned || !clips[0] || !clips[1] || seeking || busyRef.current)
      return;
    flushSync(() => {
      start('融合影片中…');
      clearResult();
      setProgress(0);
      setExportPhase('preparing');
      setExportMessage('正在啟動影片與音訊…');
    });
    let jobContext: AudioContext | null = null;
    try {
      if (!exportDialog.current?.open) {
        if (exportDialog.current?.showModal) exportDialog.current.showModal();
        else exportDialog.current?.setAttribute('open', '');
      }
      // Stay in the tap gesture until resume() and both play() calls are issued.
      context.current ??= new AudioContext();
      jobContext = context.current;
      const blob = await renderMovie({
        clips: clips as Clip[],
        boxes,
        order,
        textLayers,
        offset,
        width: dims[0],
        height: dims[1],
        audio,
        context: jobContext,
        canvas: exportCanvas.current!,
        sourceHost: sourceHost.current!,
        signal: controller.current!.signal,
        onProgress: setProgress,
        onStage: (phase, message) => {
          setExportPhase(phase);
          setExportMessage(message);
        },
      });
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
      const file = new File(
        [blob],
        '合拍-' + new Date().toISOString().replace(/[:.]/g, '-') + '.' + ext,
        { type: blob.type },
      );
      const url = URL.createObjectURL(blob);
      resultRef.current = url;
      setResult({ url, blob, file });
      setExportPhase('done');
      setExportMessage('融合完成，播放確認後即可下載影片。');
      setMessage('融合完成！播放確認後，即可下載到電腦。');
    } catch (e) {
      const cancelled = e instanceof DOMException && e.name === 'AbortError';
      setExportPhase(cancelled ? 'cancelled' : 'error');
      setExportMessage(
        cancelled
          ? '已取消融合，原始影片和配置仍保留。'
          : e instanceof Error
            ? e.message
            : '融合失敗，請再試一次。',
      );
      report(e);
    } finally {
      if (jobContext) void jobContext.suspend().catch(() => {});
      end();
    }
  }
  const locked = !!busy || seeking;
  const exporting =
    !!busy && ['preparing', 'recording', 'finalizing'].includes(exportPhase);
  return (
    <main>
      <header className="topbar">
        <div className="brand">
          <Layers2 />
          <b>
            合拍<span>DUET</span>
            <small className="platform-label">Windows</small>
          </b>
        </div>
        <span className="local-badge">
          <i /> 影片留在你的裝置
        </span>
      </header>
      <div className="intro">
        <div>
          <h1>雙影片工作台</h1>
          <p className="workspace-caption">
            匯入影片、對齊音樂，自由構圖後下載成品。
          </p>
        </div>
        <button className="secondary" onClick={demo} disabled={locked}>
          <FlaskConical size={17} />
          載入測試影片
        </button>
      </div>
      <nav className="steps" aria-label="工作步驟">
        <span className={!aligned ? 'active' : ''}>
          <b>{aligned ? <Check size={14} /> : '01'}</b> 匯入與對齊
        </span>
        <span className={aligned && !result ? 'active' : ''}>
          <b>02</b> 調整畫面
        </span>
        <span className={result ? 'active' : ''}>
          <b>03</b> 融合與輸出
        </span>
      </nav>
      {(busy || message || error) && (
        <div
          className={`notice ${error ? 'error' : ''}`}
          role={error ? 'alert' : 'status'}
          aria-live="polite"
        >
          {busy ? (
            <LoaderCircle className="spin" size={17} />
          ) : error ? (
            <X size={17} />
          ) : (
            <Check size={17} />
          )}
          <span>{busy || error || message}</span>
          {busy &&
            (busy.includes('比對') ||
              busy.includes('融合') ||
              busy.includes('聲音') ||
              busy.includes('對齊點')) && (
              <button
                onClick={() => controller.current?.abort()}
                className="small-button"
              >
                取消
              </button>
            )}
        </div>
      )}
      {!exportSupported && (
        <p className="notice error" role="alert">
          此瀏覽器缺少影片輸出功能，請使用支援錄製的 Chrome 或 Edge 開啟。
        </p>
      )}
      <div className="workspace">
        <aside className="panel">
          <h2>
            來源影片<span>01 / SOURCE</span>
          </h2>
          <fieldset
            className="match-options"
            disabled={locked}
            aria-describedby="match-length-hint"
          >
            <legend>音樂確認片段長度</legend>
            <div className="match-options-row">
              {[0, 1, 2, 3, 4, 5].map((seconds) => (
                <label key={seconds}>
                  <input
                    type="radio"
                    name="match-seconds"
                    value={seconds}
                    checked={matchSeconds === seconds}
                    onChange={() => setMatchSeconds(seconds)}
                  />
                  <span>{seconds === 0 ? '自動' : `${seconds} 秒`}</span>
                </label>
              ))}
            </div>
            <p className="hint" id="match-length-hint">
              {matchSeconds === 0
                ? '全段音樂找時間差，自動選擇明確片段確認。'
                : `全段音樂找時間差，再用 ${matchSeconds} 秒片段確認。`}
              局部拍手、說話或尾段不同，不會直接否決。結果不理想可換秒數重試。
            </p>
          </fieldset>
          <div
            ref={analysisHost}
            className="analysis-sources"
            aria-label="音訊讀取中的影片"
          />
          <div className="sources">
            {clips.map((clip, i) => (
              <div key={i} className="source-item">
                <label
                  className={`upload ${clip ? 'loaded' : ''} ${locked ? 'locked' : ''} ${dragTarget === i ? 'drag-over' : ''}`}
                >
                  <span className={`clip-badge ${names[i]}`}>{names[i]}</span>
                  {clip ? (
                    <>
                      <img
                        src={clip.thumbnail}
                        alt={`來源影片 ${names[i]} 縮圖`}
                      />
                      <span className="replace">更換影片</span>
                    </>
                  ) : (
                    <>
                      <Plus />
                      <b>選擇影片 {names[i]}</b>
                      <small>點選或拖放一支影片</small>
                    </>
                  )}
                  <input
                    type="file"
                    accept="video/*,.mov,.mp4,.m4v,.webm"
                    aria-label={`選擇影片 ${names[i]}`}
                    disabled={locked}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = locked ? 'none' : 'copy';
                      if (!locked) setDragTarget(i);
                    }}
                    onDragLeave={(e) => {
                      if (
                        !e.currentTarget.contains(
                          e.relatedTarget as Node | null,
                        )
                      )
                        setDragTarget(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragTarget(null);
                      if (locked) return;
                      const files = e.dataTransfer.files;
                      if (files.length !== 1) {
                        setError('請將一支影片拖入 A 或 B 的匯入區。');
                        return;
                      }
                      void importOne(files[0], i);
                    }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void importOne(file, i);
                      e.target.value = '';
                    }}
                  />
                </label>
                {clip && (
                  <div className="clip-info">
                    <b title={clip.file.name}>{clip.file.name}</b>
                    <span>
                      {sec(clip.duration)} · {clip.width} × {clip.height}
                    </span>
                    {clip.mono ? (
                      <>
                        <Wave
                          peaks={clip.peaks}
                          color={i ? '#8cd0f5' : '#d5fb80'}
                        />
                        <span>
                          {clip.audioReadMethod === 'fast'
                            ? '快速讀取完成'
                            : '相容模式讀取完成'}
                          ，可直接換秒數重試
                        </span>
                      </>
                    ) : (
                      <span>按自動對齊後讀取聲音</span>
                    )}
                    {clip.audioError && <small>{clip.audioError}</small>}
                  </div>
                )}
              </div>
            ))}
          </div>
          <button
            className="primary"
            disabled={locked || !clips[0] || !clips[1]}
            onClick={autoAlign}
          >
            <AudioLines size={18} />
            用音訊自動對齊
          </button>
          <p className="hint">
            優先快速讀取音軌；格式不支援時自動改用相容模式，依原速播放讀取。請保持畫面開啟，完成後換秒數可直接重試。
          </p>
          {clips.every(Boolean) && (
            <details
              className="manual"
              open={alignment?.confident === false || undefined}
            >
              <summary>
                <SlidersHorizontal size={15} />
                手動調整時間差
              </summary>
              <p className="hint">
                正數裁 A 開頭，負數裁 B 開頭。比對歌曲段落，與實際拍攝時間無關。
              </p>
              <div className="manual-input">
                <label htmlFor="offset">音樂時間差（秒）</label>
                <input
                  id="offset"
                  type="number"
                  step="0.02"
                  value={manual}
                  disabled={locked}
                  onChange={(e) => setManual(e.target.value)}
                />
              </div>
              <button
                className="secondary"
                onClick={applyManual}
                disabled={locked}
              >
                套用時間差
              </button>
            </details>
          )}
        </aside>
        <section className="editor">
          <div className="editor-head">
            <h2>畫面配置</h2>
            <label className="format">
              畫布
              <select
                value={ratio}
                disabled={locked}
                onChange={(e) => {
                  setRatio(e.target.value);
                  preset(
                    e.target.value === '9:16' ? 'stack' : 'side',
                    clips,
                    e.target.value,
                  );
                }}
              >
                <option value="16:9">16 : 9 橫式</option>
                <option value="9:16">9 : 16 直式</option>
                <option value="1:1">1 : 1 方形</option>
              </select>
            </label>
          </div>
          <div className="stage-wrap">
            <div
              ref={stage}
              className="stage"
              style={{
                aspectRatio: `${dims[0]} / ${dims[1]}`,
                maxWidth: ratio === '9:16' ? 360 : undefined,
              }}
            >
              {aligned && plan ? (
                order.map((i) => {
                  const b = boxes[i];
                  const black = playhead >= plan!.remaining[i];
                  return (
                    <button
                      key={i}
                      disabled={locked}
                      className={`video-box ${selected === i && !selectedText ? 'selected' : ''} ${i ? 'blue' : ''}`}
                      aria-label={`影片 ${names[i]}，方向鍵移動畫面`}
                      style={{
                        left: `${b.x * 100}%`,
                        top: `${b.y * 100}%`,
                        width: `${b.width * 100}%`,
                        height: `${b.height * 100}%`,
                      }}
                      onPointerDown={(e) => pointerDown(e, i)}
                      onFocus={() => {
                        setSelected(i);
                        setSelectedText(null);
                      }}
                      onKeyDown={(e) => {
                        if (locked) return;
                        const next = keyboardMove(
                          boxes[i],
                          e.key,
                          e.shiftKey,
                          dims[0],
                          dims[1],
                        );
                        if (next) {
                          e.preventDefault();
                          setBoxes((old) =>
                            old.map((box, j) => (j === i ? next : box)),
                          );
                          clearResult();
                        }
                      }}
                    >
                      {!black && (
                        <span className="cropped-frame">
                          <img
                            src={clips[i]!.thumbnail}
                            draggable={false}
                            style={cropImageStyle(clips[i]!.crop ?? FULL_CROP)}
                            alt={`對齊後影片 ${names[i]} 的畫面`}
                          />
                        </span>
                      )}
                      <span className={`clip-badge ${names[i]}`}>
                        {names[i]}
                      </span>
                      {black && <span className="black-label">已結束</span>}
                      {selected === i && !selectedText && (
                        <>
                          {(['left', 'right', 'top', 'bottom'] as const).map(
                            (edge) => (
                              <span
                                key={edge}
                                className={'edge-handle edge-' + edge}
                                aria-hidden="true"
                                title={
                                  edge === 'left' || edge === 'right'
                                    ? '獨立調整寬度'
                                    : '獨立調整高度'
                                }
                                onPointerDown={(e) => pointerDown(e, i, edge)}
                              />
                            ),
                          )}
                          <span
                            className="resize-handle"
                            aria-hidden="true"
                            onPointerDown={(e) => pointerDown(e, i, 'corner')}
                          >
                            <Grip size={13} />
                          </span>
                        </>
                      )}
                    </button>
                  );
                })
              ) : (
                <div className="empty-stage">
                  <Layers2 size={38} />
                  <b>兩個視角，一個畫面</b>
                  <p>匯入並對齊影片後，在這裡自由構圖。</p>
                </div>
              )}
              {aligned && plan && (
                <TextOverlayStage
                  layers={textLayers}
                  selected={selectedText}
                  disabled={locked}
                  onSelect={setSelectedText}
                  onChange={changeTextLayers}
                  width={dims[0]}
                  height={dims[1]}
                />
              )}
            </div>
          </div>
          <div className="stage-hint">
            <Move size={16} />
            拖曳移動・邊緣調寬高・方向鍵微調 1 px，Shift 加速 10 px
          </div>
          {aligned && plan && (
            <div className="composition-controls">
              <TextOverlayControls
                layers={textLayers}
                selected={selectedText}
                disabled={locked}
                onSelect={setSelectedText}
                onChange={changeTextLayers}
                width={dims[0]}
                height={dims[1]}
              />
              <div className="presets">
                <span>快速配置</span>
                {[
                  ['side', '左右並排'],
                  ['stack', '上下並排'],
                  ['pip', '子母畫面'],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    disabled={locked}
                    onClick={() => preset(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="inspector">
                <div className="layer-select">
                  {names.map((n, i) => (
                    <button
                      key={n}
                      aria-pressed={selected === i}
                      className={selected === i ? 'chosen' : ''}
                      disabled={locked}
                      onClick={() => {
                        setSelected(i);
                        setSelectedText(null);
                      }}
                    >
                      <span className={`clip-badge ${n}`}>{n}</span>影片 {n}
                    </button>
                  ))}
                </div>
                <label>
                  大小{' '}
                  <input
                    type="range"
                    min="10"
                    max="200"
                    step="1"
                    disabled={locked}
                    value={Math.round(boxes[selected].width * 100)}
                    onChange={(e) => {
                      const w = Number(e.target.value) / 100;
                      changeBox({
                        ...boxes[selected],
                        width: w,
                        height: lockAspect
                          ? (boxes[selected].height * w) / boxes[selected].width
                          : boxes[selected].height,
                      });
                    }}
                  />
                  <output>{Math.round(boxes[selected].width * 100)}%</output>
                </label>
                <button
                  className="small-button"
                  disabled={locked}
                  onClick={() => {
                    setOrder([1 - selected, selected]);
                    clearResult();
                  }}
                >
                  移到最上層
                </button>
              </div>
              <CropEditor
                key={
                  clips[selected]!.url + JSON.stringify(clips[selected]!.crop)
                }
                name={names[selected]}
                thumbnail={
                  clips[selected]!.alignedThumbnail ??
                  clips[selected]!.thumbnail
                }
                aspect={clips[selected]!.width / clips[selected]!.height}
                crop={clips[selected]!.crop ?? FULL_CROP}
                hasApplied={clips[selected]!.crop !== undefined}
                disabled={locked}
                onApply={applyCrop}
              />
              <p className="hint resize-help">
                左右把手只改寬度，上下把手只改高度；右下角依「鎖定比例」縮放。超出畫布的部分會裁切。
              </p>
              <div className="geometry">
                <div className="geometry-head">
                  <span>影片 {names[selected]} 的位置與尺寸</span>
                  <label>
                    <input
                      type="checkbox"
                      checked={lockAspect}
                      disabled={locked}
                      onChange={(e) => setLockAspect(e.target.checked)}
                    />
                    鎖定比例
                  </label>
                </div>
                {(
                  [
                    ['x', '水平位置'],
                    ['y', '垂直位置'],
                    ['width', '寬度'],
                    ['height', '高度'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <div>
                      <input
                        aria-label={label + '百分比'}
                        type="number"
                        step="1"
                        min={key === 'x' || key === 'y' ? -190 : 5}
                        max={key === 'x' || key === 'y' ? 97 : 200}
                        value={Math.round(boxes[selected][key] * 100)}
                        disabled={locked}
                        onChange={(e) => {
                          if (e.target.value === '') return;
                          const value = clamp(
                            Number(e.target.value) / 100,
                            key === 'x' || key === 'y' ? -1.9 : 0.05,
                            key === 'x' || key === 'y' ? 0.97 : 2,
                          );
                          if (!Number.isFinite(value)) return;
                          const current = boxes[selected],
                            next = { ...current, [key]: value };
                          if (lockAspect && key === 'width')
                            next.height =
                              (current.height * value) / current.width;
                          if (lockAspect && key === 'height')
                            next.width =
                              (current.width * value) / current.height;
                          changeBox(next);
                        }}
                      />
                      <span>%</span>
                    </div>
                  </label>
                ))}
              </div>
              <div className="timeline">
                <div className="timeline-title">
                  <b>同步時間軸</b>
                  <span>
                    {sec(playhead)} / {sec(plan.duration)}
                  </span>
                </div>
                <input
                  aria-label="查看同步時間軸"
                  type="range"
                  min="0"
                  max={Math.max(0, plan.duration - 0.04)}
                  step="0.04"
                  disabled={locked}
                  value={playhead}
                  onChange={(e) => {
                    void scrub(Number(e.target.value));
                  }}
                />
                {names.map((n, i) => (
                  <div className="timeline-track" key={n}>
                    <span className={`clip-badge ${n}`}>{n}</span>
                    <div className="track-base">
                      <div
                        className={`track-fill ${n}`}
                        style={{
                          width: `${(plan!.remaining[i] / plan!.duration) * 100}%`,
                        }}
                      >
                        <span>{sec(plan!.remaining[i])}</span>
                      </div>
                      {plan!.remaining[i] < plan!.duration && (
                        <span className="track-black">黑幕</span>
                      )}
                    </div>
                  </div>
                ))}
                <p className="hint">
                  開頭裁切：A {sec(plan.starts[0])} ／ B {sec(plan.starts[1])}
                  {alignment &&
                    ` · ${alignment.confident ? '自動對齊' : '待確認'}`}
                </p>
              </div>
              <div className="sound">
                <label>
                  <Volume2 size={17} />
                  保留聲音
                  <select
                    value={audio}
                    disabled={locked}
                    onChange={(e) => {
                      setAudio(Number(e.target.value));
                      clearResult();
                    }}
                  >
                    <option value="0">影片 A</option>
                    <option value="1">影片 B</option>
                  </select>
                </label>
                <span>選定音軌結束後，剩餘片段靜音。</span>
              </div>
            </div>
          )}
          <div className="export-quality">
            <label>
              輸出畫質
              <select
                value={quality}
                disabled={locked}
                onChange={(e) => {
                  setQuality(e.target.value);
                  clearResult();
                }}
              >
                <option value="1080">高畫質 1080p</option>
                <option value="720">標準 720p</option>
                <option value="480">輕量 480p</option>
              </select>
            </label>
            <span>
              {exportSupported && exportFormat
                ? `下載格式：${exportFormat} · 原速錄製`
                : '正在確認輸出支援'}
            </span>
          </div>
          <div className="editor-foot">
            <span>
              {aligned && plan
                ? `輸出 ${sec(plan.duration)} · ${dims[0]} × ${dims[1]} · 目標 30 fps`
                : '等待兩部來源影片'}
              <small>每部 3 秒～10 分鐘、上限 250 MB</small>
            </span>
            <button
              className="primary"
              onClick={fuse}
              disabled={locked || !aligned || !exportSupported}
            >
              融合影片
              <ArrowUpRight size={18} />
            </button>
          </div>
          {busy.includes('融合') && (
            <div className="progress-panel">
              <progress max="1" value={progress} />
              <b>{Math.round(progress * 100)}%</b>
              <p>
                輸出時間約等於影片長度。請保持分頁在前景，避免電腦進入睡眠。
              </p>
            </div>
          )}
        </section>
      </div>
      {clips.some(Boolean) && (
        <AudioAudition
          key={clips.map((clip) => clip?.url ?? '').join('|')}
          sources={clips.map((clip) =>
            clip
              ? { file: clip.file, url: clip.url, duration: clip.duration }
              : null,
          )}
          disabled={!!busy}
        />
      )}
      {result && (
        <section className="result-panel">
          <div>
            <p className="eyebrow">YOUR TWO VIEWS, TOGETHER.</p>
            <h2>融合完成</h2>
            <p className="hint">
              {(result.blob.size / 1024 / 1024).toFixed(1)} MB ·{' '}
              {result.blob.type.includes('mp4') ? 'MP4' : 'WebM'}
            </p>
          </div>
          <video
            className="result-video"
            src={result.url}
            controls
            playsInline
            preload="metadata"
          />
          <div className="result-actions">
            <a
              className="download primary"
              href={result.url}
              download={result.file.name}
            >
              <Download size={18} />
              下載影片
            </a>
          </div>
          <p className="hint">
            點「下載影片」儲存到電腦；儲存位置依瀏覽器的下載設定。
            {!result.blob.type.includes('mp4') &&
              ' 此次輸出為 WebM，可用 Chrome 或 Edge 開啟。'}
          </p>
        </section>
      )}
      <dialog
        ref={exportDialog}
        className="export-dialog"
        aria-labelledby="export-title"
        onCancel={(e) => {
          if (exporting) {
            e.preventDefault();
            controller.current?.abort();
          }
        }}
      >
        <div className="export-dialog-head">
          <h2 id="export-title">
            {exportPhase === 'done'
              ? '融合完成'
              : exportPhase === 'error'
                ? '無法完成融合'
                : exportPhase === 'cancelled'
                  ? '已取消融合'
                  : '正在融合影片'}
          </h2>
          {!exporting && (
            <button
              aria-label="關閉融合視窗"
              className="small-button"
              onClick={() => exportDialog.current?.close()}
            >
              <X size={18} />
            </button>
          )}
        </div>
        <p
          className={exportPhase === 'error' ? 'export-error' : 'hint'}
          role={exportPhase === 'error' ? 'alert' : undefined}
        >
          {exportMessage}
        </p>
        {exporting && plan && (
          <p className="export-trim">
            先裁切再融合：A 從 {sec(plan.starts[0])} 開始；B 從{' '}
            {sec(plan.starts[1])} 開始。
          </p>
        )}
        <div className="export-canvas-wrap" hidden={!exporting}>
          <canvas ref={exportCanvas} aria-label="正在融合的即時畫面" />
        </div>
        <div
          ref={sourceHost}
          className="export-sources"
          hidden={!exporting}
          aria-label="來源影片播放"
        />
        {exporting && (
          <>
            <div className="export-progress">
              <progress aria-label="融合進度" max="1" value={progress} />
              <output aria-live="polite">{Math.round(progress * 100)}%</output>
            </div>
            <p className="hint">
              {exportPhase === 'preparing'
                ? '準備完成後會開始顯示影片進度。'
                : exportPhase === 'finalizing'
                  ? '正在寫入影片檔案，請稍候。'
                  : '請保持網站在前景，勿鎖定螢幕。'}
            </p>
            <button
              className="secondary"
              onClick={() => controller.current?.abort()}
            >
              取消融合
            </button>
          </>
        )}
        {exportPhase === 'done' && result && (
          <>
            <video
              className="result-video"
              src={result.url}
              controls
              playsInline
              preload="metadata"
            />
            <div className="result-actions">
              <a
                className="download primary"
                href={result.url}
                download={result.file.name}
              >
                <Download size={18} />
                下載影片
              </a>
            </div>
            <p className="hint">
              點「下載影片」儲存到電腦。
              {!result.blob.type.includes('mp4') &&
                ' 此次輸出為 WebM，可用 Chrome 或 Edge 開啟。'}
            </p>
          </>
        )}
        {(exportPhase === 'error' || exportPhase === 'cancelled') && (
          <div className="result-actions">
            <button className="primary" onClick={fuse} disabled={locked}>
              再試一次
            </button>
            <button
              className="secondary"
              onClick={() => exportDialog.current?.close()}
            >
              返回調整
            </button>
          </div>
        )}
      </dialog>
      <footer>
        <span>聲音對齊。畫面由你決定。</span>
        <span>Windows · Chrome / Edge</span>
      </footer>
    </main>
  );
}
