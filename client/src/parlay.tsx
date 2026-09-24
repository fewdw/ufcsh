/* oxlint-disable react/only-export-components -- provider, hook and the pure
   outcome-conflict helpers intentionally share one persistent source of truth. */
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { decimalOdds, americanFromDecimal } from "./methodOdds";
import type { OddsFormat } from "./settings";

/** What a leg actually requires happening in its fight, stripped of which
 *  table it was clicked from. Two cells anywhere on the page — the Method
 *  grid, Goes the distance, Over/Under, By round — reduce to the same shape
 *  here, which is what lets one fight's picks be checked against each other
 *  for logical impossibility instead of just against themselves. */
export type Outcome = {
  fightId: string;
  /** The fighter required to win, when the leg needs a specific winner. */
  winner?: 1 | 2;
  /** true: the fight must reach the scorecards. false: it must end in a finish. */
  decision?: boolean;
  /** Required finish method — only meaningful when decision is false. */
  method?: "KO/TKO" | "SUB";
  /** Required round of the finish — only meaningful when decision is false. */
  round?: number;
  /** A total-rounds line, e.g. over/under 2.5 rounds. */
  totalRounds?: { side: "over" | "under"; line: number };
};

/** A stable key for an outcome. Clicking "Fight goes to decision" in the
 *  Method table and "Yes" in Goes the distance describe the same real bet, so
 *  both must collapse to the same id — one toggles the other, instead of
 *  letting the same leg sit in the slip twice. */
export function outcomeId(outcome: Outcome): string {
  return [
    outcome.fightId,
    outcome.winner ?? "-",
    outcome.decision === undefined ? "-" : outcome.decision ? "dec" : "fin",
    outcome.method ?? "-",
    outcome.round ?? "-",
    outcome.totalRounds ? `${outcome.totalRounds.side}:${outcome.totalRounds.line}` : "-",
  ].join("|");
}

/** Whether two legs of the same fight can't both come true — e.g. two
 *  different finish methods, or a round-1 finish alongside "over 2.5 rounds".
 *  Legs from different fights never conflict; stacking picks across fights is
 *  the entire point of a parlay. This only blocks outcomes that are
 *  impossible together, not merely correlated ones (two picks that both
 *  happen to come true whenever the same thing happens are left alone). */
export function outcomesConflict(a: Outcome, b: Outcome): boolean {
  if (a.fightId !== b.fightId) return false;
  if (a.winner && b.winner && a.winner !== b.winner) return true;
  if (a.decision !== undefined && b.decision !== undefined && a.decision !== b.decision) return true;
  if (a.method && b.method && a.method !== b.method) return true;
  if (a.round != null && b.round != null && a.round !== b.round) return true;
  // A decision always runs past any total-rounds line these books offer, so it
  // always clears "over" and always fails "under".
  if (a.decision === true && b.totalRounds?.side === "under") return true;
  if (b.decision === true && a.totalRounds?.side === "under") return true;
  if (a.totalRounds && b.round != null) {
    if (a.totalRounds.side === "over" && b.round <= a.totalRounds.line) return true;
    if (a.totalRounds.side === "under" && b.round > a.totalRounds.line) return true;
  }
  if (b.totalRounds && a.round != null) {
    if (b.totalRounds.side === "over" && a.round <= b.totalRounds.line) return true;
    if (b.totalRounds.side === "under" && a.round > b.totalRounds.line) return true;
  }
  if (a.totalRounds && b.totalRounds && a.totalRounds.side !== b.totalRounds.side) {
    const over = a.totalRounds.side === "over" ? a.totalRounds : b.totalRounds;
    const under = a.totalRounds.side === "under" ? a.totalRounds : b.totalRounds;
    if (over.line >= under.line) return true;
  }
  return false;
}

export type ParlayLeg = {
  id: string;
  fightId: string;
  fightLabel: string;
  market: string;
  selection: string;
  price: string;
  outcome: Outcome;
};

type ParlayState = { legs: ParlayLeg[]; stake: number; open: boolean; conflict: string | null; placed: boolean };

/** A bet saved to a profile can never stake more than this. */
export const MAX_STAKE = 20;
export const MIN_STAKE = 1;

const STORAGE_KEY = "ufcsh:parlay:v1";

function loadSaved(): { legs: ParlayLeg[]; stake: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return {
      legs: Array.isArray(saved?.legs) ? saved.legs : [],
      stake: typeof saved?.stake === "number" && saved.stake >= 0 ? Math.min(saved.stake, MAX_STAKE) : 10,
    };
  } catch {
    return { legs: [], stake: 10 };
  }
}

const ParlayContext = createContext<{
  legs: ParlayLeg[];
  stake: number;
  open: boolean;
  conflict: string | null;
  placed: boolean;
  isSelected: (id: string) => boolean;
  toggle: (leg: ParlayLeg) => void;
  remove: (id: string) => void;
  clear: () => void;
  setOpen: (open: boolean) => void;
  setStake: (stake: number) => void;
  dismissConflict: () => void;
  reprice: (changes: { key: string; price: string }[]) => void;
  markPlaced: (placed: boolean) => void;
}>({
  legs: [],
  stake: 10,
  open: false,
  conflict: null,
  placed: false,
  isSelected: () => false,
  toggle: () => undefined,
  remove: () => undefined,
  clear: () => undefined,
  setOpen: () => undefined,
  setStake: () => undefined,
  dismissConflict: () => undefined,
  reprice: () => undefined,
  markPlaced: () => undefined,
});

export function ParlayProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ParlayState>(() => ({ ...loadSaved(), open: false, conflict: null, placed: false }));

  // Survives navigation for free (this provider sits above the router), and a
  // reload too, so a pending slip is never lost to an accidental refresh.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ legs: state.legs, stake: state.stake }));
    } catch {
      // The slip still works for this visit when storage is unavailable.
    }
  }, [state.legs, state.stake]);

  const value = useMemo(() => ({
    legs: state.legs,
    stake: state.stake,
    open: state.open,
    conflict: state.conflict,
    placed: state.placed,
    isSelected: (id: string) => state.legs.some((leg) => leg.id === id),
    toggle: (leg: ParlayLeg) => setState((current) => {
      if (current.legs.some((existing) => existing.id === leg.id)) {
        return { ...current, legs: current.legs.filter((existing) => existing.id !== leg.id), conflict: null };
      }
      const clash = current.legs.find((existing) => outcomesConflict(existing.outcome, leg.outcome));
      if (clash) {
        return { ...current, conflict: `"${leg.selection}" can't join the slip — it and "${clash.selection}" can't both happen in ${leg.fightLabel}.` };
      }
      return { ...current, legs: [...current.legs, leg], open: true, conflict: null, placed: false };
    }),
    remove: (id: string) => setState((current) => ({ ...current, legs: current.legs.filter((leg) => leg.id !== id) })),
    clear: () => setState((current) => ({ ...current, legs: [], conflict: null })),
    setOpen: (open: boolean) => setState((current) => ({ ...current, open })),
    setStake: (stake: number) => setState((current) => ({ ...current, stake: Number.isFinite(stake) && stake >= 0 ? Math.min(stake, MAX_STAKE) : current.stake })),
    dismissConflict: () => setState((current) => ({ ...current, conflict: null })),
    // The server prices every bet itself; a moved line is shown before the bet is placed.
    reprice: (changes: { key: string; price: string }[]) => setState((current) => ({
      ...current,
      legs: current.legs.map((leg) => ({ ...leg, price: changes.find((change) => change.key === leg.id)?.price ?? leg.price })),
    })),
    markPlaced: (placed: boolean) => setState((current) => ({ ...current, placed, ...(placed ? { legs: [], conflict: null } : {}) })),
  }), [state]);

  return <ParlayContext.Provider value={value}>{children}</ParlayContext.Provider>;
}

export function useParlay() {
  return useContext(ParlayContext);
}

/** Combined decimal price of every leg, then what a stake turns into. Legs
 *  are treated as independent, which is exactly true across fights and close
 *  enough within one once outright-impossible combinations are already
 *  blocked from sitting together. */
export function parlayPayout(legs: ParlayLeg[], stake: number) {
  const combinedDecimal = legs.reduce((product, leg) => product * decimalOdds(leg.price), 1);
  const payout = stake * combinedDecimal;
  return { combinedDecimal, combinedAmerican: americanFromDecimal(combinedDecimal), payout, profit: payout - stake };
}

/** The parlay's combined price in whichever format the odds toggle is set
 *  to — same three formats a single price can show, derived from the
 *  combined decimal multiple rather than round-tripping through American. */
export function formatCombinedPrice(combinedDecimal: number, format: OddsFormat): string {
  if (format === "decimal") return combinedDecimal > 1 ? combinedDecimal.toFixed(2) : "—";
  return americanFromDecimal(combinedDecimal);
}
