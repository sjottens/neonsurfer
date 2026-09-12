import "./styles.css";
import { Game } from "./game/Game";
import { UI } from "./game/UI";

const canvas = document.getElementById("game-canvas") as HTMLCanvasElement | null;
const uiRoot = document.getElementById("ui-root");

if (!canvas || !uiRoot) {
  throw new Error("Sjottens: required DOM elements are missing");
}

const game = new Game(canvas);
new UI(uiRoot, game);

// Mirrors the (pointer: coarse) + (orientation: portrait) query in
// styles.css that swaps in the "rotate your phone" overlay - pause an
// in-progress run when it appears so obstacles don't keep coming while the
// player can't see or steer.
const portraitLock = window.matchMedia("(pointer: coarse) and (orientation: portrait) and (max-width: 900px)");
portraitLock.addEventListener("change", (e) => {
  if (e.matches && game.currentState === "playing") game.pause();
});

if (import.meta.env.DEV) {
  // Dev-only escape hatch for manual/automated testing - not shipped in the production build.
  (window as any).__SJOTTENS_DEBUG__ = game;
}
