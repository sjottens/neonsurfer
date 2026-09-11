import { Player } from "./Player";
import { Background } from "./Background";
import { ParticleSystem } from "./Particles";
import { ObstacleGenerator } from "./ObstacleGenerator";
import { checkCollision, drawObstacle, updateObstacle, type Obstacle } from "./Obstacle";
import { InputManager } from "./Input";
import { audio } from "./Audio";
import { save } from "./Storage";
import { getSkin } from "./Skins";
import { clamp, createRng } from "./utils";

export const VIRTUAL_HEIGHT = 720;

export type GameState = "menu" | "playing" | "paused" | "gameover";

export interface RunResult {
  score: number;
  distance: number;
  coins: number;
  stars: number;
  isNewBest: boolean;
}

export interface HudState {
  score: number;
  coins: number;
  best: number;
}

const MAX_DT = 1 / 30; // clamp huge frame gaps (tab backgrounded) so physics never "teleports"

export class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private input = new InputManager();

  private player = new Player();
  private background: Background;
  private particles = new ParticleSystem();
  private generator: ObstacleGenerator;
  private obstacles: Obstacle[] = [];
  private rng: () => number;

  private worldWidth = 1280;
  private scale = 1;

  private state: GameState = "menu";
  private distance = 0;
  private coinsThisRun = 0;
  private starsThisRun = 0;
  private scrollSpeed = 300;
  private time = 0;
  private shakeTime = 0;
  private shakeMag = 0;
  private lastMilestone = 0;
  private rafHandle = 0;
  private lastTimestamp = 0;
  private startHoldPending = false;

  onStateChange: ((state: GameState, payload?: RunResult) => void) | null = null;
  onHud: ((hud: HudState) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    this.ctx = ctx;

    this.rng = createRng(Date.now() ^ 0x9e3779b9);
    this.background = new Background(1280, VIRTUAL_HEIGHT, this.rng);
    this.generator = new ObstacleGenerator(VIRTUAL_HEIGHT, this.rng);

    this.input.attach(canvas);
    this.input.onPress = () => {
      audio.startThrust();
      if (this.state === "playing" && this.startHoldPending) this.startHoldPending = false;
    };

    this.resize();
    window.addEventListener("resize", () => this.resize());

    this.loop = this.loop.bind(this);
    this.rafHandle = requestAnimationFrame(this.loop);
  }

  private resize() {
    // Size to the canvas's own container (#app), not the browser window - the
    // game stage is intentionally smaller than the viewport so there's room
    // for ad slots beside it (see #page in styles.css).
    const container = this.canvas.parentElement;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssWidth = container?.clientWidth || window.innerWidth;
    const cssHeight = container?.clientHeight || window.innerHeight;
    this.canvas.width = Math.floor(cssWidth * dpr);
    this.canvas.height = Math.floor(cssHeight * dpr);
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;

    this.scale = (cssHeight * dpr) / VIRTUAL_HEIGHT;
    this.worldWidth = (cssWidth * dpr) / this.scale;
  }

  // ---------------------------------------------------------------- state

  startRun() {
    this.player.reset(VIRTUAL_HEIGHT / 2);
    this.obstacles = [];
    this.particles.clear();
    this.distance = 0;
    this.coinsThisRun = 0;
    this.starsThisRun = 0;
    this.scrollSpeed = 300;
    this.lastMilestone = 0;
    this.rng = createRng((Date.now() ^ (Math.random() * 1e9)) >>> 0);
    this.generator = new ObstacleGenerator(VIRTUAL_HEIGHT, this.rng);
    this.input.reset();
    this.startHoldPending = true; // ignore stale "holding" state from the menu click until a fresh press
    this.setState("playing");
  }

  pause() {
    if (this.state !== "playing") return;
    audio.stopThrust();
    this.setState("paused");
  }

  resume() {
    if (this.state !== "paused") return;
    this.input.reset();
    this.setState("playing");
  }

  goToMenu() {
    audio.stopThrust();
    this.setState("menu");
  }

  private setState(state: GameState, payload?: RunResult) {
    this.state = state;
    this.onStateChange?.(state, payload);
  }

  get currentState() {
    return this.state;
  }

  setMuted(muted: boolean) {
    audio.setMuted(muted);
    save.setMuted(muted);
  }

  destroy() {
    cancelAnimationFrame(this.rafHandle);
    this.input.detach(this.canvas);
  }

  // ---------------------------------------------------------------- loop

  private loop(timestamp: number) {
    this.rafHandle = requestAnimationFrame(this.loop);
    if (!this.lastTimestamp) this.lastTimestamp = timestamp;
    const dt = clamp((timestamp - this.lastTimestamp) / 1000, 0, MAX_DT);
    this.lastTimestamp = timestamp;
    this.time += dt;

    if (this.state === "playing") this.update(dt);
    this.particles.update(dt);
    if (this.shakeTime > 0) this.shakeTime = Math.max(0, this.shakeTime - dt);

    this.render();

    if (this.state === "playing") {
      this.onHud?.({ score: this.currentScore(), coins: save.get().totalCoins + this.coinsThisRun, best: save.get().bestScore });
    }
  }

  private update(dt: number) {
    const thrustUp = this.input.holdingUp && !this.startHoldPending;
    const thrustDown = this.input.holdingDown && !this.startHoldPending;

    this.distance += this.scrollSpeed * dt;
    this.scrollSpeed = this.generator.scrollSpeedAt(this.distance);
    this.background.update(dt, this.scrollSpeed, this.distance / 7000);

    this.player.update(dt, thrustUp, thrustDown, VIRTUAL_HEIGHT);

    const spawned = this.generator.step(dt, this.distance, this.scrollSpeed, this.worldWidth + 80);
    if (spawned) this.obstacles.push(spawned);

    for (const o of this.obstacles) {
      updateObstacle(o, dt, this.scrollSpeed);

      if (!o.passed && o.x + o.width / 2 < this.player.x) {
        o.passed = true;
      }

      if (o.pickup && !o.pickupCollected) {
        const dist = Math.hypot(this.player.x - o.x, this.player.y - o.pickupY);
        const pickupRadius = o.pickup === "star" ? 17 : 13;
        if (dist < this.player.radius + pickupRadius) {
          o.pickupCollected = true;
          if (o.pickup === "coin") {
            this.coinsThisRun += 1;
            audio.coin();
            this.particles.sparkle(o.x, o.pickupY, "#ffe873");
          } else {
            this.starsThisRun += 1;
            audio.star();
            this.particles.burst(o.x, o.pickupY, "#7dfcff", 16, { speed: 220, size: 5, life: 0.6 });
          }
        }
      }

      if (checkCollision(o, this.player)) {
        this.handleCrash();
        break;
      }
    }

    // Drop obstacles once they've fully scrolled past the left edge of the viewport
    this.obstacles = this.obstacles.filter((o) => o.x + o.width / 2 > -50);

    const milestoneStep = 500;
    if (this.distance - this.lastMilestone > milestoneStep) {
      this.lastMilestone = Math.floor(this.distance / milestoneStep) * milestoneStep;
      audio.milestone();
    }
  }

  private handleCrash() {
    audio.stopThrust();
    audio.crash();
    this.particles.burst(this.player.x, this.player.y, getSkin(save.get().equippedSkin).core, 34, {
      speed: 340,
      size: 6,
      life: 0.9,
    });
    this.shakeTime = 0.35;
    this.shakeMag = 14;

    const score = this.currentScore();
    const { isNewBest } = save.recordRun(score, this.distance, this.coinsThisRun);

    this.setState("gameover", {
      score,
      distance: Math.floor(this.distance),
      coins: this.coinsThisRun,
      stars: this.starsThisRun,
      isNewBest,
    });
  }

  private currentScore(): number {
    return Math.floor(this.distance / 10) + this.coinsThisRun * 5 + this.starsThisRun * 25;
  }

  // ---------------------------------------------------------------- render

  private render() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);

    let shakeX = 0;
    let shakeY = 0;
    if (this.shakeTime > 0) {
      const power = this.shakeMag * (this.shakeTime / 0.35);
      shakeX = (this.rng() - 0.5) * power;
      shakeY = (this.rng() - 0.5) * power;
    }

    ctx.setTransform(this.scale, 0, 0, this.scale, shakeX, shakeY);

    this.background.draw(ctx, this.worldWidth, VIRTUAL_HEIGHT, this.time);

    for (const o of this.obstacles) {
      drawObstacle(ctx, o, VIRTUAL_HEIGHT, this.time);
    }

    this.particles.draw(ctx);

    if (this.state === "playing" || this.state === "paused" || this.state === "gameover") {
      this.player.draw(ctx, getSkin(save.get().equippedSkin), this.time);
    }

    ctx.restore();
  }
}
