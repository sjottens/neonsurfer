import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { Player, PHYSICS } from "./Player";
import { World } from "./World";
import { ParticleSystem } from "./Particles";
import { ObstacleGenerator } from "./ObstacleGenerator";
import {
  createObstacle,
  obstacleAssets,
  rampGroundAt,
  updateObstacle,
  type Obstacle,
} from "./Obstacle";
import { createPickup, updatePickup, type Pickup, type PickupKind } from "./Pickups";
import { InputManager } from "./Input";
import { audio } from "./Audio";
import { save } from "./Storage";
import { getSkin } from "./Skins";
import { themeForLevel } from "./Levels";
import { clamp, createRng } from "./utils";

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
  levelName: string;
  levelColor: string;
  shieldTime: number;
  magnetTime: number;
  multiplierTime: number;
  slowmoTime: number;
}

const MAGNET_RADIUS = 11; // world units - how far a coin gets pulled from
const MAGNET_PULL_SPEED = 42;
const BUFF_DURATION = { shield: 4, magnet: 5, multiplier: 6, slowmo: 4 } as const;
const SLOWMO_FACTOR = 0.55; // how much slower the world scrolls while active
const LEVEL_SCORE = 1000; // score per level - drives the HUD readout and the world's color theme
const SCORE_PER_UNIT = 1.2; // distance -> score
const STYLE_WINDOW = 5; // seconds a near-miss / clean-jump streak stays alive
const CRASH_HITSTOP = 0.12; // freeze-frame on impact
const CRASH_TO_GAMEOVER = 1.5; // real seconds from impact to the game-over screen

const MAX_DT = 1 / 30; // clamp huge frame gaps (tab backgrounded) so physics never "teleports"

const CAM = { fov: 60, height: 3.9, back: 9.0, lookY: 1.4, lookAhead: -14 };

export class Game {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private camera = new THREE.PerspectiveCamera(CAM.fov, 16 / 9, 0.1, 700);
  private world: World;
  private player = new Player();
  private particles = new ParticleSystem();
  private entities = new THREE.Group();
  private generator: ObstacleGenerator;
  private obstacles: Obstacle[] = [];
  private pickups: Pickup[] = [];
  private input = new InputManager();
  private rng: () => number;

  private state: GameState = "menu";
  private distance = 0;
  private scroll = 0; // total world scroll - the water pattern's phase
  private coinsThisRun = 0;
  private starsThisRun = 0;
  private bonusPoints = 0;
  private speedFactor = 0; // 0..1 how far along the speed ramp we are
  private level = 1;
  private time = 0;
  private rafHandle = 0;
  private lastTimestamp = 0;

  private crashed = false;
  private crashTimer = 0;
  private crashSpeed = 0;
  private pendingResult: RunResult | null = null;

  private shieldTime = 0;
  private magnetTime = 0;
  private multiplierTime = 0;
  private slowmoTime = 0;

  private streak = 0;
  private lastStyleTime = -99;

  // camera
  private camX = 0;
  private camPos = new THREE.Vector3(0, 3, 8);
  private camLook = new THREE.Vector3(0, 1, -10);
  private camBump = 0;
  private shakeTime = 0;
  private shakeMag = 0;
  private fov = CAM.fov;

  // emitters / ambient
  private wakeTimer = 0;
  private menuJumpTimer = 3;
  private tmp = new THREE.Vector3();

  // adaptive quality
  private useBloom = true;
  private maxDpr = 1.75;
  private frameEma = 1 / 60;
  private slowTime = 0;
  private warmup = 1.5;

  onStateChange: ((state: GameState, payload?: RunResult) => void) | null = null;
  onHud: ((hud: HudState) => void) | null = null;
  /** A floating callout ("NEAR MISS +10"), shown by the UI. */
  onPopup: ((text: string, color: string) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setClearColor(0x05010f);

    this.rng = createRng(Date.now() ^ 0x9e3779b9);
    this.world = new World(this.rng);
    this.generator = new ObstacleGenerator(this.rng);
    const scene = this.world.scene;
    scene.add(this.player.root, this.entities, this.particles.points);

    this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.55, 0.8);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.player.events = {
      onJump: (fromRamp) => {
        if (this.state !== "menu") audio.jump(fromRamp);
        this.particles.splash(this.player.x, this.player.waterLevel + 0.2, 1.2, fromRamp ? 1.1 : 0.6);
      },
      onLand: (impact) => {
        if (this.state !== "menu") audio.land(impact);
        this.camBump = clamp(impact * 0.012, 0, 0.35);
        this.particles.splash(this.player.x, this.player.waterLevel + 0.2, 0.2, clamp(impact / 16, 0.5, 1.6));
      },
      onTrick: (kind, seconds) => {
        if (this.state !== "playing" || this.crashed) return;
        const base = kind === "grab" ? 20 : 30;
        this.awardStyle(kind === "grab" ? "RAIL GRAB" : "METHOD", base + Math.min(60, Math.floor(seconds * 40)), "#ff9bf0");
      },
      onSplash: (x, y, z, amount) => this.particles.splash(x, y + 0.2, z, amount),
    };

    this.player.setSkin(getSkin(save.get().equippedSkin));
    this.world.setTheme(themeForLevel(1), true);

    this.input.attach();
    this.input.onSteerStart = () => {
      if (this.state === "playing" && !this.crashed) audio.swoosh();
    };
    this.input.onJump = () => this.jump();

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
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    const w = container?.clientWidth || window.innerWidth;
    const h = container?.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- state

  startRun() {
    this.clearEntities();
    this.player.reset();
    this.player.setSkin(getSkin(save.get().equippedSkin));
    this.particles.clear();
    this.distance = 0;
    this.coinsThisRun = 0;
    this.starsThisRun = 0;
    this.bonusPoints = 0;
    this.level = 1;
    this.crashed = false;
    this.crashTimer = 0;
    this.pendingResult = null;
    this.shieldTime = 0;
    this.magnetTime = 0;
    this.multiplierTime = 0;
    this.slowmoTime = 0;
    this.streak = 0;
    this.lastStyleTime = -99;
    this.shakeTime = 0;
    this.rng = createRng((Date.now() ^ (Math.random() * 1e9)) >>> 0);
    this.generator = new ObstacleGenerator(this.rng);
    this.world.setTheme(themeForLevel(1));
    this.input.reset();
    audio.startMusic();
    audio.setMusicMood("play");
    this.setState("playing");
  }

  pause() {
    if (this.state !== "playing" || this.crashed) return;
    audio.setMusicMood("pause");
    this.setState("paused");
  }

  resume() {
    if (this.state !== "paused") return;
    this.input.reset();
    audio.setMusicMood("play");
    this.setState("playing");
  }

  goToMenu() {
    this.clearEntities();
    this.player.reset();
    this.crashed = false;
    this.particles.clear();
    this.world.setTheme(themeForLevel(1));
    audio.setMusicMood("menu");
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

  /** Driven by the on-screen mobile steering buttons. */
  setSteerButton(direction: "left" | "right", active: boolean) {
    if (direction === "left") this.input.setButtonLeft(active);
    else this.input.setButtonRight(active);
  }

  /** Jump button on touch devices (and the shared handler for the space bar). */
  jump() {
    if (this.state !== "playing" || this.crashed) return;
    this.player.requestJump();
  }

  pressJumpButton() {
    this.input.pressJump();
  }

  destroy() {
    cancelAnimationFrame(this.rafHandle);
    this.input.detach();
    this.renderer.dispose();
  }

  private clearEntities() {
    for (const o of this.obstacles) this.entities.remove(o.group);
    for (const p of this.pickups) this.entities.remove(p.group);
    this.obstacles = [];
    this.pickups = [];
  }

  // ---------------------------------------------------------------- loop

  private loop(timestamp: number) {
    this.rafHandle = requestAnimationFrame(this.loop);
    if (!this.lastTimestamp) this.lastTimestamp = timestamp;
    const rawDt = clamp((timestamp - this.lastTimestamp) / 1000, 0, MAX_DT);
    this.lastTimestamp = timestamp;
    if (this.state !== "paused") this.time += rawDt;
    this.watchPerformance(rawDt);

    if (this.state === "menu") this.updateMenu(rawDt);
    else if (this.state === "playing" && !this.crashed) this.update(rawDt);
    else if (this.crashed && this.state !== "paused") this.updateCrash(rawDt);

    audio.update(rawDt);
    this.updateCamera(rawDt);
    this.render();

    if (this.state === "playing") {
      const theme = themeForLevel(this.level);
      this.onHud?.({
        score: this.currentScore(),
        coins: save.get().totalCoins + this.coinsThisRun,
        best: save.get().bestScore,
        level: this.level,
        levelName: theme.name,
        levelColor: theme.accent,
        shieldTime: this.shieldTime,
        magnetTime: this.magnetTime,
        multiplierTime: this.multiplierTime,
        slowmoTime: this.slowmoTime,
      });
    }
  }

  /** If the device can't hold ~40fps, shed the expensive extras: bloom first, then resolution. */
  private watchPerformance(dt: number) {
    if (this.warmup > 0) {
      this.warmup -= dt;
      return;
    }
    if (this.state === "paused") return;
    this.frameEma += (dt - this.frameEma) * 0.05;
    if (this.frameEma > 0.026) this.slowTime += dt;
    else this.slowTime = Math.max(0, this.slowTime - dt);
    if (this.slowTime > 2.5) {
      this.slowTime = 0;
      this.frameEma = 1 / 60;
      if (this.useBloom) this.useBloom = false;
      else if (this.maxDpr > 1) {
        this.maxDpr = 1;
        this.resize();
      }
    }
  }

  private currentScore(): number {
    return Math.floor(this.distance * SCORE_PER_UNIT) + this.coinsThisRun * 5 + this.starsThisRun * 25 + this.bonusPoints;
  }

  // ---------------------------------------------------------------- simulation

  /** Attract mode behind the menu: the surfer cruises and hops on an empty sea. */
  private updateMenu(dt: number) {
    const speed = 13;
    this.scroll += speed * dt;
    this.speedFactor = 0.1;
    const targetX = Math.sin(this.time * 0.55) * 3;
    this.menuJumpTimer -= dt;
    if (this.menuJumpTimer <= 0) {
      this.menuJumpTimer = 3.5 + Math.random() * 2.5;
      this.player.requestJump();
    }
    this.player.update(dt, clamp((targetX - this.player.x) * 0.7, -1, 1), 0, this.scroll, this.time, speed, 0.1);
    this.emitWake(dt);
    this.world.update(dt, this.scroll, speed, this.time, this.camera, this.speedFactor);
    obstacleAssets.accent.copy(this.world.palette.accent);
    this.particles.update(dt, speed);
  }

  private update(dt: number) {
    this.shieldTime = Math.max(0, this.shieldTime - dt);
    this.magnetTime = Math.max(0, this.magnetTime - dt);
    this.multiplierTime = Math.max(0, this.multiplierTime - dt);
    this.slowmoTime = Math.max(0, this.slowmoTime - dt);

    // Slow-mo eases the world, never the surfer's own steering - a breather, not a bullet-time cheat.
    const speed = this.generator.speedAt(this.distance);
    const worldSpeed = this.slowmoTime > 0 ? speed * SLOWMO_FACTOR : speed;
    this.speedFactor = clamp((speed - 24) / 26, 0, 1);
    this.distance += worldSpeed * dt;
    this.scroll += worldSpeed * dt;
    this.spawnRows();

    // ---- move the world past the surfer
    let ground = 0;
    for (const o of this.obstacles) {
      o.z += worldSpeed * dt;
      updateObstacle(o, dt, this.time);
      // Launch off a ramp's lip. Checked here, before the surfer moves, because the slope
      // (the "ground") vanishes the very frame the lip is passed - checking afterwards would
      // sometimes see an already-falling surfer and miss the launch.
      if (
        o.kind === "ramp" &&
        !o.launched &&
        o.z >= o.halfD - 0.3 &&
        o.z - worldSpeed * dt > -o.halfD &&
        Math.abs(this.player.x - o.x) <= o.halfW &&
        this.player.grounded
      ) {
        o.launched = true;
        this.player.launch();
        this.particles.burst(this.player.x, this.player.waterLevel + 1, 0.5, "#ffffff", 14, 6, 0.5, 0.6);
      }
      ground = Math.max(ground, rampGroundAt(o, this.player.x));
    }
    for (const p of this.pickups) {
      p.z += worldSpeed * dt;
      if (this.magnetTime > 0 && p.kind === "coin" && !p.collected) this.pullTowardPlayer(p, dt);
      updatePickup(p, this.time);
    }

    // ---- the surfer
    const steer = this.input.steer;
    this.player.update(dt, steer, ground, this.scroll, this.time, worldSpeed, this.speedFactor);
    this.player.setBuffs(this.shieldTime > 0, this.magnetTime > 0);
    const px = this.player.x;

    // ---- obstacles: launch, collide, and score the style moves
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const o = this.obstacles[i];

      if (o.kind === "ramp") continue; // not a hazard - launching is handled above

      const dx = Math.abs(px - o.x);
      const dz = Math.abs(o.z);
      const overlapZ = dz < o.halfD + PHYSICS.halfD;
      const overlapX = dx < o.halfW + PHYSICS.halfW;

      if (overlapZ && overlapX && this.player.height < o.height - 0.08) {
        if (this.shieldTime > 0) {
          this.breakObstacle(o, i);
          continue;
        }
        this.handleCrash(worldSpeed);
        return;
      }

      if (dz < o.halfD + 1.0) {
        if (o.kind === "log") {
          if (this.player.height > o.height && dx < o.halfW + 0.3) o.jumped = true;
        } else {
          o.minClear = Math.min(o.minClear, dx - o.halfW - PHYSICS.halfW);
        }
      }
      if (!o.done && o.z > o.halfD + 1.2) {
        o.done = true;
        if (o.kind === "log") {
          if (o.jumped) this.awardStyle("CLEAN JUMP", 15, "#ffe873");
        } else if (o.minClear > 0 && o.minClear < 0.6) {
          this.awardStyle("NEAR MISS", 10, "#7dfcff");
        }
      }
    }

    // ---- pickups
    const cy = this.player.height + 0.9;
    for (const p of this.pickups) {
      if (p.collected) continue;
      const dist = Math.hypot(px - p.x, cy - p.y, p.z);
      if (dist < p.radius) {
        p.collected = true;
        this.entities.remove(p.group);
        this.collectPickup(p.kind, p.x, p.y + this.player.waterLevel, p.z);
      }
    }

    // ---- cull what's slipped behind the camera
    this.obstacles = this.obstacles.filter((o) => {
      if (o.z > 14) {
        this.entities.remove(o.group);
        return false;
      }
      return true;
    });
    this.pickups = this.pickups.filter((p) => {
      if (p.collected || p.z > 14) {
        this.entities.remove(p.group);
        return false;
      }
      return true;
    });

    // ---- level / world color
    this.level = Math.floor(this.currentScore() / LEVEL_SCORE) + 1;
    this.world.setTheme(themeForLevel(this.level));

    this.emitWake(dt);
    this.world.update(dt, this.scroll, worldSpeed, this.time, this.camera, this.speedFactor);
    obstacleAssets.accent.copy(this.world.palette.accent);
    obstacleAssets.sync();
    this.particles.update(dt, worldSpeed);
  }

  private spawnRows() {
    for (const row of this.generator.fill(this.distance)) {
      for (const spec of row.obstacles) {
        const o = createObstacle(spec, this.distance - spec.d, this.scroll, this.rng);
        this.obstacles.push(o);
        this.entities.add(o.group);
      }
      for (const spec of row.pickups) {
        const p = createPickup(spec, this.distance - spec.d, this.scroll);
        this.pickups.push(p);
        this.entities.add(p.group);
      }
    }
  }

  private pullTowardPlayer(p: Pickup, dt: number) {
    const dx = this.player.x - p.x;
    const dy = this.player.height + 0.9 - p.y;
    const dz = -p.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist <= 0.5 || dist >= MAGNET_RADIUS) return;
    const step = Math.min(dist, MAGNET_PULL_SPEED * dt);
    p.x += (dx / dist) * step;
    p.y += (dy / dist) * step;
    p.z += (dz / dist) * step;
  }

  private breakObstacle(o: Obstacle, index: number) {
    audio.shatter();
    this.particles.burst(o.x, this.player.waterLevel + 1.2, o.z, obstacleAssets.accent, 26, 9, 0.55, 0.7);
    this.shakeTime = 0.18;
    this.shakeMag = 0.18;
    this.entities.remove(o.group);
    this.obstacles.splice(index, 1);
  }

  private awardStyle(label: string, base: number, color: string) {
    this.streak = this.time - this.lastStyleTime < STYLE_WINDOW ? this.streak + 1 : 1;
    this.lastStyleTime = this.time;
    const pts = base + Math.min(this.streak - 1, 6) * 5;
    this.bonusPoints += pts * (this.multiplierTime > 0 ? 2 : 1);
    audio.bonus();
    this.onPopup?.(`${label} +${pts}${this.streak > 1 ? `  ×${this.streak}` : ""}`, color);
  }

  private collectPickup(kind: PickupKind, x: number, y: number, z: number) {
    switch (kind) {
      case "coin":
        this.coinsThisRun += 1;
        if (this.multiplierTime > 0) this.bonusPoints += 5;
        audio.coin();
        this.particles.sparkle(x, y, z, "#ffe873", 8);
        break;
      case "star":
        this.starsThisRun += 1;
        if (this.multiplierTime > 0) this.bonusPoints += 25;
        audio.star();
        this.particles.burst(x, y, z, "#7dfcff", 22, 8, 0.55, 0.6);
        break;
      case "shield":
        this.shieldTime += BUFF_DURATION.shield;
        audio.star();
        this.particles.burst(x, y, z, "#4da6ff", 24, 8, 0.55, 0.7);
        break;
      case "magnet":
        this.magnetTime += BUFF_DURATION.magnet;
        audio.purchase();
        this.particles.burst(x, y, z, "#7dfcff", 20, 7, 0.5, 0.6);
        break;
      case "multiplier":
        this.multiplierTime += BUFF_DURATION.multiplier;
        audio.milestone();
        this.particles.burst(x, y, z, "#ffe873", 22, 8, 0.55, 0.6);
        break;
      case "slowmo":
        this.slowmoTime += BUFF_DURATION.slowmo;
        audio.slowmo();
        this.particles.burst(x, y, z, "#b26bff", 22, 7, 0.55, 0.7);
        break;
    }
  }

  // ---------------------------------------------------------------- crash

  private handleCrash(worldSpeed: number) {
    this.crashed = true;
    this.crashTimer = 0;
    this.crashSpeed = worldSpeed;
    this.player.crash(worldSpeed);
    this.player.setBuffs(false, false);
    audio.crash();
    audio.setMusicMood("over");

    const skin = getSkin(save.get().equippedSkin);
    const y = this.player.waterLevel + this.player.height + 1;
    this.particles.burst(this.player.x, y, 0, skin.core, 60, 13, 0.75, 1.3);
    this.particles.burst(this.player.x, y, 0, obstacleAssets.accent, 34, 10, 0.6, 1.0);
    this.particles.splash(this.player.x, this.player.waterLevel + 0.2, 0, 1.5);
    this.shakeTime = 0.55;
    this.shakeMag = 0.7;

    const score = this.currentScore();
    const { isNewBest } = save.recordRun(score, this.distance, this.coinsThisRun);
    this.pendingResult = {
      score,
      distance: Math.floor(this.distance),
      coins: this.coinsThisRun,
      stars: this.starsThisRun,
      isNewBest,
    };
  }

  /** The wipe-out: a hit-stop, then the world grinds to a halt in slow motion while the rider tumbles. */
  private updateCrash(realDt: number) {
    this.crashTimer += realDt;
    const dt = realDt * (this.crashTimer < CRASH_HITSTOP ? 0.04 : 0.4);
    this.crashSpeed *= Math.exp(-dt * 2.4);
    this.scroll += this.crashSpeed * dt;
    for (const o of this.obstacles) {
      o.z += this.crashSpeed * dt;
      updateObstacle(o, dt, this.time);
    }
    for (const p of this.pickups) {
      p.z += this.crashSpeed * dt;
      updatePickup(p, this.time);
    }
    this.player.pose(dt, this.scroll, this.time, this.crashSpeed, this.speedFactor, 0);
    this.world.update(dt, this.scroll, this.crashSpeed, this.time, this.camera, this.speedFactor * 0.5);
    obstacleAssets.accent.copy(this.world.palette.accent);
    this.particles.update(dt, this.crashSpeed);

    if (this.state === "playing" && this.crashTimer > CRASH_TO_GAMEOVER && this.pendingResult) {
      const result = this.pendingResult;
      this.pendingResult = null;
      this.setState("gameover", result);
    }
  }

  // ---------------------------------------------------------------- effects

  /** Foam behind the tail, plus spray thrown off the outside rail in hard carves. */
  private emitWake(dt: number) {
    if (this.crashed) return;
    this.wakeTimer -= dt;
    if (this.wakeTimer > 0 || !this.player.grounded) return;
    this.wakeTimer = 0.028;
    const tail = this.player.tailWorld(this.tmp);
    const lean = clamp(this.player.vx / PHYSICS.latSpeed, -1, 1);
    for (const side of [-1, 1]) {
      this.particles.emit({
        x: tail.x + side * 0.32,
        y: tail.y,
        z: tail.z,
        vx: side * (1.1 + Math.random() * 0.8) + this.player.vx * 0.08,
        vy: 0.4 + Math.random() * 0.6,
        vz: 0,
        life: 0.9,
        size: 0.5,
        sizeEnd: 1.5,
        color: "#d8f6ff",
        alpha: 0.5,
        gravity: 1,
        drag: 1.2,
      });
    }
    // rooster tail
    this.particles.emit({
      x: tail.x,
      y: tail.y + 0.1,
      z: tail.z - 0.2,
      vx: (Math.random() - 0.5) * 1.5,
      vy: 2 + Math.random() * 1.5,
      vz: 2 + Math.random() * 2,
      life: 0.5,
      size: 0.35,
      sizeEnd: 0.05,
      color: "#eaffff",
      alpha: 0.7,
      gravity: 12,
      drag: 0.5,
    });
    if (Math.abs(lean) > 0.55) {
      const out = -Math.sign(lean); // spray flies off the side you're carving away from
      for (let i = 0; i < 2; i++) {
        this.particles.emit({
          x: tail.x + out * 0.4,
          y: tail.y + 0.1,
          z: tail.z - 0.6,
          vx: out * (3 + Math.random() * 3),
          vy: 2.5 + Math.random() * 2.5,
          vz: 1 + Math.random() * 2,
          life: 0.6,
          size: 0.3,
          sizeEnd: 0.05,
          color: "#cfefff",
          alpha: 0.8,
          gravity: 14,
          drag: 0.4,
        });
      }
    }
  }

  // ---------------------------------------------------------------- camera + render

  private updateCamera(dt: number) {
    this.camBump = Math.max(0, this.camBump - dt * 1.4);
    this.shakeTime = Math.max(0, this.shakeTime - dt);
    const px = this.player.x;
    const py = this.player.root.position.y;
    const k = 1 - Math.exp(-dt * 6);

    let targetPos: THREE.Vector3;
    let targetLook: THREE.Vector3;
    let targetFov = CAM.fov;
    if (this.state === "menu") {
      // lazy orbit around the cruising surfer while the title is up
      const a = this.time * 0.3;
      targetPos = this.tmp.set(px + Math.sin(a) * 4, 2.2 + Math.sin(this.time * 0.5) * 0.4, 7.8 + Math.cos(a) * 1.2);
      targetLook = new THREE.Vector3(px - 3.6, py + 1.5, -2); // surfer sits right of center, clear of the menu column
      targetFov = 56;
    } else {
      this.camX += (px * 0.78 - this.camX) * (1 - Math.exp(-dt * 7));
      const jumpLift = this.player.height * 0.4;
      targetPos = this.tmp.set(this.camX, CAM.height + py * 0.5 + jumpLift - this.camBump, CAM.back + (this.crashed ? 1.8 : 0));
      targetLook = new THREE.Vector3(px * 0.55, CAM.lookY + py * 0.4 + this.player.height * 0.25, CAM.lookAhead);
      targetFov = CAM.fov + this.speedFactor * 9 + (this.slowmoTime > 0 ? -4 : 0);
      if (this.crashed) targetLook.set(px * 0.6, 1.2, -4);
    }
    this.camPos.lerp(targetPos, k);
    this.camLook.lerp(targetLook, k);
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-dt * 3));

    this.camera.position.copy(this.camPos);
    if (this.shakeTime > 0) {
      const p = this.shakeMag * Math.min(1, this.shakeTime / 0.3);
      this.camera.position.x += (Math.random() - 0.5) * p;
      this.camera.position.y += (Math.random() - 0.5) * p;
    }
    this.camera.lookAt(this.camLook);
    // bank into turns, a touch of roll
    if (this.state !== "menu" && !this.crashed) this.camera.rotateZ(-this.player.vx * 0.0025);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private render() {
    const heightPx = this.renderer.domElement.height;
    this.particles.setScale(heightPx / (2 * Math.tan((this.camera.fov * Math.PI) / 360)));
    if (this.useBloom) this.composer.render();
    else this.renderer.render(this.world.scene, this.camera);
  }

}
