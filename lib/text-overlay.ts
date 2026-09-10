export type TextLayer = {
  id: string;
  text: string;
  x: number;
  y: number;
  size: number;
  color: string;
};
export const TEXT_FONT =
  'Arial, "Microsoft JhengHei", "PingFang TC", sans-serif';
export const MIN_TEXT_SIZE = 0.015;
export const MAX_TEXT_SIZE = 0.3;

export function textLayout(
  ctx: Pick<CanvasRenderingContext2D, 'font' | 'measureText'>,
  layer: TextLayer,
  width: number,
  height: number,
) {
  const fontSize = layer.size * Math.min(width, height);
  const stroke = Math.max(1, fontSize * 0.065);
  const padding = stroke + 2;
  const lines = layer.text.replace(/\r\n?/g, '\n').split('\n');
  ctx.font = `600 ${fontSize}px ${TEXT_FONT}`;
  const lineHeight = fontSize * 1.25;
  const textWidth = Math.max(
    fontSize,
    ...lines.map((line) => ctx.measureText(line).width),
  );
  return {
    fontSize,
    stroke,
    padding,
    lines,
    lineHeight,
    width: textWidth + padding * 2,
    height: lines.length * lineHeight + padding * 2,
  };
}

/** Draw after both videos so text also remains visible over an ended clip's black tail. */
export function drawTextLayers(
  ctx: CanvasRenderingContext2D,
  layers: TextLayer[],
  width: number,
  height: number,
) {
  if (!layers.length) return;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  for (const layer of layers) {
    if (!layer.text.trim()) continue;
    const layout = textLayout(ctx, layer, width, height);
    ctx.lineWidth = layout.stroke;
    ctx.strokeStyle = '#000000';
    ctx.fillStyle = layer.color;
    for (let i = 0; i < layout.lines.length; i++) {
      const x = layer.x * width + layout.padding;
      const y =
        layer.y * height +
        layout.padding +
        layout.fontSize +
        i * layout.lineHeight;
      ctx.strokeText(layout.lines[i], x, y);
      ctx.fillText(layout.lines[i], x, y);
    }
  }
  ctx.restore();
}
