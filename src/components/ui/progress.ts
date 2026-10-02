/** Clamp `value` into [0, max]; NaN/Infinity become 0. */
export function clampProgress(
  value: number,
  max: number,
): { value: number; max: number } {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
  const safeValue = Number.isFinite(value) ? Math.min(Math.max(value, 0), safeMax) : 0;
  return { value: safeValue, max: safeMax };
}
