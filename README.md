# Neon Surfer

*(lives in the `sjottens/` folder - the project's internal codename)*

A neon arcade glider: steer a glowing surfboard up and down through a
never-ending, difficulty-ramping obstacle course. No gravity to fight - you
have direct control, so it's pure precision dodging.

**100% client-side.** No account, no server, no build-time secrets. Every
run, your best score and coins are saved locally in your browser via
`localStorage` - nothing ever leaves your machine.

## Play

```bash
npm install
npm run dev
```

Open the printed local URL (default `http://localhost:5174`). Hold `↑` to
rise, `↓` to dive - or hold the top/bottom half of the screen on mouse/touch.
Let go of both to hover in place. Dodge the neon obstacles, grab coins and
stars, and try to beat your best score.

## How it's built

- **Vite + TypeScript**, no UI framework - a single `<canvas>` renders the
  game world, a thin DOM layer (`src/game/UI.ts`) renders the menu/HUD.
- **Procedural, difficulty-scaled level generation** (`ObstacleGenerator.ts`)
  instead of hand-authored levels: gaps, obstacle variety and scroll speed
  all ramp up with distance, and consecutive gaps are clamped so a run is
  always theoretically survivable, never a blind-luck wall.
- **Four obstacle types**: classic gates, spiked gates, vertically-oscillating
  gates, and rotating beam hazards.
- **All audio is synthesized** with the Web Audio API (`Audio.ts`) - zero
  sound files to fetch or bundle.
- **Persistence** (`Storage.ts`) is a small versioned wrapper around
  `localStorage`: best score/distance, banked coins, mute preference.
- **Reserved ad slots** either side of the game stage on wide viewports
  (`#ad-left` / `#ad-right` in `index.html`) - empty by default, ready for
  an AdSense unit once there's a publisher id to put there.

## Scripts

- `npm run dev` - dev server on port 5174
- `npm run build` - type-check + production build to `dist/`
- `npm run preview` - preview the production build locally
