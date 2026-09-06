// Imported with its extension so this module also runs under `node --test`,
// which resolves nothing for itself. The type import above is erased.
import type { CardStats } from "./api";
import { lastName } from "./format.ts";

/**
 * What a card is worth saying out loud.
 *
 * Every card can be described a couple of dozen ways, and most of those ways
 * are dull on most cards: "13 bouts announced" is true of nearly every card,
 * and "3 submissions" is only interesting on the night it happens. So each way
 * of describing a card is written once, as a candidate with the number it
 * would show and an `interest` score saying how remarkable that number is for
 * this card in particular. The header then shows the best five.
 *
 * That is what makes two cards read differently: a night of first-round
 * knockouts leads with the finishes, a night of split decisions leads with the
 * judges, and a card carrying two belts leads with the belts. The score is
 * about the *number*, never about the statistic — "0 underdog wins" scores low
 * for the same reason "5 of 6 underdogs got there" scores high.
 */

/** Icon names, resolved to components by the header that draws them. */
export type HighlightIcon =
  | "swords" | "flame" | "trophy" | "timer" | "trendingUp" | "zap" | "users"
  | "crown" | "target" | "clock" | "gauge" | "award" | "sparkles" | "globe"
  | "hourglass" | "ruler" | "repeat" | "medal" | "shieldCheck" | "handFist"
  | "calendarClock" | "activity" | "scale" | "rocket" | "star" | "history"
  | "split" | "percent" | "coins";

/** Which side of a card a candidate speaks to. At most two from any one of
 *  these reach the header, so five tiles never all say the same thing. */
type Group = "market" | "finish" | "time" | "action" | "stakes" | "form" | "people" | "meta";

export type Highlight = {
  key: string;
  label: string;
  value: string;
  note: string;
  icon: HighlightIcon;
  tone: "gold" | "fire" | "cool" | "green" | "plain";
  group: Group;
  /** 0–100: how remarkable this number is on this card. */
  interest: number;
  to?: string;
};

type Candidate = Omit<Highlight, "interest"> & { interest: number };

const clamp = (value: number, low = 0, high = 100) => Math.max(low, Math.min(high, value));

/** "4:32" — a fight clock, which is how every duration on a card is read. */
export function clockOf(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** "1h 24m" — for totals long enough that a fight clock stops being readable. */
function spanOf(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m` : `${minutes}m`;
}

export function signedLine(line: number): string {
  return `${line > 0 ? "+" : ""}${line}`;
}

const plural = (count: number, one: string, many = `${one}s`) => (count === 1 ? one : many);

// ---------------------------------------------------------------------------
// The pool

/** Everything that can be said about a card that has been fought. */
function pastCandidates(stats: CardStats): Candidate[] {
  const pool: Candidate[] = [];
  const fights = stats.completed_fights;
  const finishRate = fights > 0 ? stats.finishes / fights : 0;

  // A card is read from the price board one way or the other, never both: how
  // often the underdog got there, or — when none of them did, on a board long
  // enough for that to be a story — that the favorites swept it.
  if (stats.priced_fights > 0) {
    const share = stats.underdog_wins / stats.priced_fights;
    if (stats.underdog_wins === 0 && stats.priced_fights >= 5) {
      pool.push({
        key: "chalk",
        label: "Favorites held",
        value: `${stats.priced_fights}/${stats.priced_fights}`,
        note: "every favorite delivered",
        icon: "coins",
        tone: "plain",
        group: "market",
        interest: 78,
      });
    } else {
      pool.push({
        key: "underdogs",
        label: "Underdog wins",
        value: `${stats.underdog_wins}/${stats.priced_fights}`,
        note: stats.underdog_wins === 0 ? "the board held all night" : `${Math.round(share * 100)}% of priced bouts`,
        icon: "trendingUp",
        tone: stats.underdog_wins > 0 ? "cool" : "plain",
        group: "market",
        interest: stats.underdog_wins === 0 ? 24 : clamp(48 + share * 52),
      });
    }
  }

  if (fights > 0) {
    pool.push({
      key: "finishes",
      label: "Finishes",
      value: `${stats.finishes}/${fights}`,
      note: stats.finishes === 0 ? "every bout heard the horn" : `${stats.knockouts} KO/TKO · ${stats.submissions} SUB`,
      icon: "flame",
      tone: finishRate >= 0.5 ? "fire" : "plain",
      group: "finish",
      interest: clamp(40 + finishRate * 55),
    });
  }
  if (stats.knockouts > 0) {
    pool.push({
      key: "knockouts",
      label: "Knockouts",
      value: String(stats.knockouts),
      note: `${plural(stats.knockouts, "bout")} ended on the feet`,
      icon: "zap",
      tone: "fire",
      group: "finish",
      interest: clamp(26 + stats.knockouts * 7),
    });
  }
  if (stats.submissions > 0) {
    pool.push({
      key: "submissions",
      label: "Submissions",
      value: String(stats.submissions),
      // Submissions are the rarer of the two finishes, so each one says more.
      note: `${plural(stats.submissions, "tap")} on the card`,
      icon: "handFist",
      tone: "cool",
      group: "finish",
      interest: clamp(30 + stats.submissions * 10),
    });
  }
  if (stats.first_round_finishes > 0) {
    pool.push({
      key: "early",
      label: "Ended in round 1",
      value: String(stats.first_round_finishes),
      note: `${plural(stats.first_round_finishes, "bout")} never saw round 2`,
      icon: "rocket",
      tone: "fire",
      group: "finish",
      interest: clamp(40 + stats.first_round_finishes * 8),
    });
  }
  if (stats.fastest_finish) {
    const { seconds, name, method, fight_id } = stats.fastest_finish;
    pool.push({
      key: "fastest",
      label: "Fastest finish",
      value: clockOf(seconds),
      note: `${name} · ${method}`,
      icon: "timer",
      tone: "fire",
      group: "finish",
      // A minute is a highlight; five minutes is just how fights end.
      interest: clamp(96 - seconds / 9, 30, 96),
      to: `/fights/${fight_id}`,
    });
  }
  if (stats.avg_seconds != null) {
    pool.push({
      key: "time",
      label: "Average bout",
      value: clockOf(stats.avg_seconds),
      note: `${stats.decisions} went to the judges`,
      icon: "clock",
      tone: "plain",
      group: "time",
      // Notable when a card blew through, unremarkable when it ran long.
      interest: clamp(84 - stats.avg_seconds / 13, 18, 84),
    });
  }
  if (stats.total_seconds > 0) {
    pool.push({
      key: "cage",
      label: "Total cage time",
      value: spanOf(stats.total_seconds),
      note: `across ${fights} completed ${plural(fights, "bout")}`,
      icon: "hourglass",
      tone: "plain",
      group: "time",
      interest: 20,
    });
  }
  if (stats.longest_bout && stats.longest_bout.seconds > 15 * 60) {
    pool.push({
      key: "longest",
      label: "Longest bout",
      value: clockOf(stats.longest_bout.seconds),
      note: `${lastName(stats.longest_bout.f1)} vs ${lastName(stats.longest_bout.f2)}`,
      icon: "hourglass",
      tone: "plain",
      group: "time",
      interest: 46,
      to: `/fights/${stats.longest_bout.fight_id}`,
    });
  }
  if (stats.biggest_upset) {
    pool.push({
      key: "upset",
      label: "Biggest upset",
      value: signedLine(stats.biggest_upset.line),
      note: stats.biggest_upset.name,
      icon: "target",
      tone: "cool",
      group: "market",
      interest: clamp(56 + stats.biggest_upset.line / 16, 56, 96),
      to: `/fights/${stats.biggest_upset.fight_id}`,
    });
  }
  if (stats.bonuses > 0) {
    pool.push({
      key: "bonuses",
      label: "Bonuses paid",
      value: String(stats.bonuses),
      note: "performances the promotion paid for",
      icon: "award",
      tone: "gold",
      group: "meta",
      interest: clamp(44 + stats.bonuses * 7),
    });
  }
  if (stats.knockdowns > 0) {
    pool.push({
      key: "knockdowns",
      label: "Knockdowns",
      value: String(stats.knockdowns),
      note: `${plural(stats.knockdowns, "time")} the canvas came up`,
      icon: "zap",
      tone: "fire",
      group: "action",
      interest: clamp(28 + stats.knockdowns * 5.5),
    });
  }
  if (stats.most_knockdowns && stats.most_knockdowns.count >= 2) {
    pool.push({
      key: "mostKnockdowns",
      label: "Most knockdowns",
      value: String(stats.most_knockdowns.count),
      note: `${stats.most_knockdowns.name}, in one bout`,
      icon: "zap",
      tone: "fire",
      group: "action",
      interest: clamp(48 + stats.most_knockdowns.count * 10),
      to: `/fights/${stats.most_knockdowns.fight_id}`,
    });
  }
  if (stats.most_strikes && stats.most_strikes.count > 0) {
    pool.push({
      key: "mostStrikes",
      label: "Most strikes landed",
      value: String(stats.most_strikes.count),
      note: `${stats.most_strikes.name}, significant strikes`,
      icon: "activity",
      tone: "plain",
      group: "action",
      interest: clamp(20 + (stats.most_strikes.count - 70) / 2.2, 20, 88),
      to: `/fights/${stats.most_strikes.fight_id}`,
    });
  }
  if (stats.takedowns > 0) {
    pool.push({
      key: "takedowns",
      label: "Takedowns landed",
      value: String(stats.takedowns),
      note: "across the card",
      icon: "scale",
      tone: "plain",
      group: "action",
      interest: clamp(18 + stats.takedowns * 1.4, 18, 68),
    });
  }
  if (stats.submission_attempts > 0) {
    pool.push({
      key: "subAttempts",
      label: "Submission attempts",
      value: String(stats.submission_attempts),
      note: `${stats.submissions} of them finished it`,
      icon: "handFist",
      tone: "plain",
      group: "action",
      interest: clamp(18 + stats.submission_attempts * 2.2, 18, 68),
    });
  }
  if (stats.split_decisions > 0) {
    pool.push({
      key: "splits",
      label: "Split verdicts",
      value: String(stats.split_decisions),
      note: `${plural(stats.split_decisions, "card")} the judges disagreed on`,
      icon: "split",
      tone: "cool",
      group: "meta",
      interest: clamp(44 + stats.split_decisions * 13),
    });
  }
  if (stats.decisions > 0) {
    pool.push({
      key: "decisions",
      label: "Went to the judges",
      value: `${stats.decisions}/${fights}`,
      note: stats.split_decisions > 0 ? `${stats.split_decisions} of them split` : "all unanimous",
      icon: "gauge",
      tone: "plain",
      group: "meta",
      interest: clamp(16 + (fights > 0 ? (stats.decisions / fights) * 30 : 0)),
    });
  }
  if (stats.debut_wins > 0) {
    pool.push({
      key: "debutWins",
      label: "Debut wins",
      value: String(stats.debut_wins),
      note: `${plural(stats.debut_wins, "fighter")} arrived with a win`,
      icon: "sparkles",
      tone: "green",
      group: "people",
      interest: clamp(34 + stats.debut_wins * 8),
    });
  }
  if (stats.title_fights > 0) {
    pool.push({
      key: "titles",
      label: "Championship bouts",
      value: String(stats.title_fights),
      note: `${plural(stats.title_fights, "belt")} on the line`,
      icon: "crown",
      tone: "gold",
      group: "stakes",
      interest: clamp(70 + stats.title_fights * 12),
    });
  }
  return pool;
}

/** Everything that can be said about a card that has not been fought yet. */
function announcedCandidates(stats: CardStats): Candidate[] {
  const pool: Candidate[] = [];

  pool.push({
    key: "card",
    label: "Bouts announced",
    value: String(stats.total_fights),
    note: stats.title_fights ? `${stats.title_fights} for a belt` : `${stats.divisions || 1} ${plural(stats.divisions || 1, "division")}`,
    icon: "swords",
    tone: "plain",
    group: "meta",
    // Every card has a size, so this only leads when nothing else is known.
    interest: 26,
  });

  if (stats.title_fights > 0) {
    pool.push({
      key: "titles",
      label: "Championship bouts",
      value: String(stats.title_fights),
      note: `${plural(stats.title_fights, "belt")} on the line`,
      icon: "crown",
      tone: "gold",
      group: "stakes",
      interest: clamp(80 + stats.title_fights * 10),
    });
  }
  if (stats.champions > 0) {
    pool.push({
      key: "champions",
      label: "Champions competing",
      value: String(stats.champions),
      note: `reigning ${plural(stats.champions, "champion")} on the card`,
      icon: "crown",
      tone: "gold",
      group: "stakes",
      interest: clamp(76 + stats.champions * 8),
    });
  }
  if (stats.former_champions > 0) {
    pool.push({
      key: "formerChampions",
      label: "Former champions",
      value: String(stats.former_champions),
      note: `${plural(stats.former_champions, "fighter")} who has held a belt`,
      icon: "medal",
      tone: "gold",
      group: "stakes",
      interest: clamp(50 + stats.former_champions * 9),
    });
  }
  if (stats.ranked_fighters > 0) {
    pool.push({
      key: "ranked",
      label: "Ranked fighters",
      value: String(stats.ranked_fighters),
      note: "inside the top 15",
      icon: "trophy",
      tone: "gold",
      group: "stakes",
      interest: clamp(36 + stats.ranked_fighters * 4.5),
    });
  }
  if (stats.undefeated_fighters > 0) {
    const ranked = stats.undefeated_ranked_fighters;
    pool.push({
      key: "undefeated",
      label: ranked > 0 ? "Undefeated ranked" : "Undefeated fighters",
      value: String(ranked > 0 ? ranked : stats.undefeated_fighters),
      note: ranked > 0
        ? `of ${stats.undefeated_fighters} unbeaten on the card`
        : "no verified professional losses",
      icon: "shieldCheck",
      tone: "green",
      group: "form",
      interest: clamp((ranked > 0 ? 66 : 46) + stats.undefeated_fighters * 8),
    });
  }
  if (stats.longest_streak) {
    pool.push({
      key: "streak",
      label: "Longest run",
      value: `${stats.longest_streak.count}W`,
      note: stats.longest_streak.name,
      icon: "flame",
      tone: "fire",
      group: "form",
      interest: clamp(38 + stats.longest_streak.count * 7),
      to: `/fights/${stats.longest_streak.fight_id}`,
    });
  }
  if (stats.most_finishes && stats.most_finishes.count >= 5) {
    pool.push({
      key: "mostFinishes",
      label: "Most UFC finishes",
      value: String(stats.most_finishes.count),
      note: stats.most_finishes.name,
      icon: "zap",
      tone: "fire",
      group: "form",
      interest: clamp(38 + stats.most_finishes.count * 4),
      to: `/fights/${stats.most_finishes.fight_id}`,
    });
  }
  if (stats.career_finish_rate != null) {
    pool.push({
      key: "finishRate",
      label: "Wins by finish",
      value: `${stats.career_finish_rate}%`,
      note: "of this card's UFC wins so far",
      icon: "percent",
      tone: stats.career_finish_rate >= 60 ? "fire" : "plain",
      group: "form",
      interest: clamp(24 + (stats.career_finish_rate - 45) * 1.7, 20, 90),
    });
  }
  if (stats.closest_matchup) {
    const { gap, f1, f2, fight_id } = stats.closest_matchup;
    pool.push({
      key: "closest",
      label: "Closest matchup",
      value: `${gap}%`,
      note: `${lastName(f1)} vs ${lastName(f2)} · price gap`,
      icon: "scale",
      tone: "cool",
      group: "market",
      // A true pick'em is the most interesting thing a price board can say.
      interest: clamp(92 - gap * 2.2, 15, 92),
      to: `/fights/${fight_id}`,
    });
  }
  if (stats.longest_underdog) {
    pool.push({
      key: "underdog",
      label: "Longest price",
      value: signedLine(stats.longest_underdog.line),
      note: stats.longest_underdog.name,
      icon: "target",
      tone: "cool",
      group: "market",
      interest: clamp(40 + stats.longest_underdog.line / 16, 40, 92),
      to: `/fights/${stats.longest_underdog.fight_id}`,
    });
  }
  if (stats.biggest_favorite) {
    pool.push({
      key: "favorite",
      label: "Biggest favorite",
      value: signedLine(stats.biggest_favorite.line),
      note: stats.biggest_favorite.name,
      icon: "coins",
      tone: "plain",
      group: "market",
      interest: clamp(30 + Math.abs(stats.biggest_favorite.line) / 30, 30, 88),
      to: `/fights/${stats.biggest_favorite.fight_id}`,
    });
  }
  if (stats.debutants > 0) {
    pool.push({
      key: "debut",
      label: "UFC debuts",
      value: String(stats.debutants),
      note: "first time in the promotion",
      icon: "sparkles",
      tone: "green",
      group: "people",
      interest: clamp(34 + stats.debutants * 8),
    });
  }
  if (stats.most_experienced && stats.most_experienced.bouts >= 10) {
    pool.push({
      key: "experience",
      label: "Most UFC bouts",
      value: String(stats.most_experienced.bouts),
      note: stats.most_experienced.name,
      icon: "history",
      tone: "plain",
      group: "people",
      interest: clamp(28 + stats.most_experienced.bouts * 2),
      to: `/fights/${stats.most_experienced.fight_id}`,
    });
  }
  if (stats.youngest && stats.youngest.age <= 25) {
    pool.push({
      key: "youngest",
      label: "Youngest on the card",
      value: `${stats.youngest.age}`,
      note: stats.youngest.name,
      icon: "rocket",
      tone: "green",
      group: "people",
      interest: clamp(92 - (stats.youngest.age - 20) * 11, 25, 92),
      to: `/fights/${stats.youngest.fight_id}`,
    });
  }
  if (stats.oldest && stats.oldest.age >= 36) {
    pool.push({
      key: "oldest",
      label: "Oldest on the card",
      value: `${stats.oldest.age}`,
      note: stats.oldest.name,
      icon: "history",
      tone: "plain",
      group: "people",
      interest: clamp(30 + (stats.oldest.age - 35) * 10, 30, 88),
      to: `/fights/${stats.oldest.fight_id}`,
    });
  }
  if (stats.longest_layoff) {
    const { days, name, fight_id } = stats.longest_layoff;
    pool.push({
      key: "layoff",
      label: "Longest layoff",
      value: days >= 730 ? `${Math.round(days / 365.25 * 10) / 10}y` : `${Math.round(days / 30.4)}mo`,
      note: `${name} · since their last bout`,
      icon: "calendarClock",
      tone: "cool",
      group: "people",
      interest: clamp(34 + (days - 365) / 22, 34, 88),
      to: `/fights/${fight_id}`,
    });
  }
  if (stats.biggest_reach_gap) {
    pool.push({
      key: "reach",
      label: "Longest reach edge",
      value: `+${stats.biggest_reach_gap.inches}"`,
      note: stats.biggest_reach_gap.name,
      icon: "ruler",
      tone: "plain",
      group: "people",
      interest: clamp(24 + stats.biggest_reach_gap.inches * 5.5, 24, 82),
      to: `/fights/${stats.biggest_reach_gap.fight_id}`,
    });
  }
  if (stats.rematches > 0) {
    pool.push({
      key: "rematches",
      label: "Rematches",
      value: String(stats.rematches),
      note: `${plural(stats.rematches, "pair")} who have met before`,
      icon: "repeat",
      tone: "cool",
      group: "meta",
      interest: clamp(62 + stats.rematches * 10),
    });
  }
  if (stats.five_round_bouts > 1) {
    pool.push({
      key: "fiveRound",
      label: "Five-round bouts",
      value: String(stats.five_round_bouts),
      note: "scheduled for 25 minutes",
      icon: "timer",
      tone: "plain",
      group: "meta",
      interest: clamp(30 + stats.five_round_bouts * 9),
    });
  }
  if (stats.countries >= 6) {
    pool.push({
      key: "countries",
      label: "Countries represented",
      value: String(stats.countries),
      note: "flags in the building",
      icon: "globe",
      tone: "plain",
      group: "meta",
      interest: clamp(18 + stats.countries * 3.2, 18, 72),
    });
  }
  if (stats.combined_record) {
    const { wins, losses } = stats.combined_record;
    pool.push({
      key: "combined",
      label: "Combined record",
      value: `${wins}-${losses}`,
      note: "professional bouts behind this card",
      icon: "users",
      tone: "plain",
      group: "meta",
      interest: 24,
    });
  }
  if (stats.avg_age != null) {
    pool.push({
      key: "avgAge",
      label: "Average age",
      value: `${stats.avg_age}`,
      note: "across everyone announced",
      icon: "users",
      tone: "plain",
      group: "meta",
      interest: 16,
    });
  }
  return pool;
}

/** How many tiles the header shows, and how many any one theme may fill. */
export const HIGHLIGHT_COUNT = 5;
const MAX_PER_GROUP = 2;

/**
 * The five lines worth reading about this card, most interesting first.
 *
 * Interest alone would let one theme take the whole row — a card with five
 * finishes has five ways of saying so — so no more than two tiles come from
 * the same theme, and a card that genuinely has nothing else to say simply
 * shows fewer than five.
 */
export function cardHighlights(stats: CardStats, past: boolean): Highlight[] {
  const pool = past ? pastCandidates(stats) : announcedCandidates(stats);
  const ranked = [...pool].sort((a, b) => b.interest - a.interest || a.key.localeCompare(b.key));
  const used = new Map<Group, number>();
  const chosen: Highlight[] = [];
  for (const candidate of ranked) {
    if (chosen.length === HIGHLIGHT_COUNT) break;
    const taken = used.get(candidate.group) ?? 0;
    if (taken >= MAX_PER_GROUP) continue;
    used.set(candidate.group, taken + 1);
    chosen.push(candidate);
  }
  return chosen;
}
