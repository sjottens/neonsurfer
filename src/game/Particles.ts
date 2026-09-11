import { randRange } from "./utils";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  gravity: number;
}

export class ParticleSystem {
  private particles: Particle[] = [];
  private rng: () => number;

  constructor(rng: () => number = Math.random) {
    this.rng = rng;
  }

  burst(x: number, y: number, color: string, count: number, opts: Partial<{ speed: number; size: number; gravity: number; life: number }> = {}) {
    const speed = opts.speed ?? 260;
    const size = opts.size ?? 4;
    const gravity = opts.gravity ?? 500;
    const life = opts.life ?? 0.7;
    for (let i = 0; i < count; i++) {
      const angle = randRange(this.rng, 0, Math.PI * 2);
      const spd = randRange(this.rng, speed * 0.3, speed);
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        life,
        maxLife: life,
        size: randRange(this.rng, size * 0.5, size),
        color,
        gravity,
      });
    }
  }

  sparkle(x: number, y: number, color: string) {
    this.burst(x, y, color, 8, { speed: 140, size: 3, gravity: 100, life: 0.5 });
  }

  update(dt: number) {
    for (const p of this.particles) {
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  draw(ctx: CanvasRenderingContext2D) {
    for (const p of this.particles) {
      const t = p.life / p.maxLife;
      ctx.globalAlpha = t;
      ctx.beginPath();
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 10;
      ctx.arc(p.x, p.y, p.size * t, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  clear() {
    this.particles = [];
  }

  get count() {
    return this.particles.length;
  }
}
