export interface LevelTheme {
  name: string;
  accent: string; // neon hex - obstacle glow/stroke/fill and the horizon's glow band
  hue: number; // sky-gradient base hue, chosen to match `accent`
}

/**
 * One named "world" per level, cycling - obstacles and the horizon glow
 * reskin together instead of the obstacles changing color in isolation.
 * Level 1 keeps the original magenta look; later levels rotate through a
 * lap of the color wheel so a long run keeps feeling fresh.
 */
export const LEVEL_THEMES: LevelTheme[] = [
  { name: "Neon Dusk", accent: "#ff2fd6", hue: 300 },
  { name: "Cyber Tide", accent: "#00d9ff", hue: 195 },
  { name: "Solar Flare", accent: "#ff9d2e", hue: 30 },
  { name: "Acid Rain", accent: "#39ff6a", hue: 140 },
  { name: "Void Drift", accent: "#8a5bff", hue: 258 },
  { name: "Blood Moon", accent: "#ff3b5c", hue: 350 },
];

export function themeForLevel(level: number): LevelTheme {
  return LEVEL_THEMES[(level - 1) % LEVEL_THEMES.length];
}
