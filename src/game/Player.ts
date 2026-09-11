import { clamp, damp } from "./utils";
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

  reset(startY: number) {
    this.y = startY;
    this.vy = 0;
    this.angle = 0;
    this.trail = [];
    this.alive = true;
  }

  update(dt: number, thrustUp: boolean, thrustDown: boolean, worldHeight: number) {
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
    for (const p of this.trail) p.life -= dt * 1.6;
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

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    const len = this.radius * 2.6; // nose-to-tail half-length
    const wid = this.radius * 0.95; // widest half-width, at the shoulder just ahead of center

    // ---- classic shortboard silhouette, lying on its side: rounded nose
    // (+x, facing the direction of travel), straight-ish parallel rails,
    // and a proper swallowtail - two pointed horns with a V notch between
    // them - at the tail (-x). ----
    const pulse = 1 + Math.sin(time * 6) * 0.08;
    ctx.shadowColor = skin.glow;
    ctx.shadowBlur = 22 * pulse;
    ctx.fillStyle = skin.core;
    ctx.beginPath();
    ctx.moveTo(len, 0); // nose tip
    ctx.quadraticCurveTo(len * 0.75, -wid * 1.05, len * 0.05, -wid); // nose -> shoulder, top rail
    ctx.lineTo(-len * 0.5, -wid * 0.92); // shoulder -> top rail, nearly straight down the board
    ctx.quadraticCurveTo(-len * 0.72, -wid * 0.95, -len * 0.82, -wid * 1.2); // flare out into the top tail horn (wider than the body)
    ctx.lineTo(-len * 0.6, 0); // deep V notch, cut inward all the way to the tail center
    ctx.lineTo(-len * 0.82, wid * 1.2); // back out to the bottom tail horn
    ctx.quadraticCurveTo(-len * 0.72, wid * 0.95, -len * 0.5, wid * 0.92); // tail horn -> bottom rail
    ctx.quadraticCurveTo(len * 0.75, wid * 1.05, len, 0); // shoulder -> nose, bottom rail
    ctx.closePath();
    ctx.fill();

    // stringer (the pinstripe running down the middle of a real surfboard)
    ctx.shadowBlur = 6;
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = Math.max(1, this.radius * 0.08);
    ctx.beginPath();
    ctx.moveTo(len * 0.92, 0);
    ctx.lineTo(-len * 0.62, 0);
    ctx.stroke();

    // bright deck highlight near the nose
    ctx.shadowBlur = 8;
    ctx.fillStyle = "#ffffff";
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.ellipse(len * 0.4, -wid * 0.35, this.radius * 0.4, this.radius * 0.2, -0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // tail fin, trailing underneath
    ctx.shadowBlur = 14;
    ctx.fillStyle = skin.glow;
    ctx.beginPath();
    ctx.moveTo(-len * 0.5, wid * 0.5);
    ctx.lineTo(-len * 0.75, wid * 1.3);
    ctx.lineTo(-len * 0.3, wid * 0.7);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
    ctx.shadowBlur = 0;
  }
}
