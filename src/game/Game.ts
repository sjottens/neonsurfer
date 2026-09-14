import { Player } from "./Player";
import { Background } from "./Background";
import { ParticleSystem } from "./Particles";
import { ObstacleGenerator } from "./ObstacleGenerator";
import { checkCollision, drawObstacle, obstacleColorForLevel, updateObstacle, type Obstacle } from "./Obstacle";
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
  level: number;
  shieldTime: number;
  magnetTime: number;
  multiplierTime: number;
  slowmoTime: number;
}

const MAGNET_RADIUS = 260; // world px - how far a coin gets pulled from
const MAGNET_PULL_SPEED = 900; // px/s toward the player once inside the radius
const BUFF_DURATION = {
  shield: 4,
  magnet: 5,
  multiplier: 6,
  slowmo: 4,
} as const;
const SLOWMO_FACTOR = 0.55; // how much slower the world scrolls while active
const LEVEL_DISTANCE = 1000; // world px of travel per level - drives the HUD readout and the obstacle color theme

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
  private level = 1;
  private time = 0;
  private shakeTime = 0;
  private shakeMag = 0;
  private rafHandle = 0;
  private lastTimestamp = 0;
  private startHoldPending = false;

  // Active power-up timers, seconds remaining (0 = inactive).
  private shieldTime = 0;
  private magnetTime = 0;
  private multiplierTime = 0;
  private slowmoTime = 0;
  private bonusPoints = 0; // extra score from coins/stars collected while multiplier is active

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
      if (this.state !== "playing") return;
      if (this.startHoldPending) this.startHoldPending = false;
      audio.swoosh();
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
    this.level = 1;
    this.shieldTime = 0;
    this.magnetTime = 0;
    this.multiplierTime = 0;
    this.slowmoTime = 0;
    this.bonusPoints = 0;
    this.rng = createRng((Date.now() ^ (Math.random() * 1e9)) >>> 0);
    this.generator = new ObstacleGenerator(VIRTUAL_HEIGHT, this.rng);
    this.input.reset();
    this.startHoldPending = true; // ignore stale "holding" state from the menu click until a fresh press
    this.setState("playing");
  }

  pause() {
    if (this.state !== "playing") return;
    this.setState("paused");
  }

  resume() {
    if (this.state !== "paused") return;
    this.input.reset();
    this.setState("playing");
  }

  goToMenu() {
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

  /** Driven by the on-screen mobile steering buttons (left = up, right = down). */
  setSteerButton(direction: "up" | "down", active: boolean) {
    if (direction === "up") this.input.setButtonUp(active);
    else this.input.setButtonDown(active);
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
      this.onHud?.({
        score: this.currentScore(),
        coins: save.get().totalCoins + this.coinsThisRun,
        best: save.get().bestScore,
        level: this.level,
        shieldTime: this.shieldTime,
        magnetTime: this.magnetTime,
        multiplierTime: this.multiplierTime,
        slowmoTime: this.slowmoTime,
      });
    }
  }

  private update(dt: number) {
    const thrustUp = this.input.holdingUp && !this.startHoldPending;
    const thrustDown = this.input.holdingDown && !this.startHoldPending;

    this.shieldTime = Math.max(0, this.shieldTime - dt);
    this.magnetTime = Math.max(0, this.magnetTime - dt);
    this.multiplierTime = Math.max(0, this.multiplierTime - dt);
    this.slowmoTime = Math.max(0, this.slowmoTime - dt);

    // Slow-mo eases the world (scroll + obstacles), never the player's own
    // steering speed - it's a breather, not a bullet-time cheat.
    const worldSpeed = this.slowmoTime > 0 ? this.scrollSpeed * SLOWMO_FACTOR : this.scrollSpeed;

    this.distance += worldSpeed * dt;
    this.scrollSpeed = this.generator.scrollSpeedAt(this.distance);
    this.background.update(dt, worldSpeed, this.distance / 7000);

    this.player.update(dt, thrustUp, thrustDown, VIRTUAL_HEIGHT, worldSpeed);
    this.player.shieldActive = this.shieldTime > 0;
    this.player.magnetActive = this.magnetTime > 0;

    const spawned = this.generator.step(dt, this.distance, worldSpeed, this.worldWidth + 80);
    if (spawned) this.obstacles.push(spawned);

    for (const o of this.obstacles) {
      updateObstacle(o, dt, worldSpeed);

      if (!o.passed && o.x + o.width / 2 < this.player.x) {
        o.passed = true;
      }

      if (this.magnetTime > 0) this.applyMagnetPull(o, dt);
      this.tryCollectPickup(o);

      if (checkCollision(o, this.player)) {
        if (this.shieldTime > 0) {
          if (!o.shieldHit) {
            o.shieldHit = true;
            this.particles.sparkle(this.player.x, this.player.y, "#4da6ff");
          }
        } else {
          this.handleCrash();
          break;
        }
      }
    }

    // Drop obstacles once they've fully scrolled past the left edge of the viewport
    this.obstacles = this.obstacles.filter((o) => o.x + o.width / 2 > -50);

    this.level = Math.floor(this.distance / LEVEL_DISTANCE) + 1;
  }

  private handleCrash() {
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
    return Math.floor(this.distance / 10) + this.coinsThisRun * 5 + this.starsThisRun * 25 + this.bonusPoints;
  }

  /** Reel an uncollected coin toward the player once a magnet is active. */
  private applyMagnetPull(o: Obstacle, dt: number) {
    if (o.pickup !== "coin" || o.pickupCollected) return;
    const px = o.x + o.pickupOffsetX;
    const py = o.pickupY + o.pickupOffsetY;
    const dx = this.player.x - px;
    const dy = this.player.y - py;
    const dist = Math.hypot(dx, dy);
    if (dist <= 1 || dist >= MAGNET_RADIUS) return;
    const step = Math.min(dist, MAGNET_PULL_SPEED * dt);
    o.pickupOffsetX += (dx / dist) * step;
    o.pickupOffsetY += (dy / dist) * step;
  }

  private tryCollectPickup(o: Obstacle) {
    if (!o.pickup || o.pickupCollected) return;
    const px = o.x + o.pickupOffsetX;
    const py = o.pickupY + o.pickupOffsetY;
    const dist = Math.hypot(this.player.x - px, this.player.y - py);
    const pickupRadius = o.pickup === "star" || o.pickup === "shield" ? 17 : 13;
    if (dist >= this.player.radius + pickupRadius) return;
    o.pickupCollected = true;
    this.collectPickup(o.pickup, px, py);
  }

  private collectPickup(kind: NonNullable<Obstacle["pickup"]>, x: number, y: number) {
    switch (kind) {
      case "coin":
        this.coinsThisRun += 1;
        if (this.multiplierTime > 0) this.bonusPoints += 5;
        audio.coin();
        this.particles.sparkle(x, y, "#ffe873");
        break;
      case "star":
        this.starsThisRun += 1;
        if (this.multiplierTime > 0) this.bonusPoints += 25;
        audio.star();
        this.particles.burst(x, y, "#7dfcff", 16, { speed: 220, size: 5, life: 0.6 });
        break;
      case "shield":
        this.shieldTime += BUFF_DURATION.shield;
        audio.star();
        this.particles.burst(x, y, "#4da6ff", 18, { speed: 240, size: 5, life: 0.7 });
        break;
      case "magnet":
        this.magnetTime += BUFF_DURATION.magnet;
        audio.purchase();
        this.particles.burst(x, y, "#7dfcff", 14, { speed: 200, size: 4, life: 0.6 });
        break;
      case "multiplier":
        this.multiplierTime += BUFF_DURATION.multiplier;
        audio.milestone();
        this.particles.burst(x, y, "#ffe873", 16, { speed: 220, size: 5, life: 0.6 });
        break;
      case "slowmo":
        this.slowmoTime += BUFF_DURATION.slowmo;
        audio.slowmo();
        this.particles.burst(x, y, "#b26bff", 16, { speed: 180, size: 5, life: 0.7 });
        break;
    }
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

    const obstacleColor = obstacleColorForLevel(this.level);
    for (const o of this.obstacles) {
      drawObstacle(ctx, o, VIRTUAL_HEIGHT, this.time, obstacleColor);
    }

    this.particles.draw(ctx);

    if (this.state === "playing" || this.state === "paused" || this.state === "gameover") {
      this.player.draw(ctx, getSkin(save.get().equippedSkin), this.time);
    }

    ctx.restore();
  }
}
