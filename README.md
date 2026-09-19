# Neon Surfer

*(lives in the `sjottens/` folder - the project's internal codename)*

A 3D neon surfing runner. You see the surfer from behind as they race across
a synthwave ocean: **slalom** around rocks and buoys, **jump** the hazard logs,
launch off ramps for big air, and grab coins and power-ups - faster and
trickier the longer you survive.

**100% client-side.** No account, no server, no build-time secrets. Every
run, your best score and coins are saved locally in your browser via
`localStorage` - nothing ever leaves your machine.

## Play

```bash
npm install
npm run dev
```

Open the printed local URL (default `http://localhost:5174`).

| Control | Action |
| --- | --- |
| `←` / `→` | steer left / right |
| `Space` | jump |
| `Esc` | pause |
| `Space` / `Enter` | start from the menu / play again after a wipeout |

On a touch device, on-screen buttons appear: ◀ ▶ on the left, JUMP on the right.

### Reading the course

- **Rocks & buoys** (level color, tall) - steer around them.
- **Yellow/black logs** (low) - jump over them. A full-width log *must* be jumped.
- **White ramps** - ride one and you launch much higher than a normal jump; a coin arc traces the flight.
- **Shark fins** (later levels) - sweep side to side; time your pass.
- **Air tricks** - while airborne, hold `←` for a *rail grab* or `→` for a *method*. Land it for points (longer hold = more), but air steering is slower while you hold the trick. Ramps give the most hang time.
- **Style points** - skim past an obstacle for a *NEAR MISS*, or clear a log for a *CLEAN JUMP*. Chain them within 5 seconds for a growing streak bonus.
- **Power-ups** - shield (smash through obstacles), magnet, 2x score, slow-mo.

## How it's built

- **Vite + TypeScript + three.js**, no UI framework - one WebGL canvas renders
  the world, a thin DOM layer (`src/game/UI.ts`) renders the menu/HUD.
- **`World.ts`** - the scenery: a displaced-wave water shader with a neon grid,
  a synthwave sky/sun dome, mountains, palm islands, edge buoys and speed
  streaks. The palette eases between six named level "worlds" (`Levels.ts`).
- **`Player.ts`** - the surfer is modelled from primitives and animated
  procedurally (two-bone IK legs/arms, crouch, lean into turns, air pose,
  ragdoll on a wipeout). Jumping has a input buffer and coyote time.
- **Procedural, fairness-checked level design** (`ObstacleGenerator.ts`): the
  course is generated in rows across five lanes. Every row leaves a window
  that is reachable from the previous one at the surfer's real steering speed,
  jump rows come with recovery time, and the first rows teach the mechanics.
  Difficulty, speed and obstacle variety ramp up with distance.
- **Post-processing**: bloom for the neon look, with automatic quality
  fallback (bloom off, then lower resolution) if the device can't keep up.
- **Audio** (`Audio.ts`): sound effects are synthesized with the Web Audio API;
  the soundtrack is `src/assets/reve.mp3`, looped and ducked under the action.
- **Persistence** (`Storage.ts`) is a small versioned wrapper around
  `localStorage`: best score/distance, banked coins, mute preference.
- **Reserved ad slots** either side of the game stage on wide viewports
  (`#ad-left` / `#ad-right` in `index.html`) - empty by default.

## Scripts

- `npm run dev` - dev server on port 5174
- `npm run build` - type-check + production build to `dist/`
- `npm run preview` - preview the production build locally
