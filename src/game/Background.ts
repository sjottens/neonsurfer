import { randRange } from "./utils";

interface Star {
  x: number;
  y: number;
  size: number;
  speed: number;
  twinklePhase: number;
}

/**
 * Layered synthwave backdrop: a deep gradient sky, a slow starfield, and a
 * scrolling neon horizon grid whose lines converge toward a vanishing point.
 * Everything is drawn procedurally - no image assets.
 */
export class Background {
  private stars: Star[] = [];
  private gridOffset = 0;
  private hue = 260;

  constructor(width: number, height: number, rng: () => number = Math.random) {
    const count = 90;
    for (let i = 0; i < count; i++) {
      this.stars.push({
        x: randRange(rng, 0, width),
        y: randRange(rng, 0, height * 0.65),
        size: randRange(rng, 0.6, 2.2),
        speed: randRange(rng, 6, 24),
        twinklePhase: randRange(rng, 0, Math.PI * 2),
      });
    }
  }

  update(dt: number, scrollSpeed: number, difficulty: number) {
    this.gridOffset = (this.gridOffset + scrollSpeed * dt * 0.5) % 48;
    for (const s of this.stars) {
      s.x -= s.speed * dt;
      if (s.x < -4) s.x += 2000;
    }
    // Slowly rotate the palette hue with difficulty for a sense of escalating intensity
    this.hue = 255 + Math.sin(difficulty * 0.4) * 40;
  }

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, time: number) {
    // sky gradient
    const g = ctx.createLinearGradient(0, 0, 0, height);
    g.addColorStop(0, `hsl(${this.hue}, 70%, 6%)`);
    g.addColorStop(0.55, `hsl(${this.hue - 20}, 65%, 10%)`);
    g.addColorStop(1, `hsl(${this.hue + 30}, 80%, 14%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);

    // stars
    for (const s of this.stars) {
      const twinkle = 0.5 + 0.5 * Math.sin(time * 3 + s.twinklePhase);
      ctx.globalAlpha = 0.4 + twinkle * 0.6;
      ctx.fillStyle = "#dff6ff";
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // horizon glow band
    const horizonY = height * 0.62;
    const glow = ctx.createLinearGradient(0, horizonY - 60, 0, horizonY + 40);
    glow.addColorStop(0, "rgba(255,47,214,0)");
    glow.addColorStop(1, "rgba(255,47,214,0.35)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, horizonY - 60, width, 100);

    // scrolling neon grid floor (simple parallel horizontal lines + verticals for a synthwave floor)
    ctx.save();
    ctx.strokeStyle = "rgba(125, 252, 255, 0.35)";
    ctx.lineWidth = 1;
    ctx.shadowColor = "rgba(125, 252, 255, 0.6)";
    ctx.shadowBlur = 6;

    const floorTop = horizonY;
    const floorHeight = height - floorTop;
    const lineCount = 10;
    for (let i = 0; i < lineCount; i++) {
      const t = (i + this.gridOffset / 48) / lineCount;
      const y = floorTop + t * t * floorHeight;
      ctx.globalAlpha = 0.15 + t * 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const vCount = 14;
    for (let i = -2; i <= vCount + 2; i++) {
      const nx = (i / vCount - 0.5) * 2; // -1..1
      const topX = width / 2 + nx * width * 0.06;
      const bottomX = width / 2 + nx * width * 0.9;
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.moveTo(topX, floorTop);
      ctx.lineTo(bottomX, height);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
