import * as THREE from "three";
import { waveHeight } from "./waves";

export type PickupKind = "coin" | "star" | "shield" | "magnet" | "multiplier" | "slowmo";

export interface PickupSpec {
  kind: PickupKind;
  x: number;
  /** height above the water */
  y: number;
  /** distance along the track */
  d: number;
}

export interface Pickup {
  kind: PickupKind;
  group: THREE.Group;
  x: number;
  y: number;
  z: number;
  u: number;
  phase: number;
  collected: boolean;
  /** radius around the surfer's center within which it's grabbed */
  radius: number;
}

const POWER_STYLE: Record<Exclude<PickupKind, "coin" | "star">, { color: string; label: string }> = {
  shield: { color: "#4da6ff", label: "🛡" },
  magnet: { color: "#7dfcff", label: "🧲" },
  multiplier: { color: "#ffe873", label: "2×" },
  slowmo: { color: "#b26bff", label: "🐢" },
};

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.4, "rgba(255,255,255,0.25)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function iconTexture(label: string, color: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(5,1,15,0.82)";
  g.beginPath();
  g.arc(64, 64, 58, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = color;
  g.stroke();
  g.fillStyle = color;
  g.font = "bold 60px 'Segoe UI Emoji','Apple Color Emoji','Segoe UI',sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(label, 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class PickupAssets {
  private coinGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.1, 20).rotateX(Math.PI / 2);
  private coinRim = new THREE.TorusGeometry(0.46, 0.06, 6, 20);
  private coinMat = new THREE.MeshStandardMaterial({ color: 0x3a2a00, roughness: 0.3, metalness: 0.6, emissive: 0xffc61a, emissiveIntensity: 0.9 });
  private starGeo = new THREE.OctahedronGeometry(0.62, 0);
  private starMat = new THREE.MeshStandardMaterial({ color: 0x06202a, roughness: 0.3, emissive: 0x7dfcff, emissiveIntensity: 1.3, flatShading: true });
  private ringGeo = new THREE.TorusGeometry(0.86, 0.05, 6, 28);
  private glowTex = glowTexture();
  private icons = new Map<string, THREE.CanvasTexture>();

  private glow(color: string, scale: number): THREE.Sprite {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.glowTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.7 }),
    );
    s.scale.setScalar(scale);
    return s;
  }

  make(kind: PickupKind): { group: THREE.Group; radius: number } {
    const g = new THREE.Group();
    if (kind === "coin") {
      g.add(new THREE.Mesh(this.coinGeo, this.coinMat));
      g.add(new THREE.Mesh(this.coinRim, this.coinMat));
      g.add(this.glow("#ffc61a", 2.4));
      return { group: g, radius: 1.15 };
    }
    if (kind === "star") {
      g.add(new THREE.Mesh(this.starGeo, this.starMat));
      g.add(this.glow("#7dfcff", 3.4));
      return { group: g, radius: 1.35 };
    }
    const style = POWER_STYLE[kind];
    let tex = this.icons.get(kind);
    if (!tex) {
      tex = iconTexture(style.label, style.color);
      this.icons.set(kind, tex);
    }
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sprite.scale.setScalar(1.6);
    g.add(sprite);
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: style.color, toneMapped: false }));
    ring.name = "ring";
    g.add(ring);
    g.add(this.glow(style.color, 3.6));
    return { group: g, radius: 1.6 };
  }
}

export const pickupAssets = new PickupAssets();

export function createPickup(spec: PickupSpec, z: number, scroll: number): Pickup {
  const { group, radius } = pickupAssets.make(spec.kind);
  group.position.set(spec.x, spec.y, z);
  return {
    kind: spec.kind,
    group,
    x: spec.x,
    y: spec.y,
    z,
    u: z - scroll,
    phase: Math.random() * Math.PI * 2,
    collected: false,
    radius,
  };
}

export function updatePickup(p: Pickup, time: number) {
  const bob = Math.sin(time * 3 + p.phase) * 0.12;
  const w = waveHeight(p.x, p.u, time) * 0.85; // ride the swell just like the obstacles do
  p.group.position.set(p.x, p.y + w + bob, p.z);
  if (p.kind === "coin") p.group.rotation.y = time * 3.2 + p.phase;
  else if (p.kind === "star") {
    p.group.rotation.y = time * 2 + p.phase;
    p.group.rotation.x = Math.sin(time * 1.5 + p.phase) * 0.4;
  } else {
    const ring = p.group.getObjectByName("ring");
    if (ring) ring.rotation.y = time * 2.5;
  }
}
