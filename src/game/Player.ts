import { clamp, damp, darken } from "./utils";
import type { Skin } from "./Skins";

/**
 * Direct up/down control, no gravity: holding up/down drives the player's
 * velocity toward a target speed (damped, so it still has a little weight
 * instead of snapping instantly); letting go of both brings it to a stop -
 * the board just hovers in place rather than falling.
 */
export const PHYSICS = {
  moveSpeed: 620, // target vertical speed while holding a direction
  // damp() smoothing base: fraction of the gap to the target speed that's
  // still left after one 60fps frame. Closer to 0 = snaps almost instantly,
  // closer to 1 = floaty. ~0.55 reaches full speed in well under a quarter
  // second - snappy arcade steering, not an instant teleport-to-speed.
  smoothing: 0.55,
  radius: 15,
  playerX: 210,
};

export interface TrailPoint {
  x: number;
  y: number;
  life: number; // 0..1, fades out
}

export class Player {
  x = PHYSICS.playerX;
  y = 360;
  vy = 0;
  angle = 0;
  radius = PHYSICS.radius;
  trail: TrailPoint[] = [];
  private trailTimer = 0;
  alive = true;

  // Set by Game each frame from the active power-up timers - purely visual.
  shieldActive = false;
  magnetActive = false;

  reset(startY: number) {
    this.y = startY;
    this.vy = 0;
    this.angle = 0;
    this.trail = [];
    this.alive = true;
    this.shieldActive = false;
    this.magnetActive = false;
  }

  update(dt: number, thrustUp: boolean, thrustDown: boolean, worldHeight: number, worldSpeed: number) {
    let targetVy = 0;
    if (thrustUp && !thrustDown) targetVy = -PHYSICS.moveSpeed;
    else if (thrustDown && !thrustUp) targetVy = PHYSICS.moveSpeed;

    this.vy = damp(this.vy, targetVy, PHYSICS.smoothing, dt);
    this.y += this.vy * dt;

    // Clamp to the play field and kill velocity on the wall so it doesn't
    // "wind up" a burst of speed the instant you steer away from the edge.
    const clampedY = clamp(this.y, this.radius, worldHeight - this.radius);
    if (clampedY !== this.y) this.vy = 0;
    this.y = clampedY;

    // Tilt toward the direction of travel - purely cosmetic, sells the "carving" feel
    const targetAngle = clamp(this.vy / PHYSICS.moveSpeed, -1, 1) * 0.35;
    this.angle += (targetAngle - this.angle) * Math.min(1, dt * 10);

    this.trailTimer -= dt;
    if (this.trailTimer <= 0) {
      this.trailTimer = 0.016;
      this.trail.push({ x: this.x, y: this.y, life: 1 });
      if (this.trail.length > 40) this.trail.shift();
    }
    // The player's screen x never moves - the world scrolls under it instead -
    // so drift each wake point back at the same speed to leave it behind in
    // the water, rather than stacking straight up/down under the board.
    for (const p of this.trail) {
      p.life -= dt * 1.6;
      p.x -= worldSpeed * dt;
    }
    this.trail = this.trail.filter((p) => p.life > 0);
  }

  draw(ctx: CanvasRenderingContext2D, skin: Skin, time: number) {
    // wake trail
    for (const p of this.trail) {
      const r = this.radius * 0.6 * p.life;
      if (r <= 0.3) continue;
      ctx.beginPath();
      ctx.fillStyle = skin.trail;
      ctx.globalAlpha = p.life * 0.5;
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (this.magnetActive) {
      // faint pulsing field showing the coin-pull radius is centered here
      const pulse = 0.5 + 0.5 * Math.sin(time * 4);
      ctx.beginPath();
      ctx.strokeStyle = "rgba(125, 252, 255, 0.35)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 8]);
      ctx.arc(this.x, this.y, this.radius * (2.4 + pulse * 0.6), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (this.shieldActive) {
      // protective bubble - a clear "you can't crash right now" tell
      const pulse = 1 + Math.sin(time * 8) * 0.08;
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.shadowColor = "#4da6ff";
      ctx.shadowBlur = 18;
      ctx.strokeStyle = "rgba(125, 200, 255, 0.85)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, this.radius * 2.5 * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(77, 166, 255, 0.12)";
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    const len = this.radius * 2.6; // nose-to-tail half-length
    const th = this.radius * 0.4; // half-thickness, deck to bottom - a real board seen edge-on is thin

    // ---- classic shortboard silhouette, seen from the side (the view a
    // rider on it would actually have): pointed nose (+x, facing the
    // direction of travel), a thin flat-ish deck and bottom, and a straight
    // taper down to a flat squash tail (-x) - no swallowtail notch, just a
    // real board's tail line. ----
    const pulse = 1 + Math.sin(time * 6) * 0.08;
    ctx.shadowColor = skin.glow;
    ctx.shadowBlur = 22 * pulse;
    ctx.fillStyle = darken(skin.core, 0.35);
    ctx.beginPath();
    ctx.moveTo(len, 0); // nose tip
    ctx.quadraticCurveTo(len * 0.75, -th * 1.6, len * 0.05, -th); // nose -> deck
    ctx.lineTo(-len * 0.92, -th * 0.7); // flat deck back to the tail
    ctx.lineTo(-len * 0.92, th * 0.7); // flat tail edge, straight down
    ctx.lineTo(len * 0.05, th); // tail -> bottom, flat bottom
    ctx.quadraticCurveTo(len * 0.75, th * 1.6, len, 0); // bottom -> nose
    ctx.closePath();
    ctx.fill();

    // stringer (the pinstripe running down the middle of a real surfboard)
    ctx.shadowBlur = 6;
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = Math.max(1, this.radius * 0.08);
    ctx.beginPath();
    ctx.moveTo(len * 0.92, 0);
    ctx.lineTo(-len * 0.9, 0);
    ctx.stroke();

    // bright deck highlight near the nose
    ctx.shadowBlur = 8;
    ctx.fillStyle = "#ffffff";
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.ellipse(len * 0.4, -th * 0.6, this.radius * 0.35, this.radius * 0.12, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // tail fin, trailing below the board - visible from the side
    ctx.shadowBlur = 14;
    ctx.fillStyle = skin.glow;
    ctx.beginPath();
    ctx.moveTo(-len * 0.62, th * 0.7);
    ctx.lineTo(-len * 0.85, th * 1.9);
    ctx.lineTo(-len * 0.45, th * 0.9);
    ctx.closePath();
    ctx.fill();

    // ---- rider: a tiny neon stick-figure standing on the deck, seen from
    // the side. It leans into whichever way the board is steered and bobs
    // gently at rest, so it never looks frozen even mid-glide. ----
    const lean = clamp(this.vy / PHYSICS.moveSpeed, -1, 1); // -1 climbing, +1 diving
    const bob = Math.sin(time * 5) * this.radius * 0.06;
    const standX = len * 0.1; // stance over the board's widest point
    const hipY = -th * 0.9; // feet planted on the deck surface, not the board's centerline
    const shoulderX = standX + lean * this.radius * 0.5; // torso leans into the turn
    const shoulderY = hipY - this.radius * 1.7 + bob;
    const headR = this.radius * 0.3;

    ctx.shadowColor = skin.glow;
    ctx.shadowBlur = 8;
    ctx.strokeStyle = "#0a0a0f";
    ctx.lineWidth = Math.max(1.2, this.radius * 0.11);
    ctx.lineCap = "round";

    // legs, planted shoulder-width apart, knees bending toward the lean
    ctx.beginPath();
    ctx.moveTo(standX - this.radius * 0.4, hipY - this.radius * 0.1);
    ctx.lineTo(shoulderX, shoulderY + headR);
    ctx.moveTo(standX + this.radius * 0.4, hipY - this.radius * 0.1);
    ctx.lineTo(shoulderX, shoulderY + headR);
    ctx.stroke();

    // arms, swinging out opposite the lean for balance
    ctx.beginPath();
    ctx.moveTo(shoulderX, shoulderY + headR * 0.6);
    ctx.lineTo(shoulderX - this.radius * 0.9, shoulderY - lean * this.radius * 0.7);
    ctx.moveTo(shoulderX, shoulderY + headR * 0.6);
    ctx.lineTo(shoulderX + this.radius * 0.9, shoulderY + lean * this.radius * 0.7);
    ctx.stroke();

    // head
    ctx.shadowBlur = 10;
    ctx.fillStyle = "#0a0a0f";
    ctx.beginPath();
    ctx.arc(shoulderX, shoulderY, headR, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
    ctx.shadowBlur = 0;
  }
}
