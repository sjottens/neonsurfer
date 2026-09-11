export interface Skin {
  id: string;
  name: string;
  cost: number;
  core: string; // main orb color
  glow: string; // glow/shadow color
  trail: string; // particle trail color
}

export const SKINS: Skin[] = [
  { id: "classic", name: "Cyan Drift", cost: 0, core: "#7dfcff", glow: "#7dfcff", trail: "#7dfcff" },
  { id: "magenta", name: "Magenta Surge", cost: 150, core: "#ff2fd6", glow: "#ff2fd6", trail: "#ff8ae8" },
  { id: "toxic", name: "Toxic Bloom", cost: 300, core: "#b6ff3c", glow: "#b6ff3c", trail: "#e8ffb0" },
  { id: "solar", name: "Solar Flare", cost: 500, core: "#ffb23c", glow: "#ff5f1f", trail: "#ffe873" },
  { id: "violet", name: "Void Violet", cost: 800, core: "#b26bff", glow: "#7a2fff", trail: "#d9b8ff" },
  { id: "chrome", name: "Chrome Prism", cost: 1200, core: "#ffffff", glow: "#7dfcff", trail: "#ff2fd6" },
];

export function getSkin(id: string): Skin {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}
