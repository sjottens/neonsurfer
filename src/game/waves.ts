/**
 * The ocean swell, shared by the water shader (GPU) and the gameplay code
 * (CPU) so the surfer and every obstacle ride exactly the same surface.
 *
 * `u` is the scroll-space z coordinate (world z minus how far the run has
 * scrolled), so a swell stays glued to the water as the world streams past.
 * Keep the GLSL copy below identical to the TS one.
 */
export function waveHeight(x: number, u: number, t: number): number {
  return (
    0.3 * Math.sin(u * 0.16 + t * 1.1) +
    0.16 * Math.sin(x * 0.35 + u * 0.11 - t * 0.8) +
    0.06 * Math.sin(u * 0.55 + x * 0.5 + t * 1.9)
  );
}

export const WAVE_GLSL = /* glsl */ `
float waveHeight(float x, float u, float t) {
  return 0.3 * sin(u * 0.16 + t * 1.1)
       + 0.16 * sin(x * 0.35 + u * 0.11 - t * 0.8)
       + 0.06 * sin(u * 0.55 + x * 0.5 + t * 1.9);
}
`;
