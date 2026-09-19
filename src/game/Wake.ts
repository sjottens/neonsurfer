import * as THREE from "three";
import { waveHeight } from "./waves";

const N = 44; // ribbon samples
const LEN = 15; // how far behind the board the wake reaches (world units)
const SPACING = 0.6; // a new sample every this much scroll

const vert = /* glsl */ `
attribute vec2 aUv;   // x: -1..1 across the ribbon, y: 0..1 along its length
attribute float aK;   // foam strength of this sample (0 while the board is airborne)
attribute vec2 aPat;  // water-pattern coordinates, so the foam texture sticks to the sea
varying vec2 vUv;
varying float vK;
varying vec2 vPat;
void main() {
  vUv = aUv;
  vK = aK;
  vPat = aPat;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const frag = /* glsl */ `
uniform vec3 uTint;
varying vec2 vUv;
varying float vK;
varying vec2 vPat;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { return noise(p) * 0.5 + noise(p * 2.1) * 0.3 + noise(p * 4.3) * 0.2; }

void main() {
  float a = abs(vUv.x);
  float age = vUv.y;

  // foam is patchy and streaky - stretched along the direction of travel, anchored in water space
  float n = fbm(vPat * vec2(2.0, 0.7));
  float speck = noise(vPat * vec2(9.0, 4.0));

  float arms = exp(-pow((a - 0.8) / 0.17, 2.0));                                 // the two flared edges of the V
  float core = exp(-pow(a / 0.45, 2.0)) * (1.0 - smoothstep(0.0, 0.5, age));     // churned water behind the tail
  float body = (arms * 0.95 + core * 0.9);

  // threshold the noise so foam breaks into lace instead of a flat sheet; it thins out with age
  float lace = smoothstep(0.34, 0.7, n + body * 0.32 - age * 0.55);
  float bubbles = smoothstep(0.72, 0.92, speck) * body * 0.9;

  float fadeIn = smoothstep(0.0, 0.05, age);
  float fade = pow(1.0 - age, 1.4) * (1.0 - smoothstep(0.82, 1.0, a));
  float alpha = (body * lace * 0.8 + bubbles + (1.0 - a) * 0.05 * (1.0 - age)) * fade * fadeIn * vK;

  gl_FragColor = vec4(mix(vec3(0.9, 0.98, 1.0), uTint, 0.12), clamp(alpha, 0.0, 0.85));
  #include <colorspace_fragment>
}
`;

interface Sample {
  s: number; // scroll at emission
  x: number;
  k: number;
}

/**
 * The trail behind the board: a ribbon that follows the path the board actually
 * carved (so it curves when you steer), flaring into a V of foam with a churned
 * core, sitting on the swell. The foam texture is anchored in water space, so it
 * streams past like real foam rather than sliding with the board.
 */
export class Wake {
  readonly mesh: THREE.Mesh;
  private samples: Sample[] = [];
  private pos = new Float32Array(N * 2 * 3);
  private uv = new Float32Array(N * 2 * 2);
  private k = new Float32Array(N * 2);
  private pat = new Float32Array(N * 2 * 2);
  private geometry = new THREE.BufferGeometry();
  private material: THREE.ShaderMaterial;
  private strength = 0;

  constructor() {
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("aUv", new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("aK", new THREE.BufferAttribute(this.k, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("aPat", new THREE.BufferAttribute(this.pat, 2).setUsage(THREE.DynamicDrawUsage));
    const index: number[] = [];
    for (let i = 0; i < N - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geometry.setIndex(index);
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { uTint: { value: new THREE.Color("#7dfcff") } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  setTint(color: THREE.ColorRepresentation) {
    (this.material.uniforms.uTint.value as THREE.Color).set(color);
  }

  clear() {
    this.samples = [];
    this.strength = 0;
    this.geometry.setDrawRange(0, 0);
  }

  /**
   * @param scroll   total world scroll (samples age by how far the world has moved)
   * @param x        board x
   * @param tailZ    z of the board's tail
   * @param riding   true while the board is on the water (foam) vs. in the air (none)
   * @param spread   0..1 extra width from hard carving / speed
   */
  update(dt: number, scroll: number, x: number, tailZ: number, riding: boolean, spread: number, time: number) {
    // ease foam strength so landing fades the wake back in instead of popping
    this.strength += ((riding ? 1 : 0) - this.strength) * Math.min(1, dt * (riding ? 9 : 14));

    const last = this.samples[0];
    if (!last || scroll - last.s >= SPACING) this.samples.unshift({ s: scroll, x, k: this.strength });
    while (this.samples.length > N - 1 || (this.samples.length > 1 && scroll - this.samples[this.samples.length - 1].s > LEN)) this.samples.pop();

    // head sample sits exactly at the tail; the rest trail behind it
    const count = Math.min(N, this.samples.length + 1);
    for (let i = 0; i < N; i++) {
      const src = i === 0 ? null : this.samples[Math.min(i - 1, this.samples.length - 1)];
      const live = i < count;
      const sx = i === 0 ? x : src ? src.x : x;
      const age = i === 0 ? 0 : src ? scroll - src.s : LEN;
      const k = i === 0 ? this.strength : src && live ? src.k : 0;
      const t = clamp01(age / LEN);
      const half = 0.3 + age * (0.13 + spread * 0.05);
      const z = tailZ + age;
      const u = tailZ - (i === 0 ? scroll : src ? src.s : scroll); // scroll-space z: constant for a sample's whole life
      for (let side = 0; side < 2; side++) {
        const v = i * 2 + side;
        const xx = sx + (side === 0 ? -half : half);
        this.pos[v * 3] = xx;
        this.pos[v * 3 + 1] = waveHeight(xx, u, time) + 0.1;
        this.pos[v * 3 + 2] = z;
        this.uv[v * 2] = side === 0 ? -1 : 1;
        this.uv[v * 2 + 1] = live ? t : 1;
        this.k[v] = live ? k : 0;
        this.pat[v * 2] = xx;
        this.pat[v * 2 + 1] = u;
      }
    }
    for (const name of ["position", "aUv", "aK", "aPat"]) (this.geometry.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    this.geometry.setDrawRange(0, Math.max(0, (count - 1) * 6));
  }
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}
