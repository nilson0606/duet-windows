export type Crop = { x: number; y: number; width: number; height: number };
export const FULL_CROP: Crop = { x: 0, y: 0, width: 1, height: 1 };
export type CropHandle =
  | 'move'
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'corner';
const bound = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));
export function adjustCrop(
  c: Crop,
  handle: CropHandle,
  dx: number,
  dy: number,
): Crop {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return c;
  if (handle === 'move')
    return {
      ...c,
      x: bound(c.x + dx, 0, 1 - c.width),
      y: bound(c.y + dy, 0, 1 - c.height),
    };
  let left = c.x,
    top = c.y,
    right = c.x + c.width,
    bottom = c.y + c.height;
  if (handle === 'left') left = bound(left + dx, 0, right - 0.05);
  if (handle === 'top') top = bound(top + dy, 0, bottom - 0.05);
  if (handle === 'right' || handle === 'corner')
    right = bound(right + dx, left + 0.05, 1);
  if (handle === 'bottom' || handle === 'corner')
    bottom = bound(bottom + dy, top + 0.05, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}
// The full thumbnail sits behind a clipped viewport, matching drawImage's source rectangle.
export function cropImageStyle(c: Crop) {
  return {
    width: `${100 / c.width}%`,
    height: `${100 / c.height}%`,
    left: `${(-100 * c.x) / c.width}%`,
    top: `${(-100 * c.y) / c.height}%`,
  };
}
