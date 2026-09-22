/** One declarative schema generates both the filter panel and the query
 * string. Sections are ordered most-used first. */

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
  /** Signed, A minus B, so a negative gap means A is the younger. */
  ageGapMin: string;
  ageGapMax: string;
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
  /** ISO country code, or "" for any nationality. Unknown never matches. */
  country: string;
  oppCountry: string;
  /** Signed inches, A minus B. */
  reachGapMin: string;
  reachGapMax: string;
  heightGapMin: string;
  heightGapMax: string;
  odds: "any" | "priced" | "underdog" | "favorite" | "pickem";
  lineMin: string;
  lineMax: string;
  probMin: string;
  probMax: string;
  oppLineMin: string;
  oppLineMax: string;
  oppProbMin: string;
  oppProbMax: string;
};

export const EMPTY_FILTERS: LabFilters = {
  from: "", to: "", division: [], gender: "all", title: "any", rounds: "all", mainEvent: "any", method: "any",
  ageMin: "", ageMax: "", oppAgeMin: "", oppAgeMax: "", ageGapMin: "", ageGapMax: "",
  winStreakMin: "", winStreakMax: "", lossStreakMin: "", lossStreakMax: "", prev: "any",
  layoffMin: "", layoffMax: "", expMin: "", expMax: "", oppExpMin: "", oppExpMax: "",
  status: "any", oppStatus: "any", stance: "any", oppStance: "any", country: "", oppCountry: "",
  reachGapMin: "", reachGapMax: "", heightGapMin: "", heightGapMax: "",
  odds: "any", lineMin: "", lineMax: "", probMin: "", probMax: "",
  oppLineMin: "", oppLineMax: "", oppProbMin: "", oppProbMax: "",
};

export const emptyFilters = (): LabFilters => ({ ...EMPTY_FILTERS, division: [] });

export type SelectOption = { value: string; label: string };

/**
 * A paired field asks the same question of both corners, which is how people
 * actually think about a matchup ("a 35-year-old against someone under 30").
 * Rendering A above B under one heading keeps twenty controls readable.
 */
export type FilterField =
  | { kind: "select"; key: keyof LabFilters; label: string; options: SelectOption[]; hint?: string }
  | { kind: "range"; minKey: keyof LabFilters; maxKey: keyof LabFilters; label: string; unit?: string; hint?: string; placeholderMin?: string; placeholderMax?: string }
  | { kind: "number"; key: keyof LabFilters; label: string; unit?: string; hint?: string }
  | { kind: "divisions"; key: "division"; label: string }
  | { kind: "pairedRange"; id: string; label: string; unit?: string; hint?: string; a: [keyof LabFilters, keyof LabFilters]; b: [keyof LabFilters, keyof LabFilters]; placeholderMin?: string; placeholderMax?: string }
  | { kind: "pairedSelect"; id: string; label: string; hint?: string; a: keyof LabFilters; b: keyof LabFilters; options: SelectOption[] }
  /** The same shape, but its options are the nationalities the archive holds,
   *  which are only known once the study has been read. */
  | { kind: "pairedCountry"; id: string; label: string; hint?: string; a: keyof LabFilters; b: keyof LabFilters };

export type FilterSection = { id: string; title: string; blurb: string; defaultOpen?: boolean; fields: FilterField[] };

const ANY = { value: "any", label: "Any" };

const BELT_OPTIONS: SelectOption[] = [ANY, { value: "champion", label: "Reigning champion" }, { value: "formerChampion", label: "Former champion" }, { value: "everChampion", label: "Has held a belt" }, { value: "neverChampion", label: "Never held a belt" }];
const STANCE_OPTIONS: SelectOption[] = [ANY, { value: "Orthodox", label: "Orthodox" }, { value: "Southpaw", label: "Southpaw" }, { value: "Switch", label: "Switch" }];

export const FILTER_SECTIONS: FilterSection[] = [
  {
    id: "when",
    title: "Years",
    blurb: "The span of the sport this cohort is drawn from.",
    defaultOpen: true,
    fields: [
      { kind: "range", minKey: "from", maxKey: "to", label: "Between", placeholderMin: "First", placeholderMax: "Last" },
    ],
  },
  {
    id: "who",
    title: "Divisions & roster",
    blurb: "Which weight classes are in play.",
    defaultOpen: true,
    fields: [
      { kind: "divisions", key: "division", label: "Divisions" },
      { kind: "select", key: "gender", label: "Roster", options: [{ value: "all", label: "Everyone" }, { value: "men", label: "Men's divisions" }, { value: "women", label: "Women's divisions" }] },
    ],
  },
  {
    id: "bout",
    title: "Kind of bout",
    blurb: "Where it sat on the card and how it ended.",
    fields: [
      { kind: "select", key: "title", label: "Championship", options: [ANY, { value: "only", label: "Title bouts only" }, { value: "none", label: "Exclude title bouts" }] },
      { kind: "select", key: "mainEvent", label: "Card position", options: [ANY, { value: "only", label: "Main events only" }, { value: "none", label: "Undercard only" }] },
      { kind: "select", key: "rounds", label: "Scheduled length", options: [{ value: "all", label: "Any" }, { value: "3", label: "3-round bouts" }, { value: "5", label: "5-round bouts" }] },
      { kind: "select", key: "method", label: "How it ended", hint: "Filters on the result, so use it to study one kind of ending.", options: [ANY, { value: "ko", label: "KO/TKO" }, { value: "sub", label: "Submission" }, { value: "finish", label: "Any finish" }, { value: "decision", label: "Decision" }] },
    ],
  },
  {
    id: "market",
    title: "Betting market",
    blurb: "Closing prices. A bout without one drops out once any of these is set.",
    fields: [
      { kind: "select", key: "odds", label: "Market role of A", options: [ANY, { value: "priced", label: "Any priced bout" }, { value: "underdog", label: "Closing underdog" }, { value: "favorite", label: "Closing favorite" }, { value: "pickem", label: "Pick'em (within 3%)" }] },
      { kind: "pairedRange", id: "line", label: "Closing line", placeholderMin: "−2000", placeholderMax: "+2000", a: ["lineMin", "lineMax"], b: ["oppLineMin", "oppLineMax"], hint: "American odds. Type a minus sign for a favourite." },
      { kind: "pairedRange", id: "prob", label: "Implied win chance", unit: "%", a: ["probMin", "probMax"], b: ["oppProbMin", "oppProbMax"] },
    ],
  },
  {
    id: "age",
    title: "Age",
    blurb: "Both corners on fight night, and the gap between them.",
    fields: [
      { kind: "pairedRange", id: "age", label: "Age on fight night", unit: "yrs", a: ["ageMin", "ageMax"], b: ["oppAgeMin", "oppAgeMax"], hint: "Only bouts with a known birth date qualify." },
      { kind: "range", minKey: "ageGapMin", maxKey: "ageGapMax", label: "Age gap (A − B)", unit: "yrs", placeholderMin: "−15", placeholderMax: "+15", hint: "Negative means A was the younger one. Leave one side blank for an open end." },
    ],
  },
  {
    id: "form",
    title: "Form entering",
    blurb: "What was true of A walking in — never what happened after.",
    fields: [
      { kind: "select", key: "prev", label: "Previous result", options: [ANY, { value: "debut", label: "UFC debut" }, { value: "win", label: "After a win" }, { value: "finishWin", label: "After a finish win" }, { value: "loss", label: "After a loss" }, { value: "koLoss", label: "After a KO/TKO loss" }, { value: "subLoss", label: "After a submission loss" }, { value: "finishLoss", label: "After any finish loss" }, { value: "decisionLoss", label: "After a decision loss" }, { value: "drawOrNc", label: "After a draw or NC" }] },
      { kind: "range", minKey: "winStreakMin", maxKey: "winStreakMax", label: "UFC win streak", unit: "fights" },
      { kind: "range", minKey: "lossStreakMin", maxKey: "lossStreakMax", label: "UFC losing streak", unit: "fights" },
      { kind: "range", minKey: "layoffMin", maxKey: "layoffMax", label: "Days since last bout", unit: "days", hint: "Debuts have no previous bout and are excluded once this is set." },
    ],
  },
  {
    id: "standing",
    title: "Experience & belts",
    blurb: "UFC experience entering the bout. Belts are reconstructed from results across all divisions; vacancies are not dated.",
    fields: [
      { kind: "pairedRange", id: "exp", label: "UFC bouts already had", a: ["expMin", "expMax"], b: ["oppExpMin", "oppExpMax"] },
      { kind: "pairedSelect", id: "belt", label: "Belt status", a: "status", b: "oppStatus", options: BELT_OPTIONS },
    ],
  },
  {
    id: "physical",
    title: "Physical & stance",
    blurb: "Profile measurements and listed stance, always A minus B. Historical stance changes are not tracked.",
    fields: [
      { kind: "range", minKey: "reachGapMin", maxKey: "reachGapMax", label: "Reach gap (A − B)", unit: "in", placeholderMin: "−8", placeholderMax: "+8", hint: "Negative means A was the shorter-reaching one." },
      { kind: "range", minKey: "heightGapMin", maxKey: "heightGapMax", label: "Height gap (A − B)", unit: "in", placeholderMin: "−8", placeholderMax: "+8" },
      { kind: "pairedSelect", id: "stance", label: "Stance", a: "stance", b: "oppStance", options: STANCE_OPTIONS },
      { kind: "pairedCountry", id: "country", label: "Nationality", a: "country", b: "oppCountry", hint: "From the verified professional history. A fighter whose nationality the source never stated is left out once this is set." },
    ],
  },
];

// ---------------------------------------------------------------------------

export function toQuery(filters: LabFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.join(","));
    } else if (value !== "" && value !== "any" && value !== "all") {
      params.set(key, String(value));
    }
  }
  return params.toString();
}

export function activeCount(filters: LabFilters): number {
  return Object.entries(filters).filter(([, value]) => (Array.isArray(value) ? value.length > 0 : value !== "" && value !== "any" && value !== "all")).length;
}

/** Every filter one section owns, so a section can be cleared as a unit. */
export function sectionKeys(section: FilterSection): (keyof LabFilters)[] {
  const keys: (keyof LabFilters)[] = [];
  for (const field of section.fields) {
    if (field.kind === "select" || field.kind === "number" || field.kind === "divisions") keys.push(field.key);
    else if (field.kind === "range") keys.push(field.minKey, field.maxKey);
    else if (field.kind === "pairedSelect" || field.kind === "pairedCountry") keys.push(field.a, field.b);
    else keys.push(...field.a, ...field.b);
  }
  return keys;
}

/** How many of one section's controls are currently doing something. */
export function sectionActiveCount(section: FilterSection, filters: LabFilters): number {
  const set = (key: keyof LabFilters) => {
    const value = filters[key];
    return Array.isArray(value) ? value.length > 0 : value !== "" && value !== "any" && value !== "all";
  };
  let count = 0;
  for (const field of section.fields) {
    if (field.kind === "select" || field.kind === "number" || field.kind === "divisions") count += set(field.key) ? 1 : 0;
    else if (field.kind === "range") count += (set(field.minKey) ? 1 : 0) + (set(field.maxKey) ? 1 : 0);
    else if (field.kind === "pairedSelect" || field.kind === "pairedCountry") count += (set(field.a) ? 1 : 0) + (set(field.b) ? 1 : 0);
    else count += field.a.concat(field.b).filter(set).length;
  }
  return count;
}

const LABELS: Partial<Record<keyof LabFilters, string>> = {
  gender: "Roster", title: "Championship", rounds: "Length", mainEvent: "Card", method: "Ending",
  prev: "Previous", status: "Belt", oppStatus: "B's belt",
  stance: "Stance", oppStance: "B's stance", odds: "Market",
  country: "Nationality", oppCountry: "B's nationality",
};

function optionLabel(key: keyof LabFilters, value: string): string {
  for (const section of FILTER_SECTIONS) {
    for (const field of section.fields) {
      if (field.kind === "select" && field.key === key) return field.options.find((option) => option.value === value)?.label ?? value;
      if (field.kind === "pairedSelect" && (field.a === key || field.b === key)) return field.options.find((option) => option.value === value)?.label ?? value;
    }
  }
  return value;
}

export type Chip = { id: string; label: string; keys: (keyof LabFilters)[] };

/** Active filters as removable chips, in a stable reading order. */
export function describeFilters(filters: LabFilters): Chip[] {
  const chips: Chip[] = [];
  const range = (minKey: keyof LabFilters, maxKey: keyof LabFilters, label: string, unit = "") => {
    const min = filters[minKey] as string;
    const max = filters[maxKey] as string;
    if (!min && !max) return;
    const text = min && max ? `${min}–${max}${unit}` : min ? `${min}+${unit}` : `≤ ${max}${unit}`;
    chips.push({ id: String(minKey), label: `${label} ${text}`, keys: [minKey, maxKey] });
  };
  // A signed gap reads as the number it is, so the same bout from the other
  // corner shows −1 where this one shows +1 rather than an identical 1.
  const signed = (value: string) => (Number(value) > 0 ? `+${Number(value)}` : String(Number(value)));
  const gap = (minKey: keyof LabFilters, maxKey: keyof LabFilters, label: string, unit: string) => {
    const min = filters[minKey] as string;
    const max = filters[maxKey] as string;
    if (!min && !max) return;
    const text = min && max
      ? (Number(min) === Number(max) ? `${signed(min)}${unit}` : `${signed(min)} to ${signed(max)}${unit}`)
      : min ? `${signed(min)}${unit} or more` : `${signed(max)}${unit} or less`;
    chips.push({ id: String(minKey), label: `${label} ${text}`, keys: [minKey, maxKey] });
  };
  range("from", "to", "Years");
  if (filters.division.length) chips.push({ id: "division", label: filters.division.length > 2 ? `${filters.division.length} divisions` : filters.division.join(", "), keys: ["division"] });
  for (const key of ["gender", "title", "rounds", "mainEvent", "method"] as const) {
    const value = filters[key];
    if (value !== "any" && value !== "all") chips.push({ id: key, label: `${LABELS[key]}: ${optionLabel(key, value)}`, keys: [key] });
  }
  if (filters.odds !== "any") chips.push({ id: "odds", label: optionLabel("odds", filters.odds), keys: ["odds"] });
  range("lineMin", "lineMax", "A line");
  range("probMin", "probMax", "A implied", "%");
  range("oppLineMin", "oppLineMax", "B line");
  range("oppProbMin", "oppProbMax", "B implied", "%");
  range("ageMin", "ageMax", "A age");
  range("oppAgeMin", "oppAgeMax", "B age");
  gap("ageGapMin", "ageGapMax", "Age gap", "y");
  if (filters.prev !== "any") chips.push({ id: "prev", label: optionLabel("prev", filters.prev), keys: ["prev"] });
  range("winStreakMin", "winStreakMax", "Win streak");
  range("lossStreakMin", "lossStreakMax", "Loss streak");
  range("layoffMin", "layoffMax", "Layoff", "d");
  range("expMin", "expMax", "A bouts");
  range("oppExpMin", "oppExpMax", "B bouts");
  for (const key of ["status", "oppStatus", "stance", "oppStance"] as const) {
    if (filters[key] !== "any") chips.push({ id: key, label: `${LABELS[key]}: ${optionLabel(key, filters[key])}`, keys: [key] });
  }
  for (const key of ["country", "oppCountry"] as const) {
    if (filters[key]) chips.push({ id: key, label: `${LABELS[key]}: ${filters[key]}`, keys: [key] });
  }
  gap("reachGapMin", "reachGapMax", "Reach gap", "\u2033");
  gap("heightGapMin", "heightGapMax", "Height gap", "\u2033");
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
// Filling from an announced matchup

/**
 * Applies a filled population from the server. The fill is chosen there
 * because deciding what to fill needs to know how many observations each
 * condition would leave, and only that side can count it; the values come
 * back keyed by the names in this file, so they are applied as they are.
 */
export function filtersFrom(values: Record<string, string | string[]>): LabFilters {
  const next = emptyFilters();
  for (const [key, value] of Object.entries(values)) {
    if (!(key in next)) continue;
    const blank = EMPTY_FILTERS[key as keyof LabFilters];
    if (Array.isArray(blank)) (next[key as keyof LabFilters] as string[]) = Array.isArray(value) ? value : String(value).split(",").filter(Boolean);
    else if (!Array.isArray(value)) (next[key as keyof LabFilters] as string) = value;
  }
  return next;
}


// ---------------------------------------------------------------------------
// Conditions from an announced matchup

/** Rebuilds the study from a matchup's switched-on conditions. Narrower
 * conditions follow and overwrite wider ones, so switching one off falls back
 * to the wider condition. */
export function filtersFromConditions(
  conditions: { id: string; values: Record<string, string | string[]>; on: boolean }[],
  choice: Record<string, boolean>,
): LabFilters {
  const values: Record<string, string | string[]> = {};
  for (const condition of conditions) if (choice[condition.id] ?? condition.on) Object.assign(values, condition.values);
  return filtersFrom(values);
}

/** Whether a control is currently asking anything of the population. */
export const isBlank = (value: LabFilters[keyof LabFilters]): boolean =>
  Array.isArray(value) ? value.length === 0 : value === "" || value === "any" || value === "all";
