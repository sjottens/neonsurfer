import * as THREE from "three";
import { clamp, damp } from "./utils";
import { waveHeight } from "./waves";
import type { Skin } from "./Skins";

/**
 * Steering is free left/right across the corridor (no lanes for the rider),
 * jumping is a fixed arc with a little forgiveness: a jump pressed slightly
 * before landing is remembered (buffer), and one pressed a moment after
 * leaving a ledge still fires (coyote time).
 */
export const PHYSICS = {
  latSpeed: 15, // target sideways speed while steering (units/s)
  smoothing: 0.55, // damp() base - how quickly sideways speed catches up (lower = snappier)
  gravity: 38,
  jumpV: 13.5, // ~2.4 units high, ~0.7 s in the air
  rampV: 15.5, // launch speed off a ramp - a real big air
  bound: 7.7, // how far from the center line the surfer can go
  halfW: 0.42, // hitbox half-width
  halfD: 0.8, // hitbox half-length (front to back)
  coyote: 0.1,
  buffer: 0.14,
};

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

/** Two-bone IK: where the knee/elbow sits so a limb spans hip -> foot, bending toward `bend`. */
function solveJoint(root: THREE.Vector3, end: THREE.Vector3, l1: number, l2: number, bend: THREE.Vector3, out: THREE.Vector3) {
  _a.subVectors(end, root);
  const d = clamp(_a.length(), 0.05, l1 + l2 - 0.001);
  _a.normalize();
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
  _b.copy(bend).addScaledVector(_a, -bend.dot(_a));
  if (_b.lengthSq() < 1e-6) _b.set(0, 0, -1);
  _b.normalize();
  out.copy(root).addScaledVector(_a, a).addScaledVector(_b, h);
}

/** Clamp a hand/foot target so it's never farther from its root than the limb can reach. */
function reach(root: THREE.Vector3, target: THREE.Vector3, max: number) {
  _c.subVectors(target, root);
  if (_c.length() > max) target.copy(root).addScaledVector(_c.normalize(), max);
}

const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 8);
const jointGeo = new THREE.SphereGeometry(1, 10, 8);

function limb(mat: THREE.Material, parent: THREE.Object3D): THREE.Mesh {
  const m = new THREE.Mesh(unitCyl, mat);
  parent.add(m);
  return m;
}
function joint(mat: THREE.Material, parent: THREE.Object3D): THREE.Mesh {
  const m = new THREE.Mesh(jointGeo, mat);
  parent.add(m);
  return m;
}
function setLimb(m: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3, r: number) {
  _c.subVectors(to, from);
  const len = Math.max(_c.length(), 0.001);
  m.position.addVectors(from, to).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, _c.divideScalar(len));
  m.scale.set(r, len, r);
}
function setJoint(m: THREE.Mesh, p: THREE.Vector3, r: number) {
  m.position.copy(p);
  m.scale.setScalar(r);
}

export interface PlayerEvents {
  onJump?: (fromRamp: boolean) => void;
  onLand?: (impact: number) => void;
  onSplash?: (x: number, y: number, z: number, amount: number) => void;
}

export class Player {
  /** world placement: x across the corridor, y = water surface + jump height */
  readonly root = new THREE.Group();
  private tilt = new THREE.Group();
  private board = new THREE.Group();
  private rider = new THREE.Group();
  private shield: THREE.Group;
  private magnet: THREE.Mesh;
  private shieldMat: THREE.MeshBasicMaterial;

  events: PlayerEvents = {};

  x = 0;
  vx = 0;
  /** height of the surfer's feet above the water */
  height = 0;
  vy = 0;
  grounded = true;
  crashed = false;
  private coyote = 0;
  private buffer = 0;
  private lean = 0;
  private crouch = 0.3;
  private armUp = 0;
  private waterY = 0;

  // crash ragdoll
  private riderVel = new THREE.Vector3();
  private riderSpin = new THREE.Vector3();
  private boardVel = new THREE.Vector3();
  private boardSpin = new THREE.Vector3();
  private splashed = false;

  // materials that follow the equipped skin
  private boardMat = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.15, emissiveIntensity: 0.32 });
  private railMat = new THREE.LineBasicMaterial({ color: 0xffffff });
  private suitMat = new THREE.MeshStandardMaterial({ color: 0x0e1024, roughness: 0.7, emissiveIntensity: 0.16 });
  private shortsMat = new THREE.MeshStandardMaterial({ color: 0x120820, roughness: 0.6, emissiveIntensity: 0.9 });
  private skinMat = new THREE.MeshStandardMaterial({ color: 0xe6b08a, roughness: 0.8, emissive: 0x3a1a0a, emissiveIntensity: 0.3 });
  private hairMat = new THREE.MeshStandardMaterial({ color: 0x160d0a, roughness: 0.9 });

  // rig parts
  private thighF: THREE.Mesh;
  private shinF: THREE.Mesh;
  private thighB: THREE.Mesh;
  private shinB: THREE.Mesh;
  private kneeF: THREE.Mesh;
  private kneeB: THREE.Mesh;
  private torso: THREE.Mesh;
  private shoulders: THREE.Mesh;
  private upperArmF: THREE.Mesh;
  private foreArmF: THREE.Mesh;
  private upperArmB: THREE.Mesh;
  private foreArmB: THREE.Mesh;
  private handF: THREE.Mesh;
  private handB: THREE.Mesh;
  private elbowF: THREE.Mesh;
  private elbowB: THREE.Mesh;
  private head: THREE.Mesh;
  private hair: THREE.Mesh;

  private v = {
    footF: new THREE.Vector3(),
    footB: new THREE.Vector3(),
    hipC: new THREE.Vector3(),
    hipF: new THREE.Vector3(),
    hipB: new THREE.Vector3(),
    kneeF: new THREE.Vector3(),
    kneeB: new THREE.Vector3(),
    chest: new THREE.Vector3(),
    shF: new THREE.Vector3(),
    shB: new THREE.Vector3(),
    handF: new THREE.Vector3(),
    handB: new THREE.Vector3(),
    elbowF: new THREE.Vector3(),
    elbowB: new THREE.Vector3(),
    bendLeg: new THREE.Vector3(0.5, 0.15, -0.7),
    bendArm: new THREE.Vector3(0.3, -1, 0),
    axis: new THREE.Vector3(),
  };

  constructor() {
    this.root.add(this.tilt);
    this.tilt.add(this.board, this.rider);
    this.buildBoard();

    const r = this.rider;
    this.thighF = limb(this.shortsMat, r);
    this.shinF = limb(this.skinMat, r);
    this.thighB = limb(this.shortsMat, r);
    this.shinB = limb(this.skinMat, r);
    this.kneeF = joint(this.skinMat, r);
    this.kneeB = joint(this.skinMat, r);
    this.torso = limb(this.suitMat, r);
    this.shoulders = limb(this.suitMat, r);
    this.upperArmF = limb(this.suitMat, r);
    this.foreArmF = limb(this.skinMat, r);
    this.upperArmB = limb(this.suitMat, r);
    this.foreArmB = limb(this.skinMat, r);
    this.elbowF = joint(this.skinMat, r);
    this.elbowB = joint(this.skinMat, r);
    this.handF = joint(this.skinMat, r);
    this.handB = joint(this.skinMat, r);
    this.head = joint(this.skinMat, r);
    this.hair = joint(this.hairMat, r);
    this.rider.scale.setScalar(1.12);

    // shield bubble + magnet field
    this.shieldMat = new THREE.MeshBasicMaterial({ color: 0x4da6ff, transparent: true, opacity: 0.16, depthWrite: false });
    this.shield = new THREE.Group();
    this.shield.add(new THREE.Mesh(new THREE.SphereGeometry(2.1, 24, 16), this.shieldMat));
    this.shield.add(
      new THREE.Mesh(
        new THREE.IcosahedronGeometry(2.14, 1),
        new THREE.MeshBasicMaterial({ color: 0x9fd6ff, wireframe: true, transparent: true, opacity: 0.35, depthWrite: false }),
      ),
    );
    this.shield.position.y = 1.0;
    this.shield.visible = false;
    this.root.add(this.shield);

    this.magnet = new THREE.Mesh(
      new THREE.RingGeometry(0.94, 1, 48),
      new THREE.MeshBasicMaterial({ color: 0x7dfcff, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.magnet.rotation.x = -Math.PI / 2;
    this.magnet.position.y = 0.12;
    this.magnet.visible = false;
    this.root.add(this.magnet);
  }

  private buildBoard() {
    const s = new THREE.Shape();
    s.moveTo(0, 1.6);
    s.bezierCurveTo(0.25, 1.2, 0.42, 0.5, 0.42, -0.1);
    s.bezierCurveTo(0.42, -0.9, 0.34, -1.3, 0.22, -1.5);
    s.lineTo(-0.22, -1.5);
    s.bezierCurveTo(-0.34, -1.3, -0.42, -0.9, -0.42, -0.1);
    s.bezierCurveTo(-0.42, 0.5, -0.25, 1.2, 0, 1.6);
    const geo = new THREE.ExtrudeGeometry(s, {
      depth: 0.08,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.03,
      bevelSegments: 2,
      curveSegments: 18,
    });
    geo.rotateX(-Math.PI / 2); // shape y (nose) -> -z (forward), extrusion -> up
    const deck = new THREE.Mesh(geo, this.boardMat);
    this.board.add(deck);

    // glowing rail outline + stringer
    const pts = s.getPoints(28).map((p) => new THREE.Vector3(p.x, 0.125, -p.y));
    this.board.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), this.railMat));
    const stringer = new THREE.Mesh(
      new THREE.BoxGeometry(0.035, 0.01, 2.7),
      new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    );
    stringer.position.set(0, 0.13, -0.05);
    this.board.add(stringer);
    this.board.position.y = 0.05;
  }

  setSkin(skin: Skin) {
    const core = new THREE.Color(skin.core);
    const glow = new THREE.Color(skin.glow);
    this.boardMat.color.copy(core).multiplyScalar(0.22);
    this.boardMat.emissive.copy(core);
    this.railMat.color.copy(glow).multiplyScalar(1.6);
    this.suitMat.emissive.copy(glow);
    this.shortsMat.emissive.copy(core);
  }

  reset() {
    this.x = 0;
    this.vx = 0;
    this.height = 0;
    this.vy = 0;
    this.grounded = true;
    this.crashed = false;
    this.coyote = 0;
    this.buffer = 0;
    this.lean = 0;
    this.crouch = 0.3;
    this.armUp = 0;
    this.splashed = false;
    this.board.position.set(0, 0.05, 0);
    this.board.rotation.set(0, 0, 0);
    this.rider.position.set(0, 0, 0);
    this.rider.rotation.set(0, 0, 0);
    this.tilt.rotation.set(0, 0, 0);
    this.shield.visible = false;
    this.magnet.visible = false;
    this.root.visible = true;
  }

  /** Buffer a jump press; it fires as soon as the surfer is (or just was) on the water. */
  requestJump() {
    this.buffer = PHYSICS.buffer;
  }

  /** Called when the surfer rides off a ramp's lip. */
  launch() {
    this.vy = PHYSICS.rampV;
    this.grounded = false;
    this.coyote = 0;
    this.events.onJump?.(true);
  }

  update(dt: number, steer: number, ground: number, scroll: number, time: number, worldSpeed: number, speedFactor: number) {
    // ---- sideways
    this.vx = damp(this.vx, steer * PHYSICS.latSpeed, PHYSICS.smoothing, dt);
    this.x += this.vx * dt;
    if (Math.abs(this.x) > PHYSICS.bound) {
      this.x = clamp(this.x, -PHYSICS.bound, PHYSICS.bound);
      this.vx = 0;
    }

    // ---- vertical
    this.buffer = Math.max(0, this.buffer - dt);
    this.coyote = this.grounded ? PHYSICS.coyote : Math.max(0, this.coyote - dt);
    if (this.buffer > 0 && this.coyote > 0) {
      this.vy = PHYSICS.jumpV;
      this.grounded = false;
      this.coyote = 0;
      this.buffer = 0;
      this.height = Math.max(this.height, ground) + 0.001;
      this.events.onJump?.(false);
    }
    if (!this.grounded || this.height > ground + 0.001) {
      this.vy -= PHYSICS.gravity * dt;
      this.height += this.vy * dt;
      if (this.height <= ground) {
        const impact = -this.vy;
        this.height = ground;
        this.vy = 0;
        if (!this.grounded) {
          this.grounded = true;
          this.crouch += clamp(impact / 28, 0, 0.55);
          this.events.onLand?.(impact);
        }
      } else {
        this.grounded = false;
      }
    } else {
      this.height = ground;
      this.grounded = true;
      this.vy = 0;
    }

    this.pose(dt, scroll, time, worldSpeed, speedFactor, ground);
  }

  /** Place the model on the swell and animate the rider. Runs in every state that shows the surfer. */
  pose(dt: number, scroll: number, time: number, worldSpeed: number, speedFactor: number, ground: number) {
    this.waterY = waveHeight(this.x, -scroll, time);
    this.root.position.set(this.x, this.waterY + this.height, 0);

    // ride the swell: pitch to the water's slope under the board, plus nose-up/down with vertical speed
    const slope = (waveHeight(this.x, -1.5 - scroll, time) - waveHeight(this.x, 1.5 - scroll, time)) / 3;
    const onRamp = ground > 0.02 && this.grounded;
    const pitch = Math.atan(slope) * (this.grounded ? 1 : 0.4) + clamp(this.vy * 0.016, -0.32, 0.32) + (onRamp ? 0.3 : 0);
    const vxN = clamp(this.vx / PHYSICS.latSpeed, -1, 1);
    this.lean = damp(this.lean, vxN, 0.8, dt);
    this.tilt.rotation.set(pitch, -this.lean * 0.34, -this.lean * 0.5, "YXZ");

    if (this.crashed) {
      this.animateCrash(dt, worldSpeed);
      return;
    }

    // ---- rider pose
    const airborne = !this.grounded;
    const crouchTarget = airborne ? (this.vy > 0 ? 0.02 : 0.2) : 0.34 + 0.05 * Math.sin(time * 4) + speedFactor * 0.08 + Math.abs(this.lean) * 0.16;
    this.crouch = damp(this.crouch, crouchTarget, airborne ? 0.7 : 0.82, dt);
    this.armUp = damp(this.armUp, airborne ? 1 : 0, 0.8, dt);

    const v = this.v;
    v.footF.set(0, 0.16, -0.42);
    v.footB.set(0, 0.16, 0.4);
    const hipY = 1.02 - this.crouch * 0.42;
    v.hipC.set(this.lean * 0.05, hipY, 0);
    v.hipF.copy(v.hipC).add(_c.set(0, 0, -0.13));
    v.hipB.copy(v.hipC).add(_c.set(0, 0, 0.13));
    solveJoint(v.hipF, v.footF, 0.52, 0.52, v.bendLeg, v.kneeF);
    solveJoint(v.hipB, v.footB, 0.52, 0.52, v.bendLeg, v.kneeB);
    setLimb(this.thighF, v.hipF, v.kneeF, 0.13);
    setLimb(this.shinF, v.kneeF, v.footF, 0.1);
    setLimb(this.thighB, v.hipB, v.kneeB, 0.13);
    setLimb(this.shinB, v.kneeB, v.footB, 0.1);
    setJoint(this.kneeF, v.kneeF, 0.11);
    setJoint(this.kneeB, v.kneeB, 0.11);

    // torso turned three-quarters away from the camera, leaning into the carve
    const yaw = -1.05 + this.lean * 0.3;
    v.axis.set(Math.cos(yaw) * 0.23, 0, -Math.sin(yaw) * 0.23);
    v.chest.copy(v.hipC).add(_c.set(this.lean * 0.16, 0.62 - this.crouch * 0.1, -0.06 - this.crouch * 0.12));
    v.shF.copy(v.chest).sub(v.axis);
    v.shB.copy(v.chest).add(v.axis);
    setLimb(this.torso, _b.copy(v.hipC).add(_c.set(0, 0.06, 0)), v.chest, 0.19);
    setLimb(this.shoulders, v.shF, v.shB, 0.11);

    const sway = Math.sin(time * 3.1) * 0.05;
    const up = this.armUp;
    v.handF.copy(v.shF).add(_c.set(0.3 + this.lean * 0.3, -0.42 + up * 0.75 + sway, -0.5 - up * 0.1));
    v.handB.copy(v.shB).add(_c.set(0.34 + this.lean * 0.3, -0.5 + up * 0.7 - sway, 0.4 + up * 0.05));
    reach(v.shF, v.handF, 0.6);
    reach(v.shB, v.handB, 0.6);
    solveJoint(v.shF, v.handF, 0.31, 0.3, v.bendArm, v.elbowF);
    solveJoint(v.shB, v.handB, 0.31, 0.3, v.bendArm, v.elbowB);
    setLimb(this.upperArmF, v.shF, v.elbowF, 0.085);
    setLimb(this.foreArmF, v.elbowF, v.handF, 0.07);
    setLimb(this.upperArmB, v.shB, v.elbowB, 0.085);
    setLimb(this.foreArmB, v.elbowB, v.handB, 0.07);
    setJoint(this.elbowF, v.elbowF, 0.085);
    setJoint(this.elbowB, v.elbowB, 0.085);
    setJoint(this.handF, v.handF, 0.085);
    setJoint(this.handB, v.handB, 0.085);

    const headP = _c.copy(v.chest).add(_b.set(0, 0.34, -0.03));
    setJoint(this.head, headP, 0.18);
    this.hair.position.copy(headP).add(_b.set(0, 0.035, 0.05));
    this.hair.scale.set(0.2, 0.19, 0.2);

    // magnet / shield follow the surfer
    if (this.magnet.visible) {
      const pulse = (time * 1.2) % 1;
      this.magnet.scale.setScalar(2 + pulse * 8);
      (this.magnet.material as THREE.MeshBasicMaterial).opacity = 0.4 * (1 - pulse);
    }
    if (this.shield.visible) {
      const p = 1 + Math.sin(time * 8) * 0.03;
      this.shield.scale.setScalar(p);
      this.shield.rotation.y = time * 0.6;
    }
  }

  setBuffs(shield: boolean, magnet: boolean) {
    this.shield.visible = shield && !this.crashed;
    this.magnet.visible = magnet && !this.crashed;
  }

  /** Wipe out: the rider and board fly apart. */
  crash(worldSpeed: number) {
    this.crashed = true;
    this.shield.visible = false;
    this.magnet.visible = false;
    const fwd = -Math.min(worldSpeed * 0.28, 12);
    this.riderVel.set(THREE.MathUtils.randFloatSpread(5), 7.5 + Math.random() * 2, fwd);
    this.riderSpin.set(THREE.MathUtils.randFloatSpread(9), THREE.MathUtils.randFloatSpread(6), THREE.MathUtils.randFloatSpread(9));
    this.boardVel.set(THREE.MathUtils.randFloatSpread(7), 5 + Math.random() * 2, fwd * 0.6);
    this.boardSpin.set(THREE.MathUtils.randFloatSpread(7), THREE.MathUtils.randFloatSpread(9), THREE.MathUtils.randFloatSpread(7));
  }

  private animateCrash(dt: number, worldSpeed: number) {
    const g = 26;
    for (const [obj, vel, spin] of [
      [this.rider, this.riderVel, this.riderSpin],
      [this.board, this.boardVel, this.boardSpin],
    ] as const) {
      vel.y -= g * dt;
      obj.position.x += vel.x * dt;
      obj.position.y += vel.y * dt;
      obj.position.z += vel.z * dt + worldSpeed * dt;
      obj.rotation.x += spin.x * dt;
      obj.rotation.y += spin.y * dt;
      obj.rotation.z += spin.z * dt;
    }
    // once the rider drops back to the sea: splash, then slowly sink out of sight
    const worldY = this.root.position.y + this.rider.position.y;
    if (this.rider.position.y < 0.2 && this.riderVel.y < 0 && worldY < this.waterY + 0.6) {
      if (!this.splashed) {
        this.splashed = true;
        this.events.onSplash?.(this.root.position.x + this.rider.position.x, this.waterY, this.rider.position.z, 1.6);
      }
      this.riderVel.y = -0.8;
      this.riderVel.x *= 0.9;
      this.riderSpin.multiplyScalar(0.92);
    }
    if (this.board.position.y < 0.05 && this.boardVel.y < 0) {
      this.boardVel.set(this.boardVel.x * 0.94, 0, this.boardVel.z * 0.94);
      this.boardSpin.multiplyScalar(0.9);
      this.board.position.y = 0.05;
    }
  }

  /** World-space position of the board's tail, for wake and spray. */
  tailWorld(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.x, this.waterY + this.height + 0.05, 1.4);
  }

  get waterLevel() {
    return this.waterY;
  }
}
