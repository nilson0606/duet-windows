'use client';
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- SVG scene groups need keyboard-operable roles; HTML buttons are not valid SVG children. */
import { useMemo, useRef } from 'react';
import {
  textLayout,
  TEXT_FONT,
  MIN_TEXT_SIZE,
  MAX_TEXT_SIZE,
  type TextLayer,
} from '../lib/text-overlay';
import { clamp } from '../lib/timeline.mjs';

type LayerProps = {
  layers: TextLayer[];
  selected: string | null;
  disabled: boolean;
  onSelect: (id: string | null) => void;
  onChange: (layers: TextLayer[]) => void;
};
export function TextOverlayStage({
  layers,
  selected,
  disabled,
  onSelect,
  onChange,
  width,
  height,
}: LayerProps & { width: number; height: number }) {
  const svg = useRef<SVGSVGElement>(null);
  const measure = useMemo(
    () =>
      typeof document === 'undefined'
        ? null
        : document.createElement('canvas').getContext('2d'),
    [],
  );
  if (!measure) return null;
  function drag(
    e: React.PointerEvent<SVGGElement | SVGRectElement>,
    layer: TextLayer,
    resize = false,
  ) {
    if (disabled || !svg.current) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect(layer.id);
    const target = e.currentTarget;
    const group = target.closest<SVGGElement>('g[data-text-layer]');
    group?.focus({ preventScroll: true });
    target.setPointerCapture(e.pointerId);
    const bounds = svg.current.getBoundingClientRect();
    const originX = e.clientX,
      originY = e.clientY;
    const layout = textLayout(measure!, layer, width, height);
    const move = (event: Event) => {
      if (!(event instanceof PointerEvent)) return;
      const dx = (event.clientX - originX) / bounds.width;
      const dy = (event.clientY - originY) / bounds.height;
      const next = resize
        ? {
            ...layer,
            size: clamp(
              layer.size *
                (1 +
                  (dx * width * layout.width + dy * height * layout.height) /
                    (layout.width ** 2 + layout.height ** 2)),
              MIN_TEXT_SIZE,
              MAX_TEXT_SIZE,
            ),
          }
        : {
            ...layer,
            x: clamp(layer.x + dx, -layout.width / width + 0.03, 0.97),
            y: clamp(layer.y + dy, -layout.height / height + 0.03, 0.97),
          };
      onChange(layers.map((item) => (item.id === layer.id ? next : item)));
    };
    const finish = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', finish);
      target.removeEventListener('pointercancel', finish);
      target.removeEventListener('lostpointercapture', finish);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', finish);
    target.addEventListener('pointercancel', finish);
    target.addEventListener('lostpointercapture', finish);
  }
  return (
    <svg
      ref={svg}
      className="text-overlay-stage"
      viewBox={`0 0 ${width} ${height}`}
      aria-label="畫布文字圖層"
    >
      {layers.map((layer) => {
        const layout = textLayout(measure, layer, width, height);
        const active = selected === layer.id;
        const handle = Math.max(22, Math.min(width, height) * 0.035);
        return (
          <g
            key={layer.id}
            data-text-layer={layer.id}
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-label={`文字圖層：${layer.text || '空白文字'}，方向鍵移動`}
            aria-disabled={disabled}
            aria-pressed={active}
            transform={`translate(${layer.x * width} ${layer.y * height})`}
            className="text-overlay-item"
            onFocus={() => onSelect(layer.id)}
            onPointerDown={(e) => drag(e, layer)}
            onKeyDown={(e) => {
              if (disabled) return;
              const pixels = e.shiftKey ? 10 : 1;
              const moves: Record<string, [number, number]> = {
                ArrowLeft: [-pixels / width, 0],
                ArrowRight: [pixels / width, 0],
                ArrowUp: [0, -pixels / height],
                ArrowDown: [0, pixels / height],
              };
              if (!Object.hasOwn(moves, e.key)) return;
              e.preventDefault();
              const [dx, dy] = moves[e.key];
              onChange(
                layers.map((item) =>
                  item.id === layer.id
                    ? {
                        ...item,
                        x: clamp(
                          item.x + dx,
                          -layout.width / width + 0.03,
                          0.97,
                        ),
                        y: clamp(
                          item.y + dy,
                          -layout.height / height + 0.03,
                          0.97,
                        ),
                      }
                    : item,
                ),
              );
            }}
          >
            <rect
              className="text-hit-area"
              width={layout.width}
              height={layout.height}
              fill="transparent"
              stroke={active ? '#d5fb80' : 'none'}
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
            <text
              fill={layer.color}
              stroke="#000000"
              strokeWidth={layout.stroke}
              strokeLinejoin="round"
              paintOrder="stroke fill"
              fontFamily={TEXT_FONT}
              fontSize={layout.fontSize}
              fontWeight="600"
              textAnchor="start"
              style={{ whiteSpace: 'pre', pointerEvents: 'none' }}
            >
              {layout.lines.map((line, i) => (
                <tspan
                  key={i}
                  x={layout.padding}
                  y={layout.padding + layout.fontSize + i * layout.lineHeight}
                >
                  {line || ' '}
                </tspan>
              ))}
            </text>
            {active && !disabled && (
              <rect
                className="text-resize-handle"
                aria-hidden="true"
                x={layout.width - handle}
                y={layout.height - handle}
                width={handle}
                height={handle}
                rx="3"
                fill="#d5fb80"
                onPointerDown={(e) => drag(e, layer, true)}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function TextOverlayControls({
  layers,
  selected,
  disabled,
  onSelect,
  onChange,
  width,
  height,
}: LayerProps & { width: number; height: number }) {
  const current = layers.find((layer) => layer.id === selected);
  const patch = (changes: Partial<TextLayer>) =>
    onChange(
      layers.map((layer) =>
        layer.id === selected ? { ...layer, ...changes } : layer,
      ),
    );
  return (
    <section className="text-controls" aria-label="文字疊加設定">
      <div className="text-controls-head">
        <h3>疊加文字</h3>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            const id = crypto.randomUUID();
            onChange([
              ...layers,
              {
                id,
                text: '輸入文字',
                x: 0.08,
                y: 0.08,
                size: 0.065,
                color: '#ffffff',
              },
            ]);
            onSelect(id);
          }}
        >
          ＋ 新增文字
        </button>
      </div>
      <p className="hint">
        文字顯示於整段影片。拖曳移動、拉右下角縮放，也可用方向鍵微調。
      </p>
      {layers.length > 0 && (
        <div className="text-layer-list" aria-label="選擇文字圖層">
          {layers.map((layer, i) => (
            <button
              key={layer.id}
              type="button"
              disabled={disabled}
              aria-pressed={selected === layer.id}
              onClick={() => onSelect(layer.id)}
              title={layer.text}
            >
              {i + 1} · {layer.text || '空白文字'}
            </button>
          ))}
        </div>
      )}
      {current && (
        <div className="text-fields">
          <label className="text-content-field">
            文字內容
            <textarea
              aria-label="文字內容"
              value={current.text}
              maxLength={500}
              rows={2}
              disabled={disabled}
              onChange={(e) => patch({ text: e.target.value })}
            />
          </label>
          <label>
            文字大小{' '}
            <output>
              {Math.round(current.size * Math.min(width, height))} px
            </output>
            <input
              type="range"
              aria-label="文字大小"
              min={MIN_TEXT_SIZE}
              max={MAX_TEXT_SIZE}
              step="0.001"
              value={current.size}
              disabled={disabled}
              onChange={(e) => patch({ size: Number(e.target.value) })}
            />
          </label>
          <label>
            文字顏色
            <input
              type="color"
              aria-label="文字顏色"
              value={current.color}
              disabled={disabled}
              onChange={(e) => patch({ color: e.target.value })}
            />
          </label>
          <div className="text-actions">
            <button
              type="button"
              disabled={disabled || layers.at(-1)?.id === selected}
              onClick={() =>
                onChange([
                  ...layers.filter((layer) => layer.id !== selected),
                  current,
                ])
              }
            >
              文字移到最上層
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                onChange(layers.filter((layer) => layer.id !== selected));
                onSelect(null);
              }}
            >
              刪除文字
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
