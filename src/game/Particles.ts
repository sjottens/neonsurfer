import * as THREE from "three";

const MAX = 1400;

const vert = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
uniform float uScale;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
  gl_Position = projectionMatrix * mv;
}
`;

const frag = /* glsl */ `
varying vec4 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = 1.0 - smoothstep(0.0, 1.0, d);
  gl_FragColor = vec4(vColor.rgb, vColor.a * a * a);
  #include <colorspace_fragment>
}
`;

export interface Emit {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  life: number;
  size: number;
  /** size at end of life; defaults to shrinking to nothing */
  sizeEnd?: number;
  color: THREE.ColorRepresentation;
  alpha?: number;
  gravity?: number;
  drag?: number;
  /** ride the scrolling water (true, default) or stay put in the world frame */
  follow?: boolean;
}

/**
 * One pooled, additive point-sprite system for everything that sparkles or
 * splashes: coin glints, wake foam, spray, explosions. Fixed-size ring buffer,
 * so a big burst never allocates.
 */
export class ParticleSystem {
  readonly points: THREE.Points;
  private material: THREE.ShaderMaterial;
  private pos = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 4);
  private size = new Float32Array(MAX);
  private vel = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private maxLife = new Float32Array(MAX);
  private s0 = new Float32Array(MAX);
  private s1 = new Float32Array(MAX);
  private a0 = new Float32Array(MAX);
  private grav = new Float32Array(MAX);
  private drag = new Float32Array(MAX);
  private follow = new Uint8Array(MAX);
  private next = 0;
  private geometry = new THREE.BufferGeometry();
  private tmp = new THREE.Color();

  constructor() {
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("aColor", new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  /** Pixels-per-world-unit at depth 1 - keeps sprite sizes in world units whatever the resolution / FOV. */
  setScale(scale: number) {
    this.material.uniforms.uScale.value = scale;
  }

  emit(e: Emit) {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    this.pos[i * 3] = e.x;
    this.pos[i * 3 + 1] = e.y;
    this.pos[i * 3 + 2] = e.z;
    this.vel[i * 3] = e.vx ?? 0;
    this.vel[i * 3 + 1] = e.vy ?? 0;
    this.vel[i * 3 + 2] = e.vz ?? 0;
    this.life[i] = e.life;
    this.maxLife[i] = e.life;
    this.s0[i] = e.size;
    this.s1[i] = e.sizeEnd ?? 0;
    this.a0[i] = e.alpha ?? 1;
    this.grav[i] = e.gravity ?? 0;
    this.drag[i] = e.drag ?? 0;
    this.follow[i] = e.follow === false ? 0 : 1;
    this.tmp.set(e.color);
    this.col[i * 4] = this.tmp.r;
    this.col[i * 4 + 1] = this.tmp.g;
    this.col[i * 4 + 2] = this.tmp.b;
  }

  /** Radial explosion of glowing sparks. */
  burst(x: number, y: number, z: number, color: THREE.ColorRepresentation, count: number, speed: number, size: number, life: number) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const el = (Math.random() - 0.3) * Math.PI;
      const s = speed * (0.35 + Math.random() * 0.65);
      this.emit({
        x,
        y,
        z,
        vx: Math.cos(a) * Math.cos(el) * s,
        vy: Math.sin(el) * s + speed * 0.25,
        vz: Math.sin(a) * Math.cos(el) * s,
        life: life * (0.6 + Math.random() * 0.4),
        size: size * (0.6 + Math.random() * 0.8),
        color,
        gravity: 9,
        drag: 1.4,
      });
    }
  }

  /** Small pickup glint. */
  sparkle(x: number, y: number, z: number, color: THREE.ColorRepresentation, count = 10) {
    this.burst(x, y, z, color, count, 5, 0.45, 0.55);
  }

  /** White-blue water splash, used on landings and when the rider hits the sea. */
  splash(x: number, y: number, z: number, amount = 1) {
    const n = Math.floor(16 * amount);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (1.5 + Math.random() * 3.5) * amount;
      this.emit({
        x,
        y,
        z,
        vx: Math.cos(a) * s,
        vy: (2.5 + Math.random() * 4) * Math.sqrt(amount),
        vz: Math.sin(a) * s,
        life: 0.6 + Math.random() * 0.4,
        size: 0.15 + Math.random() * 0.15,
        sizeEnd: 0.05,
        color: "#cfefff",
        alpha: 0.8,
        gravity: 14,
        drag: 0.6,
      });
    }
  }

  update(dt: number, scrollSpeed: number) {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) {
        this.size[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i]; // 0 -> 1 over life
      const damp = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= damp;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * damp - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= damp;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt + (this.follow[i] ? scrollSpeed * dt : 0);
      this.size[i] = this.life[i] <= 0 ? 0 : this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.col[i * 4 + 3] = this.a0[i] * (1 - t);
    }
    (this.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute("aColor") as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute("aSize") as THREE.BufferAttribute).needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.size.fill(0);
  }
}
