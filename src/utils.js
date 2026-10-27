export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const lerp = (a, b, t) => a + (b - a) * t;

export const invLerp = (a, b, v) => (v - a) / (b - a);

export const damp = (current, target, lambda, dt) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

export const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);

export const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export const formatSpeed = (metersPerSecond) =>
  Math.round(metersPerSecond * 3.6);

export const vectorDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export const horizontalDistance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export const axisAngle = (x, y) => Math.atan2(x, y);

export const sideSign = (z) => (z >= 0 ? 1 : -1);

export const clampCourtX = (x) => clamp(x, -4.2, 4.2);
export const clampCourtZ = (z) => clamp(z, -11.35, -1.8);

export function ellipsis(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
