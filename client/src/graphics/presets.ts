import type { Kind, PhotoMode } from "./build";

/**
 * The builder's starting points. Each picks a template, a picture style and
 * which boxes start ticked; everything stays adjustable afterwards.
 */
export type Preset = {
  id: string;
  label: string;
  group: "Fight" | "Card" | "Yours";
  kind: Kind;
  photo: PhotoMode;
  /** Ticks that differ from the template's defaults. */
  choices?: Record<string, boolean>;
};

/** How they fight takes four rows; a pick graphic gives that room to the pick. */
const LEAN = { "m:slpm": false, "m:accuracy": false, "m:td": false, "m:control": false };

export const PRESETS: Preset[] = [
  { id: "tape", label: "Tale of the tape", group: "Fight", kind: "matchup", photo: "full" },
  { id: "fans-odds", label: "Fans vs odds", group: "Fight", kind: "matchup", photo: "full", choices: { ...LEAN, odds: false, "pick:community": true, "pick:odds": true } },
  { id: "result", label: "Fight result", group: "Fight", kind: "result", photo: "full" },
  { id: "list", label: "Bout list", group: "Card", kind: "event", photo: "none" },
  { id: "faces", label: "Card faces", group: "Card", kind: "event", photo: "head" },
  { id: "community", label: "Community card", group: "Card", kind: "event", photo: "none", choices: { records: false, "pick:community": true } },
  { id: "pick", label: "My pick", group: "Yours", kind: "matchup", photo: "full", choices: { ...LEAN, "pick:mine": true } },
  { id: "card-picks", label: "My card picks", group: "Yours", kind: "event", photo: "head", choices: { "pick:mine": true } },
  { id: "parlay", label: "My parlay", group: "Yours", kind: "parlay", photo: "none" },
  { id: "fighter", label: "Fighter", group: "Yours", kind: "fighter", photo: "full" },
];
