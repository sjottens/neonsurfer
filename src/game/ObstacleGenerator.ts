import type { Obstacle, ObstacleKind, PickupKind } from "./Obstacle";
import { clamp, randRange } from "./utils";

/**
 * Procedural, difficulty-scaled, but always-fair obstacle spawning.
 * "Fair" here means: the gap is always big enough for the player's physics
 * envelope, and consecutive gap centers never jump further than the player
 * could plausibly reach in the time available - no blind-luck walls.
 */
export class ObstacleGenerator {
  private nextId = 1;
  private distanceSinceSpawn = 0;
  private lastGapCenter: number;
  private worldHeight: number;
  private rng: () => number;

  constructor(worldHeight: number, rng: () => number) {
    this.worldHeight = worldHeight;
    this.rng = rng;
    this.lastGapCenter = worldHeight / 2;
  }

  /** 0 at the start of a run, approaching 1 as the run gets long. */
  private difficultyAt(distance: number): number {
    return clamp(distance / 7000, 0, 1);
  }

  scrollSpeedAt(distance: number): number {
    const t = this.difficultyAt(distance);
    return 300 + t * 320; // 300 -> 620 px/s
  }

  private gapSizeAt(t: number): number {
    return 250 - t * 95; // 250 -> 155
  }

  private spacingAt(t: number): number {
    return 460 - t * 150; // 460 -> 310 (world px between obstacle centers)
  }

  /** Advance the spawn clock; returns a new Obstacle when one should appear, else null. */
  step(dt: number, distance: number, scrollSpeed: number, spawnX: number): Obstacle | null {
    this.distanceSinceSpawn += scrollSpeed * dt;
    const t = this.difficultyAt(distance);
    const spacing = this.spacingAt(t);
    if (this.distanceSinceSpawn < spacing) return null;
    this.distanceSinceSpawn = 0;

    return this.spawn(t, spawnX);
  }

  private pickKind(t: number): ObstacleKind {
    const r = this.rng();
    if (t < 0.15) return "gateWalls";
    if (t < 0.4) return r < 0.6 ? "gateWalls" : "spikes";
    if (t < 0.7) {
      if (r < 0.4) return "gateWalls";
      if (r < 0.75) return "spikes";
      return "movingGate";
    }
    if (r < 0.3) return "spikes";
    if (r < 0.6) return "movingGate";
    if (r < 0.85) return "rotor";
    return "gateWalls";
  }

  private spawn(t: number, spawnX: number): Obstacle {
    const kind = this.pickKind(t);
    const gapSize = this.gapSizeAt(t);
    const margin = gapSize / 2 + 40;
    const maxJump = this.worldHeight * (0.3 + 0.15 * (1 - t)); // slightly gentler jumps late-game since gaps are smaller

    let gapCenter = this.lastGapCenter + randRange(this.rng, -maxJump, maxJump);
    gapCenter = clamp(gapCenter, margin, this.worldHeight - margin);
    this.lastGapCenter = gapCenter;

    const pickupRoll = this.rng();
    let pickup: PickupKind = null;
    if (pickupRoll < 0.12) pickup = "star";
    else if (pickupRoll < 0.75) pickup = "coin";

    const obstacle: Obstacle = {
      id: this.nextId++,
      kind,
      x: spawnX,
      width: kind === "spikes" ? 110 : 74,
      worldHeight: this.worldHeight,
      age: 0,
      passed: false,
      pickup,
      pickupCollected: false,
      pickupY: gapCenter + randRange(this.rng, -gapSize * 0.15, gapSize * 0.15),
      gapCenter,
      gapSize,
      gapAmplitude: 0,
      gapSpeed: 0,
      rotorLength: 0,
      rotorSpeed: 0,
      rotorBaseAngle: 0,
    };

    if (kind === "movingGate") {
      obstacle.gapAmplitude = Math.min(this.worldHeight * 0.18, gapSize * 0.7);
      obstacle.gapSpeed = randRange(this.rng, 1.2, 2.2);
      obstacle.width = 60;
    }

    if (kind === "rotor") {
      obstacle.rotorLength = randRange(this.rng, 90, 130);
      obstacle.rotorSpeed = (this.rng() < 0.5 ? -1 : 1) * randRange(this.rng, 1.4, 2.4 + t * 1.2);
      obstacle.rotorBaseAngle = randRange(this.rng, 0, Math.PI * 2);
      obstacle.width = obstacle.rotorLength * 2.2;
      obstacle.pickup = pickupRoll < 0.5 ? "coin" : null; // keep rotor rows a little less pickup-cluttered
      obstacle.pickupY = obstacle.gapCenter - obstacle.rotorLength * 1.6;
    }

    return obstacle;
  }
}
