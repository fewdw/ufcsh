import type { FightIndex, TitleHolders } from "./fight-index.ts";

/**
 * Turn the raw title-bout flag into the useful part of a fighter's story.
 * UFCStats does not tell us which athlete entered as champion, so we infer it
 * from the division's complete belt sequence (kept by the fight index) rather
 * than from one fighter's record alone.
 */

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

type TitleState = {
  undisputed: boolean;
  interim: boolean;
  heldUndisputedBefore: boolean;
  heldInterimBefore: boolean;
  undisputedDefenses: number;
  interimDefenses: number;
};

function emptyTitleState(): TitleState {
  return {
    undisputed: false,
    interim: false,
    heldUndisputedBefore: false,
    heldInterimBefore: false,
    undisputedDefenses: 0,
    interimDefenses: 0,
  };
}

/** Minimal shape shared by database rows and indexed fights. */
export type TitleRow = {
  id: string;
  title_fight: number | boolean;
  title_type: string;
  weight_class: string;
  event_date: string;
  ord?: number;
  f1_id: string;
  f2_id: string;
  f1_outcome: string | null;
  f2_outcome: string | null;
};

export function outcomeFor(fight: TitleRow, fighterId: string): string | null {
  return fight.f1_id === fighterId ? fight.f1_outcome : fight.f2_outcome;
}

export type Lineage = Pick<FightIndex, "holdersBefore" | "interimClaimBefore">;

export function titleNarratives(rows: TitleRow[], fighterId: string, lineage: Lineage): Map<string, string> {
  const narratives = new Map<string, string>();
  const divisions = new Map<string, TitleState>();

  for (const fight of rows) {
    if (!fight.title_fight) continue;

    const division = fight.weight_class || "Unknown division";
    const state = divisions.get(division) ?? emptyTitleState();
    const outcome = outcomeFor(fight, fighterId);
    const opponentId = fight.f1_id === fighterId ? fight.f2_id : fight.f1_id;
    const holders: TitleHolders = lineage.holdersBefore(division, fight.event_date, fight.ord);
    state.undisputed = holders.undisputed === fighterId;
    state.interim = holders.interim === fighterId;
    if (!state.undisputed) state.undisputedDefenses = 0;
    if (!state.interim) state.interimDefenses = 0;

    const participants = new Set([fighterId, opponentId]);
    const recognizedUnification = fight.title_type === "title"
      && !!holders.undisputed
      && !!holders.interim
      && holders.undisputed !== holders.interim
      && participants.has(holders.undisputed)
      && participants.has(holders.interim);
    const fighterClaim = lineage.interimClaimBefore(fighterId, division, fight.event_date, fight.ord);
    const opponentClaim = lineage.interimClaimBefore(opponentId, division, fight.event_date, fight.ord);
    const inferredPromotedChampion = fight.title_type === "title"
      && (!holders.undisputed || !participants.has(holders.undisputed))
      && ((holders.interim === fighterId && opponentClaim) || (holders.interim === opponentId && fighterClaim));
    const unification = recognizedUnification || inferredPromotedChampion;
    if (inferredPromotedChampion && holders.interim === opponentId && fighterClaim) {
      state.undisputed = true;
      state.heldUndisputedBefore = true;
    }
    const promotedInterimChampion = fight.title_type === "title"
      && state.interim
      && !unification
      && (!holders.undisputed || !participants.has(holders.undisputed));
    if (promotedInterimChampion) {
      state.interim = false;
      state.undisputed = true;
      state.heldUndisputedBefore = true;
    }
    let narrative: string;

    if (fight.title_type === "tuf" || fight.title_type === "tournament") {
      const prefix = fight.title_type === "tuf" ? "TUF tournament" : "Tournament";
      narrative = outcome === "win" ? `${prefix} winner` : outcome === "loss" ? `${prefix} finalist` : `${prefix} final`;
    } else if (fight.title_type === "interim") {
      if (state.interim) {
        if (outcome === null) {
          narrative = `${ordinal(state.interimDefenses + 1)} interim title defense`;
        } else if (outcome === "loss") {
          narrative = "Interim title lost";
          state.interim = false;
          state.interimDefenses = 0;
        } else if (outcome === "win") {
          state.interimDefenses += 1;
          narrative = `${ordinal(state.interimDefenses)} interim title defense`;
        } else {
          narrative = "Interim title retained";
        }
      } else if (outcome === "win") {
        narrative = state.heldInterimBefore ? "Interim title regained" : "Interim title won";
        state.interim = true;
        state.heldInterimBefore = true;
        state.interimDefenses = 0;
      } else if (outcome === "loss") {
        narrative = "Interim title shot lost";
      } else {
        narrative = "Interim title shot";
      }
    } else if (fight.title_type === "title" && state.interim) {
      if (outcome === "win") {
        narrative = "Undisputed title won · Titles unified";
        state.undisputed = true;
        state.heldUndisputedBefore = true;
        state.undisputedDefenses = 0;
        state.interim = false;
      } else if (outcome === "loss") {
        narrative = "Interim champion · Unification lost";
        state.interim = false;
        state.interimDefenses = 0;
      } else if (outcome === null) {
        narrative = "Interim champion · Unification bout";
      } else {
        narrative = "Interim title retained · Unification unresolved";
      }
    } else if (fight.title_type === "title" && state.undisputed) {
      if (outcome === null) {
        narrative = `${ordinal(state.undisputedDefenses + 1)} title defense${unification ? " · Unification bout" : ""}`;
      } else if (outcome === "loss") {
        narrative = `Title lost${unification ? " · Unification bout" : ""}`;
        state.undisputed = false;
        state.undisputedDefenses = 0;
      } else if (outcome === "win") {
        state.undisputedDefenses += 1;
        narrative = `${ordinal(state.undisputedDefenses)} title defense${unification ? " · Titles unified" : ""}`;
      } else {
        narrative = `Title retained${unification ? " · Unification unresolved" : ""}`;
      }
    } else if (fight.title_type === "title") {
      if (outcome === "win") {
        narrative = state.heldUndisputedBefore ? "Title regained" : "Won title";
        state.undisputed = true;
        state.heldUndisputedBefore = true;
        state.undisputedDefenses = 0;
      } else if (outcome === "loss") {
        narrative = "Title shot lost";
      } else {
        narrative = "Title shot";
      }
    } else {
      narrative = outcome === "win" ? "Title bout won" : outcome === "loss" ? "Title bout lost" : "Title bout";
    }

    narratives.set(fight.id, narrative);
    divisions.set(division, state);
  }

  return narratives;
}
