import type { Box } from './media.ts';
import { clamp } from './timeline.mjs';

/** Keyboard movement is measured in output pixels, independent of preview size. */
export function keyboardMove(
  box: Box,
  key: string,
  shift: boolean,
  width: number,
  height: number,
): Box | null {
  if (
    !(
      width > 0 &&
      height > 0 &&
      Number.isFinite(width) &&
      Number.isFinite(height)
    )
  )
    return null;
  const pixels = shift ? 10 : 1;
  const delta: Record<string, [number, number]> = {
    ArrowLeft: [-pixels / width, 0],
    ArrowRight: [pixels / width, 0],
    ArrowUp: [0, -pixels / height],
    ArrowDown: [0, pixels / height],
  };
  if (!Object.hasOwn(delta, key)) return null;
  const [dx, dy] = delta[key];
  return {
    ...box,
    x: clamp(box.x + dx, -box.width + 0.03, 0.97),
    y: clamp(box.y + dy, -box.height + 0.03, 0.97),
  };
}
