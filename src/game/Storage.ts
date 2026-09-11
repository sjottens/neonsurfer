/**
 * All persistence for Sjottens. Everything lives in localStorage under one
 * versioned key - no account, no server, works purely in this browser.
 * (localStorage rather than document.cookie: it never gets sent over the
 * network, holds far more data, and doesn't expire - the right tool for
 * "remember this player's progress on this device".)
 */

const STORAGE_KEY = "sjottens:save:v1";

export interface SaveData {
  version: 1;
  bestScore: number;
  bestDistance: number;
  totalCoins: number; // spendable currency, banked between runs
  lifetimeCoins: number; // for stats/bragging, never decreases
  runsPlayed: number;
  unlockedSkins: string[];
  equippedSkin: string;
  muted: boolean;
}

function defaultSave(): SaveData {
  return {
    version: 1,
    bestScore: 0,
    bestDistance: 0,
    totalCoins: 0,
    lifetimeCoins: 0,
    runsPlayed: 0,
    unlockedSkins: ["classic"],
    equippedSkin: "classic",
    muted: false,
  };
}

function load(): SaveData {
  if (typeof window === "undefined") return defaultSave();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSave();
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1) return defaultSave();
    return { ...defaultSave(), ...parsed };
  } catch {
    return defaultSave();
  }
}

function persist(data: SaveData): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // storage unavailable (private mode / quota) - the run still works, it just won't be remembered
  }
}

class SaveManager {
  private data: SaveData = load();

  get(): Readonly<SaveData> {
    return this.data;
  }

  /** Record the result of a finished run. Returns whether it beat the previous best score. */
  recordRun(score: number, distance: number, coinsEarned: number): { isNewBest: boolean } {
    const isNewBest = score > this.data.bestScore;
    this.data.bestScore = Math.max(this.data.bestScore, score);
    this.data.bestDistance = Math.max(this.data.bestDistance, distance);
    this.data.totalCoins += coinsEarned;
    this.data.lifetimeCoins += coinsEarned;
    this.data.runsPlayed += 1;
    persist(this.data);
    return { isNewBest };
  }

  canAfford(cost: number): boolean {
    return this.data.totalCoins >= cost;
  }

  purchaseSkin(skinId: string, cost: number): boolean {
    if (this.data.unlockedSkins.includes(skinId)) return true;
    if (!this.canAfford(cost)) return false;
    this.data.totalCoins -= cost;
    this.data.unlockedSkins.push(skinId);
    persist(this.data);
    return true;
  }

  equipSkin(skinId: string): void {
    if (!this.data.unlockedSkins.includes(skinId)) return;
    this.data.equippedSkin = skinId;
    persist(this.data);
  }

  setMuted(muted: boolean): void {
    this.data.muted = muted;
    persist(this.data);
  }

  /** Wipes all local progress. Used by the "reset" option in settings. */
  reset(): void {
    this.data = defaultSave();
    persist(this.data);
  }
}

export const save = new SaveManager();
