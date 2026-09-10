'use client';
/* oxlint-disable next/no-img-element -- Local user-video thumbnail, never uploaded. */
import { useId, useRef, useState } from 'react';
import { adjustCrop, FULL_CROP, type Crop, type CropHandle } from '../lib/crop';
export function CropEditor({
  thumbnail,
  aspect,
  name,
  crop,
  hasApplied,
  disabled,
  onApply,
}: {
  thumbnail: string;
  aspect: number;
  name: string;
  crop: Crop;
  hasApplied: boolean;
  disabled: boolean;
  onApply: (crop: Crop) => void;
}) {
  const [draft, setDraft] = useState(crop);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const frame = useRef<HTMLDivElement>(null);
  function drag(e: React.PointerEvent, handle: CropHandle) {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement,
      id = e.pointerId;
    el.setPointerCapture(id);
    const bounds = frame.current!.getBoundingClientRect(),
      original = draft,
      x = e.clientX,
      y = e.clientY;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId === id)
        setDraft(
          adjustCrop(
            original,
            handle,
            (ev.clientX - x) / bounds.width,
            (ev.clientY - y) / bounds.height,
          ),
        );
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      el.removeEventListener('lostpointercapture', end);
      if (el.hasPointerCapture(id)) el.releasePointerCapture(id);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  }
  const edges = [
    {
      edge: 'left' as const,
      label: '左側',
      amount: draft.x,
      max: draft.x + draft.width - 0.05,
    },
    {
      edge: 'right' as const,
      label: '右側',
      amount: 1 - draft.x - draft.width,
      max: 0.95 - draft.x,
    },
    {
      edge: 'top' as const,
      label: '上方',
      amount: draft.y,
      max: draft.y + draft.height - 0.05,
    },
    {
      edge: 'bottom' as const,
      label: '下方',
      amount: 1 - draft.y - draft.height,
      max: 0.95 - draft.y,
    },
  ];
  return (
    <div className="crop-editor">
      <div className="crop-editor-head">
        <b>影片 {name} 的畫面</b>
        <button
          type="button"
          className="secondary"
          disabled={disabled}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => {
            setDraft(crop);
            setOpen(!open);
          }}
        >
          {open ? '收起裁切' : hasApplied ? '重新裁切' : '裁切'}
        </button>
      </div>
      <div id={panelId} hidden={!open}>
        <p className="hint">
          以對齊後第一幀選取範圍，裁切會套用到整段影片。拖動框線裁切，框內可移動；套用後再調整大小與位置。
        </p>
        <div
          ref={frame}
          className="crop-source"
          style={{ aspectRatio: aspect }}
        >
          <img
            src={thumbnail}
            alt={`影片 ${name} 對齊後第一幀的完整畫面`}
            draggable={false}
          />
          <button
            type="button"
            disabled={disabled}
            className="crop-selection"
            aria-label="移動保留範圍，亦可使用方向鍵"
            style={{
              left: `${draft.x * 100}%`,
              top: `${draft.y * 100}%`,
              width: `${draft.width * 100}%`,
              height: `${draft.height * 100}%`,
            }}
            onPointerDown={(e) => drag(e, 'move')}
            onKeyDown={(e) => {
              const direction: Record<string, number[]> = {
                ArrowLeft: [-0.01, 0],
                ArrowRight: [0.01, 0],
                ArrowUp: [0, -0.01],
                ArrowDown: [0, 0.01],
              };
              const d = direction[e.key];
              if (d) {
                e.preventDefault();
                setDraft(adjustCrop(draft, 'move', d[0], d[1]));
              }
            }}
          >
            {edges.map(({ edge }) => (
              <span
                key={edge}
                aria-hidden="true"
                className={`crop-grip crop-${edge}`}
                onPointerDown={(e) => drag(e, edge)}
              />
            ))}
            <span
              aria-hidden="true"
              className="crop-grip crop-corner"
              onPointerDown={(e) => drag(e, 'corner')}
            />
          </button>
        </div>
        <div className="crop-sliders">
          {edges.map(({ edge, label, amount, max }) => (
            <label key={edge}>
              <span>
                {label}裁掉 <output>{Math.round(amount * 100)}%</output>
              </span>
              <input
                type="range"
                min="0"
                max={Math.max(0, max * 100)}
                step="0.1"
                value={Math.max(0, amount * 100)}
                disabled={disabled}
                onChange={(e) => {
                  const delta = Number(e.target.value) / 100 - amount;
                  setDraft(
                    adjustCrop(
                      draft,
                      edge,
                      edge === 'left' ? delta : edge === 'right' ? -delta : 0,
                      edge === 'top' ? delta : edge === 'bottom' ? -delta : 0,
                    ),
                  );
                }}
              />
            </label>
          ))}
        </div>
        <div className="crop-actions">
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onApply(draft);
              setOpen(false);
            }}
          >
            套用裁切
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setDraft(crop);
              setOpen(false);
            }}
          >
            取消調整
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setDraft(FULL_CROP);
              onApply(FULL_CROP);
              setOpen(false);
            }}
          >
            還原完整畫面
          </button>
        </div>
      </div>
    </div>
  );
}
