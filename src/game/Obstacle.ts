import * as THREE from "three";
import { waveHeight } from "./waves";

/** The racing corridor is five lanes wide. Obstacles snap to lanes; the surfer does not. */
export const LANES = 5;
export const LANE_W = 3.4;
export const laneX = (lane: number) => (lane - (LANES - 1) / 2) * LANE_W;

/**
 * Read at a glance, by color and shape:
 *  - buoy / rock  (level accent color, tall)      -> steer around
 *  - log          (hazard yellow, low & wide)     -> jump over (SPACE)
 *  - ramp         (glowing white wedge)           -> a launch pad, ride it for a big jump
 *  - fin          (dark fin, sweeps side to side) -> time your pass
 */
export type ObstacleKind = "buoy" | "rock" | "log" | "ramp" | "fin";

export interface ObstacleSpec {
  kind: ObstacleKind;
  x: number;
  /** distance along the track, in world units from the start of the run */
  d: number;
  /** log: how many lanes wide */
  span?: number;
  /** fin: sweep amplitude / angular speed / phase */
  amp?: number;
  freq?: number;
  phase?: number;
}

export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  group: THREE.Group;
  x: number;
  z: number;
  /** scroll-space z: fixed for the obstacle's lifetime, so it bobs with the swell it sits on */
  u: number;
  halfW: number;
  halfD: number;
  height: number;
  solid: boolean;
  yOffset: number;
  baseX: number;
  amp: number;
  freq: number;
  phase: number;
  age: number;
  minClear: number;
  jumped: boolean;
  done: boolean;
  launched: boolean;
}

export const RAMP_HEIGHT = 1.15;
const RAMP_HALF_D = 2.2;

/** Shared geometry + materials; only the level accent color changes, via sync(). */
class ObstacleAssets {
  readonly accent = new THREE.Color("#ff2fd6");

  private rockMat = new THREE.MeshStandardMaterial({ color: 0x2c2552, roughness: 0.85, flatShading: true, emissive: 0xffffff, emissiveIntensity: 0.16 });
  private rockEdgeMat = new THREE.LineBasicMaterial({ color: 0xffffff });
  private buoyAccent = new THREE.MeshStandardMaterial({ color: 0x0a0a14, roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 1.25 });
  private buoyDark = new THREE.MeshStandardMaterial({ color: 0x14141f, roughness: 0.5 });
  private lamp = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  private finMat = new THREE.MeshStandardMaterial({ color: 0x0d0a1a, roughness: 0.6, flatShading: true, emissive: 0xffffff, emissiveIntensity: 0.3 });
  private finEdgeMat = new THREE.LineBasicMaterial({ color: 0xffffff });
  private ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
  private logYellow = new THREE.MeshStandardMaterial({ color: 0x2a2000, roughness: 0.5, emissive: 0xffc21a, emissiveIntensity: 1.0 });
  private logDark = new THREE.MeshStandardMaterial({ color: 0x0c0c10, roughness: 0.6 });
  private rampMat = new THREE.MeshStandardMaterial({
    color: 0x2a2f3a,
    roughness: 0.5,
    emissive: 0xdfe8ff,
    emissiveIntensity: 0.55,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  private rampLine = new THREE.LineBasicMaterial({ color: 0xffffff });

  readonly rockGeo = new THREE.IcosahedronGeometry(1, 0);
  readonly rockEdges = new THREE.EdgesGeometry(this.rockGeo);
  readonly unitCyl = new THREE.CylinderGeometry(1, 1, 1, 12);
  readonly buoyLow = new THREE.CylinderGeometry(0.62, 0.74, 0.7, 10);
  readonly buoyMid = new THREE.CylinderGeometry(0.5, 0.62, 0.6, 10);
  readonly buoyTop = new THREE.CylinderGeometry(0.28, 0.5, 0.6, 10);
  readonly pole = new THREE.CylinderGeometry(0.04, 0.04, 0.8, 6);
  readonly lampGeo = new THREE.SphereGeometry(0.24, 10, 8);
  readonly finGeo = new THREE.ConeGeometry(0.75, 2.1, 3);
  readonly finEdges = new THREE.EdgesGeometry(this.finGeo);
  readonly ringGeo = new THREE.RingGeometry(0.7, 1.1, 24);
  readonly rampGeo: THREE.BufferGeometry;
  readonly rampEdges: THREE.EdgesGeometry;
  readonly chevronGeo: THREE.BufferGeometry;

  constructor() {
    // wedge: low at the +z end (nearest the surfer), high at the -z end
    const w = 1.2;
    const d = RAMP_HALF_D;
    const h = RAMP_HEIGHT;
    const A = [-w, 0, d];
    const B = [w, 0, d];
    const C = [-w, 0, -d];
    const D = [w, 0, -d];
    const E = [-w, h, -d];
    const F = [w, h, -d];
    const tris = [...A, ...B, ...F, ...A, ...F, ...E, ...C, ...D, ...F, ...C, ...F, ...E, ...A, ...C, ...E, ...B, ...F, ...D];
    this.rampGeo = new THREE.BufferGeometry();
    this.rampGeo.setAttribute("position", new THREE.Float32BufferAttribute(tris, 3));
    this.rampGeo.computeVertexNormals();
    this.rampEdges = new THREE.EdgesGeometry(this.rampGeo);

    // three chevrons painted on the slope, pointing up it
    const pts: number[] = [];
    const slope = h / (2 * d);
    for (let i = 0; i < 3; i++) {
      const z = d - 1.0 - i * 1.15;
      const y = (d - z) * slope + 0.03;
      pts.push(-0.7, y, z + 0.35, 0, y + 0.02, z - 0.1, 0, y + 0.02, z - 0.1, 0.7, y, z + 0.35);
    }
    this.chevronGeo = new THREE.BufferGeometry();
    this.chevronGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    this.sync();
  }

  sync() {
    this.rockMat.emissive.copy(this.accent);
    this.rockEdgeMat.color.copy(this.accent).multiplyScalar(1.5);
    this.buoyAccent.emissive.copy(this.accent);
    this.finMat.emissive.copy(this.accent);
    this.finEdgeMat.color.copy(this.accent).multiplyScalar(1.5);
    this.ringMat.color.copy(this.accent);
    this.lamp.color.copy(this.accent).lerp(new THREE.Color(1, 1, 1), 0.6).multiplyScalar(1.4);
  }

  makeRock(rng: () => number): THREE.Group {
    const g = new THREE.Group();
    const inner = new THREE.Group();
    inner.scale.set(1.0 + rng() * 0.25, 1.15 + rng() * 0.3, 0.95 + rng() * 0.25);
    inner.rotation.y = rng() * Math.PI * 2;
    inner.add(new THREE.Mesh(this.rockGeo, this.rockMat));
    inner.add(new THREE.LineSegments(this.rockEdges, this.rockEdgeMat));
    inner.position.y = 0.85;
    g.add(inner);
    return g;
  }

  makeBuoy(): THREE.Group {
    const g = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.y = y;
      g.add(m);
    };
    add(this.buoyLow, this.buoyAccent, 0.35);
    add(this.buoyMid, this.buoyDark, 1.0);
    add(this.buoyTop, this.buoyAccent, 1.6);
    add(this.pole, this.buoyDark, 2.1);
    add(this.lampGeo, this.lamp, 2.6);
    const ring = new THREE.Mesh(this.ringGeo, this.ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    g.add(ring);
    return g;
  }

  makeLog(span: number): { group: THREE.Group; length: number } {
    const g = new THREE.Group();
    const length = span * LANE_W - 0.5;
    const segs = Math.max(3, Math.round(length / 1.15));
    const segLen = length / segs;
    for (let i = 0; i < segs; i++) {
      const m = new THREE.Mesh(this.unitCyl, i % 2 === 0 ? this.logYellow : this.logDark);
      m.rotation.z = Math.PI / 2;
      m.scale.set(0.44, segLen * 1.01, 0.44);
      m.position.set(-length / 2 + segLen * (i + 0.5), 0.34, 0);
      g.add(m);
    }
    return { group: g, length };
  }

  makeRamp(): THREE.Group {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(this.rampGeo, this.rampMat));
    g.add(new THREE.LineSegments(this.rampEdges, this.rampLine));
    g.add(new THREE.LineSegments(this.chevronGeo, this.rampLine));
    return g;
  }

  makeFin(): THREE.Group {
    const g = new THREE.Group();
    const inner = new THREE.Group();
    inner.scale.set(0.42, 1, 1);
    inner.rotation.x = 0.28; // tip raked back toward the surfer
    inner.position.y = 0.95;
    inner.add(new THREE.Mesh(this.finGeo, this.finMat));
    inner.add(new THREE.LineSegments(this.finEdges, this.finEdgeMat));
    g.add(inner);
    const ring = new THREE.Mesh(this.ringGeo, this.ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    ring.scale.set(1.3, 1.9, 1);
    g.add(ring);
    return g;
  }
}

export const obstacleAssets = new ObstacleAssets();

let nextId = 1;

export function createObstacle(spec: ObstacleSpec, z: number, scroll: number, rng: () => number): Obstacle {
  const a = obstacleAssets;
  let group: THREE.Group;
  let halfW = 0.6;
  let halfD = 0.6;
  let height = 2;
  let solid = true;

  switch (spec.kind) {
    case "buoy":
      group = a.makeBuoy();
      halfW = 0.62;
      halfD = 0.62;
      height = 2.6;
      break;
    case "rock":
      group = a.makeRock(rng);
      halfW = 1.05;
      halfD = 1.0;
      height = 2.3;
      break;
    case "log": {
      const { group: g, length } = a.makeLog(spec.span ?? LANES);
      group = g;
      halfW = length / 2;
      halfD = 0.46;
      height = 0.85;
      break;
    }
    case "ramp":
      group = a.makeRamp();
      halfW = 1.2;
      halfD = RAMP_HALF_D;
      height = 0;
      solid = false;
      break;
    case "fin":
      group = a.makeFin();
      halfW = 0.5;
      halfD = 0.85;
      height = 1.9;
      break;
  }

  const o: Obstacle = {
    id: nextId++,
    kind: spec.kind,
    group,
    x: spec.x,
    z,
    u: z - scroll,
    halfW,
    halfD,
    height,
    solid,
    yOffset: 0,
    baseX: spec.x,
    amp: spec.amp ?? 0,
    freq: spec.freq ?? 0,
    phase: spec.phase ?? 0,
    age: 0,
    minClear: Infinity,
    jumped: false,
    done: false,
    launched: false,
  };
  group.position.set(o.x, 0, o.z);
  return o;
}

/** Per-frame motion + bobbing. World scroll itself is applied by the caller (z += worldSpeed * dt). */
export function updateObstacle(o: Obstacle, dt: number, time: number) {
  o.age += dt;
  if (o.kind === "fin") {
    const s = Math.sin(o.age * o.freq + o.phase);
    o.x = o.baseX + o.amp * s;
    o.group.rotation.y = -Math.cos(o.age * o.freq + o.phase) * Math.sign(o.amp) * 0.6;
  }
  const w = waveHeight(o.x, o.u, time);
  const bob = o.kind === "ramp" ? 0.4 : 0.85; // ramps sit low & steady so the surfer's ground contact stays believable
  o.group.position.set(o.x, w * bob + o.yOffset, o.z);
  if (o.kind === "log") o.group.rotation.z = Math.sin(time * 1.7 + o.id) * 0.02;
}

/** Height of the ground under x (0 unless the surfer is on a ramp's slope). */
export function rampGroundAt(o: Obstacle, playerX: number): number {
  if (o.kind !== "ramp" || Math.abs(playerX - o.x) > o.halfW) return 0;
  const t = (o.z + o.halfD) / (2 * o.halfD); // 0 at the near/low end, 1 at the lip
  if (t < 0 || t > 1) return 0;
  return RAMP_HEIGHT * t;
}
