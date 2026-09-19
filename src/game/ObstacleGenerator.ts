import { LANES, LANE_W, laneX, type ObstacleSpec } from "./Obstacle";
import type { PickupKind, PickupSpec } from "./Pickups";
import { PHYSICS } from "./Player";
import { clamp, lerp, randRange } from "./utils";

export interface Row {
  obstacles: ObstacleSpec[];
  pickups: PickupSpec[];
}

type RowType = "solid" | "jump" | "ramp" | "fin";

export const SPAWN_AHEAD = 170; // how far down the track the world is generated

/**
 * Procedural level design, in "rows" across a five-lane corridor.
 *
 * Fairness rules baked in (the whole point of a runner is that a crash is
 * always your own fault):
 *  - Every solid row leaves an open window, and that window is always
 *    reachable from the previous row's window at the surfer's real lateral
 *    speed and the time actually available.
 *  - Jump rows (full-width logs) come with generous breathing room after,
 *    so you've landed and can steer before the next thing arrives.
 *  - The first rows teach: two easy slalom rows, then a single jump.
 *  - Difficulty t ramps 0 -> 1: faster, tighter windows, more variety.
 */
export class ObstacleGenerator {
  private lastD = 0; // track distance of the last generated row
  private rowIndex = 0;
  private prevOpen: number[] = [2];
  private prevGuide = 0;
  private lastType: RowType = "solid";
  private extraTime = 0; // recovery time owed after a demanding row
  private rng: () => number;

  constructor(rng: () => number) {
    this.rng = rng;
    this.lastD = 12;
  }

  /** 0 at the start of a run, approaching 1 after a couple of minutes. */
  difficultyAt(distance: number): number {
    return clamp(distance / 5200, 0, 1);
  }

  speedAt(distance: number): number {
    return 24 + 26 * this.difficultyAt(distance); // 24 -> 50 units/s
  }

  /** Generate every row that should exist within SPAWN_AHEAD of the surfer. */
  fill(distance: number): Row[] {
    const rows: Row[] = [];
    while (this.lastD < distance + SPAWN_AHEAD) rows.push(this.makeRow());
    return rows;
  }

  private makeRow(): Row {
    const t = this.difficultyAt(this.lastD);
    const speed = this.speedAt(this.lastD);
    const gapTime = lerp(2.0, 1.05, t) + this.extraTime;
    const spacing = speed * gapTime;
    const prevD = this.lastD;
    const D = prevD + spacing;
    this.lastD = D;

    // how many lanes the surfer can realistically cross in the time between rows
    const maxShift = Math.max(1, Math.floor(((gapTime - 0.3) * PHYSICS.latSpeed * 0.8) / LANE_W));

    const type = this.pickType(t);
    const row: Row = { obstacles: [], pickups: [] };
    let guide = this.prevGuide;
    let nextOpen: number[] = [];
    let extra = 0;
    let coinLine = true;

    if (type === "solid") {
      const openCount = this.openCount(t);
      const window = this.pickWindow(openCount, maxShift);
      nextOpen = window;
      guide = laneX((window[0] + window[window.length - 1]) / 2);
      for (let lane = 0; lane < LANES; lane++) {
        if (window.includes(lane)) continue;
        const jitter = randRange(this.rng, -0.35, 0.35);
        const dj = randRange(this.rng, -0.8, 0.8);
        if (t > 0.3 && this.rng() < 0.22) {
          // a single low log in a blocked lane - a shortcut for players who jump
          row.obstacles.push({ kind: "log", x: laneX(lane), d: D + dj, span: 1 });
        } else {
          row.obstacles.push({ kind: this.rng() < 0.5 ? "buoy" : "rock", x: laneX(lane) + jitter, d: D + dj });
        }
      }
    } else if (type === "jump") {
      nextOpen = allLanes();
      extra = 0.4;
      coinLine = false;
      row.obstacles.push({ kind: "log", x: 0, d: D, span: LANES });
      // a coin arc that hangs over the log: pick them up by jumping
      const arc = [-6, -3, 0, 3, 6];
      for (const off of arc) {
        const y = 0.5 + 2.0 * (1 - (off / 7) ** 2);
        row.pickups.push({ kind: "coin", x: guide, y, d: D + off });
      }
      if (this.rng() < 0.18) row.pickups.push({ kind: "star", x: guide, y: 2.9, d: D });
    } else if (type === "ramp") {
      const lane = this.pickLane(maxShift);
      guide = laneX(lane);
      nextOpen = allLanes();
      extra = 0.95;
      coinLine = false;
      row.obstacles.push({ kind: "ramp", x: guide, d: D });
      // coins that trace the real launch trajectory at this speed
      const g = PHYSICS.gravity;
      for (let i = 0; i < 6; i++) {
        const tt = 0.16 + i * 0.11;
        const y = 1.15 + PHYSICS.rampV * tt - 0.5 * g * tt * tt;
        row.pickups.push({ kind: "coin", x: guide, y: Math.max(0.6, y), d: D + 1.9 + speed * tt });
      }
      if (this.rng() < 0.25) row.pickups.push({ kind: "star", x: guide, y: 4.2, d: D + 1.9 + speed * 0.44 });
    } else {
      // fin: a shark fin sweeping across the corridor - time your pass
      nextOpen = allLanes();
      extra = 0.5;
      coinLine = false;
      guide = 0;
      row.obstacles.push({
        kind: "fin",
        x: 0,
        d: D,
        amp: 5.5,
        freq: lerp(1.1, 1.8, t),
        phase: randRange(this.rng, 0, Math.PI * 2),
      });
    }

    if (coinLine && this.rowIndex > 0 && this.rng() < 0.78) {
      // start the line clear of any coin arc the previous row left hanging
      const startOff = this.lastType === "jump" ? 9.5 : this.lastType === "ramp" ? 5 + speed * 0.8 : 4.5;
      const n = clamp(Math.floor((spacing - startOff - 5) / 2.6) + 1, 0, 8);
      const pr = this.rng();
      let special: PickupKind | null = null;
      if (pr < 0.03) special = "shield";
      else if (pr < 0.06) special = "magnet";
      else if (pr < 0.09) special = "multiplier";
      else if (pr < 0.12) special = "slowmo";
      else if (pr < 0.24) special = "star";
      for (let i = 0; i < n; i++) {
        const f = n === 1 ? 1 : i / (n - 1);
        const kind: PickupKind = special && i === Math.floor(n / 2) ? special : "coin";
        row.pickups.push({ kind, x: lerp(this.prevGuide, guide, f), y: 0.9, d: prevD + startOff + i * 2.6 });
      }
    }

    this.prevOpen = nextOpen;
    this.prevGuide = guide;
    this.lastType = type;
    this.extraTime = extra;
    this.rowIndex++;
    return row;
  }

  private pickType(t: number): RowType {
    if (this.rowIndex < 2) return "solid";
    if (this.rowIndex === 2) return "jump"; // the tutorial jump
    let jumpP = t < 0.03 ? 0 : 0.2;
    let rampP = t < 0.12 ? 0 : 0.09;
    let finP = t < 0.3 ? 0 : 0.12;
    if (this.lastType === "jump") jumpP = 0;
    if (this.lastType === "ramp") {
      rampP = 0;
      jumpP = 0;
    }
    if (this.lastType === "fin") finP = 0;
    const r = this.rng();
    if (r < jumpP) return "jump";
    if (r < jumpP + rampP) return "ramp";
    if (r < jumpP + rampP + finP) return "fin";
    return "solid";
  }

  /** How many contiguous lanes are left open in a solid row. */
  private openCount(t: number): number {
    const r = this.rng();
    if (this.rowIndex < 2 || t < 0.2) return 3;
    if (t < 0.5) return r < 0.7 ? 2 : 3;
    if (t < 0.8) return r < 0.6 ? 1 : 2;
    return r < 0.75 ? 1 : 2;
  }

  /** Choose a window of `count` contiguous lanes reachable from where the previous row let you through. */
  private pickWindow(count: number, maxShift: number): number[] {
    const options: number[][] = [];
    for (let s = 0; s + count <= LANES; s++) {
      const w = Array.from({ length: count }, (_, i) => s + i);
      if (this.reachable(w, maxShift)) options.push(w);
    }
    if (options.length === 0) {
      // can't happen with maxShift >= 1, but never emit an unsolvable row: open the lane nearest the surfer
      const center = clamp(Math.round(this.prevOpen[0]), 0, LANES - count);
      return Array.from({ length: count }, (_, i) => center + i);
    }
    return options[Math.floor(this.rng() * options.length)];
  }

  private pickLane(maxShift: number): number {
    const lanes: number[] = [];
    for (let l = 0; l < LANES; l++) if (this.reachable([l], maxShift)) lanes.push(l);
    return lanes.length ? lanes[Math.floor(this.rng() * lanes.length)] : Math.floor(LANES / 2);
  }

  private reachable(window: number[], maxShift: number): boolean {
    return window.some((w) => this.prevOpen.some((p) => Math.abs(w - p) <= maxShift));
  }
}

function allLanes(): number[] {
  return Array.from({ length: LANES }, (_, i) => i);
}
