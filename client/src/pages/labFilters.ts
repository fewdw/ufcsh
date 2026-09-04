/**
 * A Lab population is a set of filters over fighter-bout observations. Both
 * the filter panel and the query string are generated from one declarative
 * schema, so a new filter is added in exactly one place and can never drift
 * between the two.
 */

export type LabFilters = {
  from: string;
  to: string;
  division: string[];
  gender: "all" | "men" | "women";
  title: "any" | "only" | "none";
  rounds: "all" | "3" | "5";
  mainEvent: "any" | "only" | "none";
  method: "any" | "ko" | "sub" | "finish" | "decision";
  ageMin: string;
  ageMax: string;
  oppAgeMin: string;
  oppAgeMax: string;
  ageGap: "any" | "younger" | "older" | "same";
  ageGapMin: string;
  winStreakMin: string;
  winStreakMax: string;
  lossStreakMin: string;
  lossStreakMax: string;
  prev: "any" | "win" | "loss" | "koLoss" | "subLoss" | "finishLoss" | "decisionLoss" | "finishWin" | "debut" | "drawOrNc";
  layoffMin: string;
  layoffMax: string;
  expMin: string;
  expMax: string;
  oppExpMin: string;
  oppExpMax: string;
  status: "any" | "champion" | "formerChampion" | "everChampion" | "neverChampion";
  oppStatus: "any" | "champion" | "formerChampion" | "everChampion" | "neverChampion";
  stance: "any" | "Orthodox" | "Southpaw" | "Switch";
  oppStance: "any" | "Orthodox" | "Southpaw" | "Switch";
  heightAdv: "any" | "taller" | "shorter" | "same";
  reachAdv: "any" | "longer" | "shorter" | "same";
  reachGapMin: string;
  odds: "any" | "priced" | "underdog" | "favorite" | "pickem";
  lineMin: string;
  lineMax: string;
  probMin: string;
  probMax: string;
  fighterIds: string[];
  opponentIds: string[];
};

export const EMPTY_FILTERS: LabFilters = {
  from: "", to: "", division: [], gender: "all", title: "any", rounds: "all", mainEvent: "any", method: "any",
  ageMin: "", ageMax: "", oppAgeMin: "", oppAgeMax: "", ageGap: "any", ageGapMin: "",
  winStreakMin: "", winStreakMax: "", lossStreakMin: "", lossStreakMax: "", prev: "any",
  layoffMin: "", layoffMax: "", expMin: "", expMax: "", oppExpMin: "", oppExpMax: "",
  status: "any", oppStatus: "any", stance: "any", oppStance: "any",
  heightAdv: "any", reachAdv: "any", reachGapMin: "",
  odds: "any", lineMin: "", lineMax: "", probMin: "", probMax: "",
  fighterIds: [], opponentIds: [],
};

export type SelectOption = { value: string; label: string };

export type FilterField =
  | { kind: "select"; key: keyof LabFilters; label: string; options: SelectOption[]; hint?: string }
  | { kind: "range"; minKey: keyof LabFilters; maxKey: keyof LabFilters; label: string; unit?: string; hint?: string; placeholderMin?: string; placeholderMax?: string }
  | { kind: "number"; key: keyof LabFilters; label: string; unit?: string; hint?: string }
  | { kind: "divisions"; key: "division"; label: string };

export type FilterSection = { id: string; title: string; blurb: string; fields: FilterField[] };

const ANY = { value: "any", label: "Any" };

export const FILTER_SECTIONS: FilterSection[] = [
  {
    id: "scope",
    title: "Bout",
    blurb: "Which fights are in play at all.",
    fields: [
      { kind: "range", minKey: "from", maxKey: "to", label: "Years", placeholderMin: "First", placeholderMax: "Last" },
      { kind: "divisions", key: "division", label: "Divisions" },
      { kind: "select", key: "gender", label: "Roster", options: [{ value: "all", label: "Everyone" }, { value: "men", label: "Men's divisions" }, { value: "women", label: "Women's divisions" }] },
      { kind: "select", key: "title", label: "Championship", options: [ANY, { value: "only", label: "Title bouts only" }, { value: "none", label: "Exclude title bouts" }] },
      { kind: "select", key: "rounds", label: "Scheduled length", options: [{ value: "all", label: "Any" }, { value: "3", label: "3-round bouts" }, { value: "5", label: "5-round bouts" }] },
      { kind: "select", key: "mainEvent", label: "Card position", options: [ANY, { value: "only", label: "Main events only" }, { value: "none", label: "Undercard only" }] },
      { kind: "select", key: "method", label: "How it ended", hint: "Filters on the result, so use it to study one kind of ending.", options: [ANY, { value: "ko", label: "KO/TKO" }, { value: "sub", label: "Submission" }, { value: "finish", label: "Any finish" }, { value: "decision", label: "Decision" }] },
    ],
  },
  {
    id: "fighter",
    title: "Fighter entering",
    blurb: "What was true of this fighter walking in — never what happened after.",
    fields: [
      { kind: "range", minKey: "ageMin", maxKey: "ageMax", label: "Age", unit: "years", hint: "Age on fight night. Only bouts with a known birth date qualify." },
      { kind: "range", minKey: "winStreakMin", maxKey: "winStreakMax", label: "UFC win streak", unit: "fights" },
      { kind: "range", minKey: "lossStreakMin", maxKey: "lossStreakMax", label: "UFC losing streak", unit: "fights" },
      { kind: "select", key: "prev", label: "Previous result", options: [ANY, { value: "debut", label: "UFC debut" }, { value: "win", label: "After a win" }, { value: "finishWin", label: "After a finish win" }, { value: "loss", label: "After a loss" }, { value: "koLoss", label: "After a KO/TKO loss" }, { value: "subLoss", label: "After a submission loss" }, { value: "finishLoss", label: "After any finish loss" }, { value: "decisionLoss", label: "After a decision loss" }, { value: "drawOrNc", label: "After a draw or NC" }] },
      { kind: "range", minKey: "layoffMin", maxKey: "layoffMax", label: "Days since last bout", unit: "days", hint: "Debuts have no previous bout and are excluded once this is set." },
      { kind: "range", minKey: "expMin", maxKey: "expMax", label: "UFC bouts already had", unit: "bouts" },
      { kind: "select", key: "status", label: "Belt status", options: [ANY, { value: "champion", label: "Reigning champion" }, { value: "formerChampion", label: "Former champion" }, { value: "everChampion", label: "Has held a belt" }, { value: "neverChampion", label: "Never held a belt" }] },
      { kind: "select", key: "stance", label: "Stance", options: [ANY, { value: "Orthodox", label: "Orthodox" }, { value: "Southpaw", label: "Southpaw" }, { value: "Switch", label: "Switch" }] },
    ],
  },
  {
    id: "opponent",
    title: "Opponent & matchup",
    blurb: "The other side of the cage, and the physical gap between them.",
    fields: [
      { kind: "range", minKey: "oppAgeMin", maxKey: "oppAgeMax", label: "Opponent age", unit: "years" },
      { kind: "range", minKey: "oppExpMin", maxKey: "oppExpMax", label: "Opponent UFC bouts", unit: "bouts" },
      { kind: "select", key: "oppStatus", label: "Opponent belt status", options: [ANY, { value: "champion", label: "Reigning champion" }, { value: "formerChampion", label: "Former champion" }, { value: "everChampion", label: "Has held a belt" }, { value: "neverChampion", label: "Never held a belt" }] },
      { kind: "select", key: "oppStance", label: "Opponent stance", options: [ANY, { value: "Orthodox", label: "Orthodox" }, { value: "Southpaw", label: "Southpaw" }, { value: "Switch", label: "Switch" }] },
      { kind: "select", key: "ageGap", label: "Age edge", hint: "Whether this fighter was the younger one.", options: [ANY, { value: "younger", label: "Younger than opponent" }, { value: "older", label: "Older than opponent" }, { value: "same", label: "Same age" }] },
      { kind: "number", key: "ageGapMin", label: "Minimum age gap", unit: "years" },
      { kind: "select", key: "reachAdv", label: "Reach edge", options: [ANY, { value: "longer", label: "Longer reach" }, { value: "shorter", label: "Shorter reach" }, { value: "same", label: "Equal reach" }] },
      { kind: "number", key: "reachGapMin", label: "Minimum reach gap", unit: "inches" },
      { kind: "select", key: "heightAdv", label: "Height edge", options: [ANY, { value: "taller", label: "Taller" }, { value: "shorter", label: "Shorter" }, { value: "same", label: "Same height" }] },
    ],
  },
  {
    id: "market",
    title: "Betting market",
    blurb: "Closing lines from bestfightodds.com. Bouts without a price drop out once any of these is set.",
    fields: [
      { kind: "select", key: "odds", label: "Market role", options: [ANY, { value: "priced", label: "Any priced bout" }, { value: "underdog", label: "Closing underdog" }, { value: "favorite", label: "Closing favorite" }, { value: "pickem", label: "Pick'em (within 3%)" }] },
      { kind: "range", minKey: "lineMin", maxKey: "lineMax", label: "Closing line", hint: "American odds, e.g. −250 to +150. Type a minus sign for favorites.", placeholderMin: "−2000", placeholderMax: "+2000" },
      { kind: "range", minKey: "probMin", maxKey: "probMax", label: "Implied win probability", unit: "%" },
    ],
  },
];

// ---------------------------------------------------------------------------

export function toQuery(filters: LabFilters, groupBy: string): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.join(","));
    } else if (value !== "" && value !== "any" && value !== "all") {
      params.set(key, String(value));
    }
  }
  if (groupBy !== "none") params.set("groupBy", groupBy);
  return params.toString();
}

export function activeCount(filters: LabFilters): number {
  return Object.entries(filters).filter(([, value]) => (Array.isArray(value) ? value.length > 0 : value !== "" && value !== "any" && value !== "all")).length;
}

const LABELS: Partial<Record<keyof LabFilters, string>> = {
  gender: "Roster", title: "Championship", rounds: "Length", mainEvent: "Card", method: "Ending",
  ageGap: "Age edge", prev: "Previous", status: "Belt", oppStatus: "Opponent belt",
  stance: "Stance", oppStance: "Opponent stance", heightAdv: "Height", reachAdv: "Reach", odds: "Market",
};

function optionLabel(key: keyof LabFilters, value: string): string {
  for (const section of FILTER_SECTIONS) {
    for (const field of section.fields) {
      if (field.kind === "select" && field.key === key) {
        return field.options.find((option) => option.value === value)?.label ?? value;
      }
    }
  }
  return value;
}

export type Chip = { id: string; label: string; keys: (keyof LabFilters)[] };

/** Active filters as removable chips, in a stable reading order. */
export function describeFilters(filters: LabFilters, fighterNames: Map<string, string>): Chip[] {
  const chips: Chip[] = [];
  const range = (minKey: keyof LabFilters, maxKey: keyof LabFilters, label: string, unit = "") => {
    const min = filters[minKey] as string;
    const max = filters[maxKey] as string;
    if (!min && !max) return;
    const text = min && max ? `${min}–${max}${unit}` : min ? `${min}+${unit}` : `≤ ${max}${unit}`;
    chips.push({ id: String(minKey), label: `${label} ${text}`, keys: [minKey, maxKey] });
  };
  range("from", "to", "Years");
  if (filters.division.length) chips.push({ id: "division", label: filters.division.length > 2 ? `${filters.division.length} divisions` : filters.division.join(", "), keys: ["division"] });
  for (const key of ["gender", "title", "rounds", "mainEvent", "method"] as const) {
    const value = filters[key];
    if (value !== "any" && value !== "all") chips.push({ id: key, label: `${LABELS[key]}: ${optionLabel(key, value)}`, keys: [key] });
  }
  range("ageMin", "ageMax", "Age");
  range("winStreakMin", "winStreakMax", "Win streak");
  range("lossStreakMin", "lossStreakMax", "Loss streak");
  if (filters.prev !== "any") chips.push({ id: "prev", label: optionLabel("prev", filters.prev), keys: ["prev"] });
  range("layoffMin", "layoffMax", "Layoff", "d");
  range("expMin", "expMax", "UFC bouts");
  if (filters.status !== "any") chips.push({ id: "status", label: `${LABELS.status}: ${optionLabel("status", filters.status)}`, keys: ["status"] });
  if (filters.stance !== "any") chips.push({ id: "stance", label: `${optionLabel("stance", filters.stance)} stance`, keys: ["stance"] });
  range("oppAgeMin", "oppAgeMax", "Opponent age");
  range("oppExpMin", "oppExpMax", "Opponent bouts");
  if (filters.oppStatus !== "any") chips.push({ id: "oppStatus", label: `${LABELS.oppStatus}: ${optionLabel("oppStatus", filters.oppStatus)}`, keys: ["oppStatus"] });
  if (filters.oppStance !== "any") chips.push({ id: "oppStance", label: `vs ${optionLabel("oppStance", filters.oppStance)}`, keys: ["oppStance"] });
  if (filters.ageGap !== "any" || filters.ageGapMin) {
    chips.push({ id: "ageGap", label: `${filters.ageGap === "any" ? "Age gap" : optionLabel("ageGap", filters.ageGap)}${filters.ageGapMin ? ` by ${filters.ageGapMin}y+` : ""}`, keys: ["ageGap", "ageGapMin"] });
  }
  if (filters.reachAdv !== "any" || filters.reachGapMin) {
    chips.push({ id: "reachAdv", label: `${filters.reachAdv === "any" ? "Reach gap" : optionLabel("reachAdv", filters.reachAdv)}${filters.reachGapMin ? ` by ${filters.reachGapMin}"+` : ""}`, keys: ["reachAdv", "reachGapMin"] });
  }
  if (filters.heightAdv !== "any") chips.push({ id: "heightAdv", label: optionLabel("heightAdv", filters.heightAdv), keys: ["heightAdv"] });
  if (filters.odds !== "any") chips.push({ id: "odds", label: optionLabel("odds", filters.odds), keys: ["odds"] });
  range("lineMin", "lineMax", "Line");
  range("probMin", "probMax", "Implied", "%");
  if (filters.fighterIds.length) {
    chips.push({ id: "fighterIds", label: filters.fighterIds.length === 1 ? (fighterNames.get(filters.fighterIds[0]) ?? "1 fighter") : `${filters.fighterIds.length} fighters`, keys: ["fighterIds"] });
  }
  if (filters.opponentIds.length) {
    chips.push({ id: "opponentIds", label: `vs ${filters.opponentIds.length === 1 ? (fighterNames.get(filters.opponentIds[0]) ?? "1 fighter") : `${filters.opponentIds.length} fighters`}`, keys: ["opponentIds"] });
  }
  return chips;
}

export function clearKeys(filters: LabFilters, keys: (keyof LabFilters)[]): LabFilters {
  const next = { ...filters };
  for (const key of keys) {
    const blank = EMPTY_FILTERS[key];
    (next[key] as unknown) = Array.isArray(blank) ? [] : blank;
  }
  return next;
}

// ---------------------------------------------------------------------------
// Presets: one click to a population worth looking at. Each is a real question
// people ask about the sport, expressed in the same filters the panel exposes,
// so opening the panel afterwards shows exactly how it was built.

export type Preset = { id: string; name: string; question: string; filters: Partial<LabFilters>; groupBy: string };

export const PRESETS: Preset[] = [
  {
    id: "hot-underdog",
    name: "Live underdog",
    question: "Do closing underdogs on a run actually beat their price?",
    filters: { odds: "underdog", winStreakMin: "3" },
    groupBy: "prob",
  },
  {
    id: "champion-defending",
    name: "Champion defending",
    question: "How often does a reigning champion keep the belt?",
    filters: { status: "champion", title: "only" },
    groupBy: "era",
  },
  {
    id: "long-layoff",
    name: "Back from a long layoff",
    question: "What does a year or more out of the cage cost a fighter?",
    filters: { layoffMin: "365" },
    groupBy: "layoff",
  },
  {
    id: "after-ko",
    name: "After a knockout loss",
    question: "How do fighters do in their first bout back after being knocked out?",
    filters: { prev: "koLoss" },
    groupBy: "layoff",
  },
  {
    id: "veteran",
    name: "The 35+ veteran",
    question: "Where does age start to bite, and in which department?",
    filters: { ageMin: "35" },
    groupBy: "age",
  },
  {
    id: "southpaw",
    name: "Southpaw problem",
    question: "Is the southpaw advantage real against orthodox fighters?",
    filters: { stance: "Southpaw", oppStance: "Orthodox" },
    groupBy: "era",
  },
  {
    id: "short-notice",
    name: "Quick turnaround",
    question: "Does taking a fight within two months hurt?",
    filters: { layoffMax: "60" },
    groupBy: "layoff",
  },
  {
    id: "five-rounders",
    name: "Championship rounds",
    question: "How does output hold up when a fight is booked for five?",
    filters: { rounds: "5" },
    groupBy: "year",
  },
  {
    id: "debut",
    name: "UFC debut",
    question: "What happens to fighters in their very first UFC bout?",
    filters: { prev: "debut" },
    groupBy: "era",
  },
  {
    id: "heavy-favorite",
    name: "Heavy favorite",
    question: "How safe is a −400 or shorter favorite, really?",
    filters: { odds: "favorite", lineMax: "-400" },
    groupBy: "line",
  },
];
