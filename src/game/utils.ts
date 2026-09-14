/** Small math/random helpers shared across the game. */

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Exponential ease toward a target - frame-rate independent smoothing. */
export function damp(current: number, target: number, smoothing: number, dt: number): number {
  return lerp(current, target, 1 - Math.pow(smoothing, dt * 60));
}

/** Mulberry32 - tiny, fast, seedable PRNG (deterministic per run for fairness/replayability). */
export function createRng(seed: number) {
  let a = seed >>> 0;
  return function rng(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randRange(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function formatNumber(n: number): string {
  return Math.floor(n).toLocaleString("en-US");
}

export function hsl(h: number, s: number, l: number): string {
  return `hsl(${h % 360}, ${s}%, ${l}%)`;
}

/** Darken (amount > 0) or lighten (amount < 0) a "#rrggbb" color, amount in 0..1. */
export function darken(hex: string, amount: number): string {
  const num = Number.parseInt(hex.slice(1), 16);
  const scale = (channel: number) => clamp(Math.round(channel * (1 - amount)), 0, 255);
  const r = scale((num >> 16) & 0xff);
  const g = scale((num >> 8) & 0xff);
  const b = scale(num & 0xff);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
