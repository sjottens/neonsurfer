import { Game, type GameState, type HudState, type RunResult } from "./Game";
import { save } from "./Storage";
import { audio } from "./Audio";
import { formatNumber } from "./utils";

const FIRST_VISIT_KEY = "sjottens:seen-hint";

export class UI {
  private root: HTMLElement;
  private game: Game;
  private hudEl: HTMLElement | null = null;

  constructor(root: HTMLElement, game: Game) {
    this.root = root;
    this.game = game;
    audio.setMuted(save.get().muted);

    game.onStateChange = (state, payload) => this.render(state, payload);
    game.onHud = (hud) => this.updateHud(hud);

    this.render("menu");
  }

  private clear() {
    this.root.innerHTML = "";
    this.hudEl = null;
  }

  private render(state: GameState, payload?: RunResult) {
    this.clear();
    if (state === "menu") this.renderMenu();
    else if (state === "playing") this.renderHud();
    else if (state === "paused") {
      this.renderHud();
      this.renderPause();
    } else if (state === "gameover" && payload) this.renderGameOver(payload);
  }

  // ------------------------------------------------------------- screens

  private renderMenu() {
    const data = save.get();
    const seenHint = localStorage.getItem(FIRST_VISIT_KEY);

    const el = document.createElement("div");
    el.className = "overlay";
    el.innerHTML = `
      <div class="logo">NEON SURFER</div>

      <div class="menu-stats">
        <div class="stat"><span class="value">${formatNumber(data.bestScore)}</span><span class="label">Best Score</span></div>
        <div class="stat"><span class="value">${formatNumber(data.totalCoins)}</span><span class="label">Coins</span></div>
        <div class="stat"><span class="value">${data.runsPlayed}</span><span class="label">Runs</span></div>
      </div>

      <div class="menu-actions">
        <button class="neon-btn" data-action="play">▶ PLAY</button>
        <button class="neon-btn secondary" data-action="mute">${data.muted ? "🔇 Sound Off" : "🔊 Sound On"}</button>
      </div>

      ${
        seenHint
          ? ""
          : `<p class="hint">Hold <kbd>↑</kbd> to rise, <kbd>↓</kbd> to dive - or use the on-screen buttons on mobile. Dodge the neon, grab the coins!</p>`
      }
      <p class="credit">100% in je browser · geen account nodig · voortgang lokaal opgeslagen</p>
    `;
    this.root.appendChild(el);

    el.querySelector('[data-action="play"]')?.addEventListener("click", () => {
      audio.uiClick();
      localStorage.setItem(FIRST_VISIT_KEY, "1");
      this.game.startRun();
    });
    el.querySelector('[data-action="mute"]')?.addEventListener("click", () => {
      const next = !save.get().muted;
      this.game.setMuted(next);
      this.render("menu");
    });
  }

  private renderHud() {
    const el = document.createElement("div");
    el.className = "hud";
    el.innerHTML = `
      <div>
        <div class="hud-score" id="hud-score">0</div>
        <div class="hud-best">BEST ${formatNumber(save.get().bestScore)}</div>
      </div>
      <div class="hud-top-right">
        <button class="icon-btn" data-action="pause" title="Pause">⏸</button>
        <div class="hud-coins" id="hud-coins">🪙 0</div>
      </div>
    `;
    this.root.appendChild(el);
    this.hudEl = el;
    el.querySelector('[data-action="pause"]')?.addEventListener("click", () => {
      audio.uiClick();
      this.game.pause();
    });

    const escHandler = (e: KeyboardEvent) => {
      if (e.code === "Escape" && this.game.currentState === "playing") this.game.pause();
    };
    window.addEventListener("keydown", escHandler);

    this.renderSteerButtons();
  }

  /**
   * Dedicated mobile steering buttons: left = up, right = down. Shown only
   * on touch devices (see the `(pointer: coarse)` gate in styles.css) -
   * mouse/keyboard players keep using the arrow keys / tap-zone instead.
   */
  private renderSteerButtons() {
    const wrap = document.createElement("div");
    wrap.className = "steer-buttons";
    wrap.innerHTML = `
      <button class="steer-btn steer-btn-up" data-dir="up" aria-label="Omhoog">▲</button>
      <button class="steer-btn steer-btn-down" data-dir="down" aria-label="Omlaag">▼</button>
    `;
    this.root.appendChild(wrap);

    for (const btn of wrap.querySelectorAll<HTMLButtonElement>(".steer-btn")) {
      const dir = btn.dataset.dir === "up" ? "up" : "down";
      const press = (e: Event) => {
        e.preventDefault();
        btn.classList.add("active");
        this.game.setSteerButton(dir, true);
      };
      const release = () => {
        btn.classList.remove("active");
        this.game.setSteerButton(dir, false);
      };
      btn.addEventListener("pointerdown", press);
      btn.addEventListener("pointerup", release);
      btn.addEventListener("pointercancel", release);
      btn.addEventListener("pointerleave", release);
    }
  }

  private updateHud(hud: HudState) {
    if (!this.hudEl) return;
    const scoreEl = this.hudEl.querySelector("#hud-score");
    const coinsEl = this.hudEl.querySelector("#hud-coins");
    if (scoreEl) scoreEl.textContent = formatNumber(hud.score);
    if (coinsEl) coinsEl.textContent = `🪙 ${formatNumber(hud.coins)}`;
  }

  private renderPause() {
    const el = document.createElement("div");
    el.className = "overlay";
    el.innerHTML = `
      <div class="logo" style="font-size: 42px;">PAUSED</div>
      <div class="menu-actions">
        <button class="neon-btn" data-action="resume">▶ Resume</button>
        <button class="neon-btn secondary" data-action="menu">Main Menu</button>
      </div>
      <p class="hint">Press <kbd>Esc</kbd> to resume</p>
    `;
    this.root.appendChild(el);
    el.querySelector('[data-action="resume"]')?.addEventListener("click", () => {
      audio.uiClick();
      this.game.resume();
    });
    el.querySelector('[data-action="menu"]')?.addEventListener("click", () => {
      audio.uiClick();
      this.game.goToMenu();
    });

    const escHandler = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        window.removeEventListener("keydown", escHandler);
        this.game.resume();
      }
    };
    window.addEventListener("keydown", escHandler);
  }

  private renderGameOver(result: RunResult) {
    const el = document.createElement("div");
    el.className = "overlay";
    el.innerHTML = `
      <div class="logo" style="font-size: 34px; color: var(--neon-pink); text-shadow:0 0 8px var(--neon-pink),0 0 26px var(--neon-pink);">CRASHED</div>
      ${result.isNewBest ? `<div class="new-best-badge">🏆 NEW BEST SCORE!</div>` : ""}

      <div class="menu-stats">
        <div class="stat"><span class="value">${formatNumber(result.score)}</span><span class="label">Score</span></div>
        <div class="stat"><span class="value">${result.coins}</span><span class="label">Coins</span></div>
        <div class="stat"><span class="value">${result.stars}</span><span class="label">Stars</span></div>
      </div>

      <div class="menu-actions">
        <button class="neon-btn" data-action="retry">↻ PLAY AGAIN</button>
        <button class="neon-btn secondary" data-action="menu">☰ Menu</button>
      </div>
    `;
    this.root.appendChild(el);

    el.querySelector('[data-action="retry"]')?.addEventListener("click", () => {
      audio.uiClick();
      this.game.startRun();
    });
    el.querySelector('[data-action="menu"]')?.addEventListener("click", () => {
      audio.uiClick();
      this.game.goToMenu();
    });
  }
}
