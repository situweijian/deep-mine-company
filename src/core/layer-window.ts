export const DESKTOP_VISIBLE_LAYERS = 8;
export const COMPACT_VISIBLE_LAYERS = 5;

export function getResponsiveLayerCount(viewportWidth: number): number {
  return viewportWidth < 940
    ? COMPACT_VISIBLE_LAYERS
    : DESKTOP_VISIBLE_LAYERS;
}

export function getVisibleLayerWindow(
  center: number,
  deepestLayer: number,
  requestedCount = DESKTOP_VISIBLE_LAYERS,
): number[] {
  const count = Math.max(1, Math.floor(requestedCount));
  const deepest = Math.max(1, Math.floor(deepestLayer));
  const current = Math.min(deepest, Math.max(1, Math.floor(center)));

  let last = Math.max(count, current + 2);
  if (deepest - last <= 2) last = Math.max(last, deepest);
  last = Math.min(10_000, last);

  const first = Math.max(1, last - count + 1);
  const actualLast = Math.min(10_000, first + count - 1);
  return Array.from(
    { length: actualLast - first + 1 },
    (_, offset) => first + offset,
  );
}
