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

if (import.meta.env.DEV) {
  // Dev-only escape hatch for manual/automated testing - not shipped in the production build.
  (window as any).__SJOTTENS_DEBUG__ = game;
}
