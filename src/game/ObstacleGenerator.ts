import type { Obstacle, ObstacleKind, PickupKind } from "./Obstacle";
import { PHYSICS } from "./Player";
import { clamp, randRange } from "./utils";

/**
 * Procedural, difficulty-scaled, but always-fair obstacle spawning.
 * "Fair" here means: the gap is always big enough for the player's physics
 * envelope, and consecutive gap centers never jump further than the player
 * could plausibly reach in the time available - no blind-luck walls.
 *
 * Two things a flat jump-distance cap alone doesn't catch, both fixed below:
 *  - A `movingGate`/`rotor` doesn't leave the player exactly at its nominal
 *    gap center - they exit wherever they had to be to dodge the moving/
 *    spinning part, which can be well off-center. `lastUncertainty` eats
 *    into the next jump's budget to compensate.
 *  - Two obstacles can still land close together in *time* even when their
 *    centers are a fair distance apart, if the first one is wide. A short
 *    `extraSpacingPending` recovery window follows any dynamic obstacle.
 */
export class ObstacleGenerator {
  private nextId = 1;
  private distanceSinceSpawn = 0;
  private lastGapCenter: number;
  private lastKind: ObstacleKind | null = null;
  private lastUncertainty = 0;
  private extraSpacingPending = 0;
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
    return 250 - t * 80; // 250 -> 170
  }

  private spacingAt(t: number): number {
    return 460 - t * 120; // 460 -> 340 (world px between obstacle centers)
  }

  /** Advance the spawn clock; returns a new Obstacle when one should appear, else null. */
  step(dt: number, distance: number, scrollSpeed: number, spawnX: number): Obstacle | null {
    this.distanceSinceSpawn += scrollSpeed * dt;
    const t = this.difficultyAt(distance);
    const spacing = this.spacingAt(t) + this.extraSpacingPending;
    if (this.distanceSinceSpawn < spacing) return null;
    this.distanceSinceSpawn = 0;
    this.extraSpacingPending = 0;

    return this.spawn(t, spawnX, spacing);
  }

  private pickKind(t: number): ObstacleKind {
    const roll = (): ObstacleKind => {
      const r = this.rng();
      if (t < 0.15) return "gateWalls";
      if (t < 0.4) return r < 0.6 ? "gateWalls" : "spikes";
      if (t < 0.7) {
        if (r < 0.4) return "gateWalls";
        if (r < 0.75) return "spikes";
        return "movingGate";
      }
      if (r < 0.3) return "spikes";
      if (r < 0.55) return "movingGate";
      if (r < 0.75) return "rotor";
      return "gateWalls";
    };
    let kind = roll();
    // Never chain two of the same dynamic (moving/spinning) obstacle back to
    // back - one is a fair dodge, two in a row with no breather isn't.
    if (kind === this.lastKind && (kind === "movingGate" || kind === "rotor")) kind = roll();
    return kind;
  }

  private spawn(t: number, spawnX: number, spacing: number): Obstacle {
    const kind = this.pickKind(t);
    const gapSize = this.gapSizeAt(t);
    const margin = gapSize / 2 + 40;

    // How far the player could actually travel (vertically) in the time
    // between this obstacle and the last one, given their real move speed -
    // not just a fraction of the world height. `lastUncertainty` shrinks the
    // budget further when the player's exit position from the previous
    // obstacle wasn't pinned to its nominal center (see class comment).
    const scrollSpeed = this.scrollSpeedAt(t * 7000);
    const reactionTime = spacing / scrollSpeed;
    const physicsReach = PHYSICS.moveSpeed * reactionTime * 0.72; // safety margin for accel ramp-up + reaction lag
    const geometryCap = this.worldHeight * (0.3 + 0.15 * (1 - t));
    const maxJump = Math.max(50, Math.min(geometryCap, physicsReach) - this.lastUncertainty);

    let gapCenter = this.lastGapCenter + randRange(this.rng, -maxJump, maxJump);
    gapCenter = clamp(gapCenter, margin, this.worldHeight - margin);
    this.lastGapCenter = gapCenter;
    this.lastKind = kind;

    const pickupRoll = this.rng();
    let pickup: PickupKind = null;
    if (pickupRoll < 0.03) pickup = "shield";
    else if (pickupRoll < 0.06) pickup = "magnet";
    else if (pickupRoll < 0.09) pickup = "multiplier";
    else if (pickupRoll < 0.12) pickup = "slowmo";
    else if (pickupRoll < 0.24) pickup = "star";
    else if (pickupRoll < 0.85) pickup = "coin";

    const obstacle: Obstacle = {
      id: this.nextId++,
      kind,
      x: spawnX,
      width: kind === "spikes" ? 110 : 74,
      worldHeight: this.worldHeight,
      age: 0,
      passed: false,
      shieldHit: false,
      pickup,
      pickupCollected: false,
      pickupY: gapCenter + randRange(this.rng, -gapSize * 0.15, gapSize * 0.15),
      pickupOffsetX: 0,
      pickupOffsetY: 0,
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
      this.lastUncertainty = obstacle.gapAmplitude;
      this.extraSpacingPending = 90;
    } else if (kind === "rotor") {
      obstacle.rotorLength = randRange(this.rng, 80, 115);
      obstacle.rotorSpeed = (this.rng() < 0.5 ? -1 : 1) * randRange(this.rng, 1.2, 1.8 + t * 0.8);
      obstacle.rotorBaseAngle = randRange(this.rng, 0, Math.PI * 2);
      obstacle.width = obstacle.rotorLength * 2.2;
      obstacle.pickup = pickupRoll < 0.5 ? "coin" : null; // keep rotor rows a little less pickup-cluttered
      obstacle.pickupY = obstacle.gapCenter - obstacle.rotorLength * 1.6;
      this.lastUncertainty = obstacle.rotorLength * 0.6;
      this.extraSpacingPending = 130;
    } else {
      this.lastUncertainty = 0;
    }

    return obstacle;
  }
}
