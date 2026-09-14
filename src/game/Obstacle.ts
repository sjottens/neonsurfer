import type { Player } from "./Player";
import { darken, withAlpha } from "./utils";

export type ObstacleKind = "gateWalls" | "spikes" | "movingGate" | "rotor";
export type PickupKind = "coin" | "star" | "shield" | "magnet" | "multiplier" | "slowmo" | null;

export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  x: number; // center x in world/virtual space, moves left over time
  width: number;
  worldHeight: number;
  age: number; // seconds since spawn, used for animated kinds
  passed: boolean; // already scored for clearing it
  shieldHit: boolean; // already bounced off a shielded player - don't re-spark every frame
  pickup: PickupKind;
  pickupCollected: boolean;
  pickupY: number;
  // Nudged toward the player while a magnet is active (coins only) - the
  // pickup's drawn/collected position is (x + offsetX, pickupY + offsetY).
  pickupOffsetX: number;
  pickupOffsetY: number;

  // gateWalls / spikes / movingGate share a "gap" shape
  gapCenter: number;
  gapSize: number;
  gapAmplitude: number; // >0 for movingGate
  gapSpeed: number; // oscillation speed for movingGate

  // rotor
  rotorLength: number;
  rotorSpeed: number; // rad/s
  rotorBaseAngle: number;
}

const THICKNESS_MARGIN = 0; // gap math already accounts for full top/bottom blocks

/** Current gap center for animated obstacles, given elapsed age. */
function currentGapCenter(o: Obstacle): number {
  if (o.kind !== "movingGate") return o.gapCenter;
  return o.gapCenter + Math.sin(o.age * o.gapSpeed) * o.gapAmplitude;
}

export function updateObstacle(o: Obstacle, dt: number, scrollSpeed: number) {
  o.age += dt;
  o.x -= scrollSpeed * dt;
}

/** Circle-vs-obstacle collision. Returns true on impact. */
export function checkCollision(o: Obstacle, player: Player): boolean {
  const halfW = o.width / 2;
  const left = o.x - halfW;
  const right = o.x + halfW;

  if (o.kind === "rotor") {
    // player must be roughly within the rotor's horizontal footprint to bother testing
    if (player.x + player.radius < left - o.rotorLength || player.x - player.radius > right + o.rotorLength) {
      return false;
    }
    const angle = o.rotorBaseAngle + o.age * o.rotorSpeed;
    const cx = o.x;
    const cy = o.gapCenter;
    const ex = cx + Math.cos(angle) * o.rotorLength;
    const ey = cy + Math.sin(angle) * o.rotorLength;
    const dist = distanceToSegment(player.x, player.y, cx, cy, ex, ey);
    // also collide with the small hub
    const hubDist = Math.hypot(player.x - cx, player.y - cy);
    return dist < player.radius + 6 || hubDist < player.radius + 14;
  }

  // gap-based kinds (gateWalls / spikes / movingGate)
  if (player.x + player.radius < left || player.x - player.radius > right) return false;

  const gapCenter = currentGapCenter(o);
  const gapTop = gapCenter - o.gapSize / 2;
  const gapBottom = gapCenter + o.gapSize / 2;

  const withinGap = player.y - player.radius > gapTop + THICKNESS_MARGIN && player.y + player.radius < gapBottom - THICKNESS_MARGIN;
  return !withinGap;
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const abLenSq = abx * abx + aby * aby || 1;
  let t = (apx * abx + apy * aby) / abLenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  return Math.hypot(px - cx, py - cy);
}

export function drawObstacle(ctx: CanvasRenderingContext2D, o: Obstacle, worldHeight: number, time: number, color: string) {
  const halfW = o.width / 2;
  const left = o.x - halfW;

  if (o.kind === "rotor") {
    drawRotor(ctx, o, color);
  } else {
    const gapCenter = currentGapCenter(o);
    const gapTop = gapCenter - o.gapSize / 2;
    const gapBottom = gapCenter + o.gapSize / 2;
    const jagged = o.kind === "spikes";
    drawBlock(ctx, { x: left, y: 0, w: o.width, h: gapTop }, { jagged, spikeSide: "bottom", color });
    drawBlock(ctx, { x: left, y: gapBottom, w: o.width, h: worldHeight - gapBottom }, { jagged, spikeSide: "top", color });
  }

  if (o.pickup && !o.pickupCollected) {
    drawPickup(ctx, o.x + o.pickupOffsetX, o.pickupY + o.pickupOffsetY, o.pickup, time);
  }
}

function drawBlock(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  opts: { jagged: boolean; spikeSide: "top" | "bottom"; color: string },
) {
  const { x, y, w, h } = rect;
  const { jagged, spikeSide, color } = opts;
  if (h <= 0) return;
  ctx.save();
  ctx.shadowColor = withAlpha(color, 0.85);
  ctx.shadowBlur = 16;
  const grad = ctx.createLinearGradient(x, y, x + w, y);
  grad.addColorStop(0, "rgba(20, 6, 40, 0.92)");
  grad.addColorStop(0.5, "rgba(60, 12, 90, 0.92)");
  grad.addColorStop(1, "rgba(20, 6, 40, 0.92)");
  ctx.fillStyle = grad;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;

  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.fill();
  ctx.stroke();

  if (jagged) {
    const edgeY = spikeSide === "top" ? y + h : y;
    const dir = spikeSide === "top" ? -1 : 1;
    const spikeCount = Math.max(2, Math.round(w / 26));
    const spikeW = w / spikeCount;
    ctx.fillStyle = color;
    ctx.shadowBlur = 20;
    for (let i = 0; i < spikeCount; i++) {
      const sx = x + i * spikeW;
      ctx.beginPath();
      ctx.moveTo(sx, edgeY);
      ctx.lineTo(sx + spikeW / 2, edgeY + dir * 22);
      ctx.lineTo(sx + spikeW, edgeY);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawRotor(ctx: CanvasRenderingContext2D, o: Obstacle, color: string) {
  const angle = o.rotorBaseAngle + o.age * o.rotorSpeed;
  const cx = o.x;
  const cy = o.gapCenter;
  const ex = cx + Math.cos(angle) * o.rotorLength;
  const ey = cy + Math.sin(angle) * o.rotorLength;
  const ex2 = cx - Math.cos(angle) * o.rotorLength;
  const ey2 = cy - Math.sin(angle) * o.rotorLength;

  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  ctx.strokeStyle = darken(color, -0.25); // lighter blade highlight
  ctx.lineWidth = 10;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(ex2, ey2);
  ctx.lineTo(ex, ey);
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(cx, cy, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPickup(ctx: CanvasRenderingContext2D, x: number, y: number, kind: PickupKind, time: number) {
  const bob = Math.sin(time * 4 + x * 0.05) * 6;
  const spin = time * 3;
  ctx.save();
  ctx.translate(x, y + bob);

  if (kind === "coin") {
    ctx.shadowColor = "#ffe873";
    ctx.shadowBlur = 16;
    ctx.fillStyle = "#ffe873";
    const squash = Math.abs(Math.cos(spin));
    ctx.beginPath();
    ctx.ellipse(0, 0, 11 * squash + 2, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff6d6";
    ctx.beginPath();
    ctx.ellipse(0, 0, (11 * squash + 2) * 0.5, 5.5, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === "star") {
    ctx.rotate(spin * 0.6);
    ctx.shadowColor = "#7dfcff";
    ctx.shadowBlur = 22;
    ctx.fillStyle = "#dffcff";
    drawStarPath(ctx, 0, 0, 5, 15, 7);
    ctx.fill();
  } else if (kind === "shield") {
    // the "blue star" power-up: a few seconds of invincibility
    ctx.rotate(spin * 0.6);
    ctx.shadowColor = "#4da6ff";
    ctx.shadowBlur = 24;
    ctx.fillStyle = "#a9d8ff";
    drawStarPath(ctx, 0, 0, 5, 16, 7.5);
    ctx.fill();
    ctx.strokeStyle = "#0b3d91";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else if (kind === "magnet") {
    // classic horseshoe magnet - pulls nearby coins toward the player
    ctx.shadowColor = "#7dfcff";
    ctx.shadowBlur = 18;
    ctx.rotate(Math.PI); // open end faces down
    ctx.strokeStyle = "#dfe6ee";
    ctx.lineWidth = 6;
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.arc(0, 0, 9, Math.PI * 0.15, Math.PI * 0.85, false);
    ctx.stroke();
    ctx.fillStyle = "#ff4d4d";
    ctx.fillRect(-11.5, -1, 5, 8);
    ctx.fillStyle = "#4da6ff";
    ctx.fillRect(6.5, -1, 5, 8);
  } else if (kind === "multiplier") {
    // 2x score for a few seconds
    ctx.rotate(Math.PI / 4);
    ctx.shadowColor = "#ffe873";
    ctx.shadowBlur = 20;
    ctx.fillStyle = "#ffe873";
    ctx.fillRect(-11, -11, 22, 22);
    ctx.rotate(-Math.PI / 4);
    ctx.shadowBlur = 4;
    ctx.fillStyle = "#3a2b00";
    ctx.font = "bold 13px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("2×", 0, 1);
  } else if (kind === "slowmo") {
    // briefly slows the world down without slowing the player's own steering
    ctx.shadowColor = "#b26bff";
    ctx.shadowBlur = 20;
    ctx.strokeStyle = "#e7d4ff";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -7);
    ctx.moveTo(0, 0);
    ctx.lineTo(5, 3);
    ctx.stroke();
  }
  ctx.restore();
}

function drawStarPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, spikes: number, outerR: number, innerR: number) {
  let rot = (Math.PI / 2) * 3;
  const step = Math.PI / spikes;
  ctx.beginPath();
  ctx.moveTo(cx, cy - outerR);
  for (let i = 0; i < spikes; i++) {
    let x = cx + Math.cos(rot) * outerR;
    let y = cy + Math.sin(rot) * outerR;
    ctx.lineTo(x, y);
    rot += step;
    x = cx + Math.cos(rot) * innerR;
    y = cy + Math.sin(rot) * innerR;
    ctx.lineTo(x, y);
    rot += step;
  }
  ctx.lineTo(cx, cy - outerR);
  ctx.closePath();
}
