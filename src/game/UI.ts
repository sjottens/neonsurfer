import { Game, type GameState, type HudState, type RunResult } from "./Game";
import { save } from "./Storage";
import { audio } from "./Audio";
import { formatNumber } from "./utils";

const FIRST_VISIT_KEY = "sjottens:seen-hint";
const CONTROLS_HINT_RUNS = 3; // show the on-screen controls reminder for the first few runs
const RETRY_LOCKOUT_MS = 700; // ignore Space/Enter right after a crash so a jump-mash doesn't skip the result screen

export class UI {
  private root: HTMLElement;
  private game: Game;
  private hudEl: HTMLElement | null = null;
  private lastLevel = 1;
  private gameOverAt = 0;

  constructor(root: HTMLElement, game: Game) {
    this.root = root;
    this.game = game;
    audio.setMuted(save.get().muted);

    game.onStateChange = (state, payload) => this.render(state, payload);
    game.onHud = (hud) => this.updateHud(hud);
    game.onPopup = (text, color) => this.showPopup(text, color);

    window.addEventListener("keydown", this.handleKey);
    this.render("menu");
  }

  /** Global keys: Esc pauses/resumes; Space/Enter starts from the menu or retries after a crash. */
  private handleKey = (e: KeyboardEvent) => {
    const state = this.game.currentState;
    if (e.code === "Escape") {
      if (state === "playing") this.game.pause();
      else if (state === "paused") this.game.resume();
      return;
    }
    if (e.repeat || (e.code !== "Space" && e.code !== "Enter")) return;
    if (state === "menu") {
      e.preventDefault();
      this.startRun();
    } else if (state === "gameover" && performance.now() - this.gameOverAt > RETRY_LOCKOUT_MS) {
      e.preventDefault();
      this.startRun();
    }
  };

  private startRun() {
    audio.uiClick();
    localStorage.setItem(FIRST_VISIT_KEY, "1");
    this.game.startRun();
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
    } else if (state === "gameover" && payload) {
      this.gameOverAt = performance.now();
      this.renderGameOver(payload);
    }
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
          ? `<p class="hint"><kbd>←</kbd> <kbd>→</kbd> steer · <kbd>SPACE</kbd> jump</p>`
          : `<p class="hint">Steer with <kbd>←</kbd> <kbd>→</kbd> and slalom around the <b>rocks &amp; buoys</b>. Hit <kbd>SPACE</kbd> to jump the <b class="yellow">yellow logs</b> - and ride the <b>white ramps</b> for big air. Grab coins, stars and the shield, magnet, 2× and slow-mo power-ups!</p>`
      }
      <p class="credit">100% in je browser · geen account nodig · voortgang lokaal opgeslagen</p>
    `;
    this.root.appendChild(el);

    el.querySelector('[data-action="play"]')?.addEventListener("click", () => this.startRun());
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
        <div class="hud-level" id="hud-level">LVL 1</div>
        <div class="hud-buffs" id="hud-buffs"></div>
      </div>
      <div class="hud-top-right">
        <div class="hud-btn-row">
          <button class="icon-btn" data-action="mute" title="Sound">${save.get().muted ? "🔇" : "🔊"}</button>
          <button class="icon-btn" data-action="pause" title="Pause">⏸</button>
        </div>
        <div class="hud-coins" id="hud-coins">🪙 0</div>
      </div>
    `;
    this.root.appendChild(el);
    this.hudEl = el;
    this.lastLevel = 1; // fresh run - don't fire a level-up toast on the very first HUD update
    el.querySelector('[data-action="pause"]')?.addEventListener("click", () => {
      audio.uiClick();
      this.game.pause();
    });
    el.querySelector('[data-action="mute"]')?.addEventListener("click", (ev) => {
      const next = !save.get().muted;
      this.game.setMuted(next);
      (ev.currentTarget as HTMLElement).textContent = next ? "🔇" : "🔊";
      (ev.currentTarget as HTMLElement).blur(); // keep Space from re-triggering the button mid-run
    });

    if (save.get().runsPlayed < CONTROLS_HINT_RUNS && this.game.currentState === "playing") {
      const hint = document.createElement("div");
      hint.className = "controls-hint";
      hint.innerHTML = `<kbd>←</kbd> <kbd>→</kbd> steer <span class="sep">·</span> <kbd>SPACE</kbd> jump the yellow logs`;
      this.root.appendChild(hint);
      hint.addEventListener("animationend", () => hint.remove());
    }

    this.renderSteerButtons();
  }

  /**
   * Touch controls: ◀ ▶ on the left thumb, JUMP on the right. Shown only on
   * touch devices (see the `(pointer: coarse)` gate in styles.css) -
   * mouse/keyboard players use the arrow keys and space bar instead.
   */
  private renderSteerButtons() {
    const wrap = document.createElement("div");
    wrap.className = "steer-buttons";
    wrap.innerHTML = `
      <button class="steer-btn steer-btn-left" data-dir="left" aria-label="Links">◀</button>
      <button class="steer-btn steer-btn-right" data-dir="right" aria-label="Rechts">▶</button>
      <button class="steer-btn steer-btn-jump" data-dir="jump" aria-label="Spring">JUMP</button>
    `;
    this.root.appendChild(wrap);

    for (const btn of wrap.querySelectorAll<HTMLButtonElement>(".steer-btn")) {
      const dir = btn.dataset.dir as "left" | "right" | "jump";
      const press = (e: Event) => {
        e.preventDefault();
        btn.classList.add("active");
        if (dir === "jump") this.game.pressJumpButton();
        else this.game.setSteerButton(dir, true);
      };
      const release = () => {
        btn.classList.remove("active");
        if (dir !== "jump") this.game.setSteerButton(dir, false);
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
    const levelEl = this.hudEl.querySelector("#hud-level");
    if (scoreEl) scoreEl.textContent = formatNumber(hud.score);
    if (coinsEl) coinsEl.textContent = `🪙 ${formatNumber(hud.coins)}`;
    if (levelEl) levelEl.textContent = `LVL ${hud.level}`;
    if (hud.level > this.lastLevel) this.showLevelUpToast(hud.level, hud.levelName, hud.levelColor);
    this.lastLevel = hud.level;

    const buffsEl = this.hudEl.querySelector("#hud-buffs");
    if (buffsEl) {
      const buffs: [string, string, number][] = [
        ["shield", "🛡", hud.shieldTime],
        ["magnet", "🧲", hud.magnetTime],
        ["multiplier", "2×", hud.multiplierTime],
        ["slowmo", "🐢", hud.slowmoTime],
      ];
      buffsEl.innerHTML = buffs
        .filter(([, , time]) => time > 0)
        .map(([kind, icon, time]) => `<span class="buff-badge buff-${kind}">${icon} ${Math.ceil(time)}</span>`)
        .join("");
    }
  }

  /** Brief center-screen "LEVEL N" callout naming the new world - no sound, just a visual beat as the palette shifts. */
  private showLevelUpToast(level: number, name: string, color: string) {
    const toast = document.createElement("div");
    toast.className = "level-toast";
    toast.style.color = color;
    toast.style.textShadow = `0 0 10px ${color}, 0 0 30px ${color}`;
    toast.innerHTML = `LEVEL ${level}<span class="level-toast-name">${name}</span>`;
    this.root.appendChild(toast);
    toast.addEventListener("animationend", () => toast.remove());
  }

  /** Small floating callout for style moves ("NEAR MISS +10", "CLEAN JUMP +15 ×3"). */
  private showPopup(text: string, color: string) {
    if (this.game.currentState !== "playing") return;
    const el = document.createElement("div");
    el.className = "popup";
    el.style.color = color;
    el.style.textShadow = `0 0 8px ${color}, 0 0 20px ${color}`;
    el.textContent = text;
    this.root.appendChild(el);
    el.addEventListener("animationend", () => el.remove());
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
  }

  private renderGameOver(result: RunResult) {
    const el = document.createElement("div");
    el.className = "overlay";
    el.innerHTML = `
      <div class="logo" style="font-size: 34px; color: var(--neon-pink); text-shadow:0 0 8px var(--neon-pink),0 0 26px var(--neon-pink);">WIPEOUT!</div>
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
      <p class="hint"><kbd>SPACE</kbd> to go again</p>
    `;
    this.root.appendChild(el);

    el.querySelector('[data-action="retry"]')?.addEventListener("click", () => this.startRun());
    el.querySelector('[data-action="menu"]')?.addEventListener("click", () => {
      audio.uiClick();
      this.game.goToMenu();
    });
  }
}
