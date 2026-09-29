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
  /** Signed, fighter minus opponent, so a negative gap means the fighter is the younger. */
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
  /** Signed inches, fighter minus opponent. */
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

/** A common band for a range, so most studies take one pick instead of two
 * typed numbers. Bounds are inclusive, like the filters themselves. */
export type RangePreset = { label: string; min?: string; max?: string };

export type FilterField =
  | { kind: "select"; key: keyof LabFilters; label: string; options: SelectOption[]; hint?: string }
  /** Picked from `presets`; "Custom" opens the exact min and max. */
  | { kind: "range"; minKey: keyof LabFilters; maxKey: keyof LabFilters; label: string; presets: RangePreset[]; unit?: string; hint?: string; placeholderMin?: string; placeholderMax?: string }
  | { kind: "divisions"; key: "division"; label: string }
  /** Options are the nationalities the archive holds, known once the study has been read. */
  | { kind: "country"; key: "country" | "oppCountry"; label: string; hint?: string };

export type FilterSection = { title: string; fields: FilterField[] };
export type FilterTab = { id: "fighter" | "opponent"; label: string; sections: FilterSection[] };

const ANY = { value: "any", label: "Any" };

const BELT_OPTIONS: SelectOption[] = [ANY, { value: "champion", label: "Reigning champion" }, { value: "formerChampion", label: "Former champion" }, { value: "everChampion", label: "Has held a belt" }, { value: "neverChampion", label: "Never held a belt" }];
const STANCE_OPTIONS: SelectOption[] = [ANY, { value: "Orthodox", label: "Orthodox" }, { value: "Southpaw", label: "Southpaw" }, { value: "Switch", label: "Switch" }];
const AGE: RangePreset[] = [{ label: "Under 25", max: "24" }, { label: "25–29", min: "25", max: "29" }, { label: "30–34", min: "30", max: "34" }, { label: "35 or older", min: "35" }];
const EXPERIENCE: RangePreset[] = [{ label: "None (UFC debut)", max: "0" }, { label: "1–3", min: "1", max: "3" }, { label: "4–9", min: "4", max: "9" }, { label: "10 or more", min: "10" }];
const PROB: RangePreset[] = [{ label: "30% or less", max: "30" }, { label: "30–50%", min: "30", max: "50" }, { label: "50–70%", min: "50", max: "70" }, { label: "70% or more", min: "70" }];
const LINE: RangePreset[] = [{ label: "+300 or longer", min: "300" }, { label: "+100 to +299", min: "100", max: "299" }, { label: "−100 to −299", min: "-299", max: "-100" }, { label: "−300 or shorter", max: "-300" }];
const edge = (shorter: string, longer: string): RangePreset[] => [
  { label: `${shorter} by 3+ in`, max: "-3" },
  { label: `${shorter} by 1+ in`, max: "-1" },
  { label: "Within 1 in", min: "-1", max: "1" },
  { label: `${longer} by 1+ in`, min: "1" },
  { label: `${longer} by 3+ in`, min: "3" },
];
const NATIONALITY_HINT = "From the verified professional history. A fighter whose nationality was never stated is left out once this is set.";

/** The fighter whose record is read, and the bout they walked into. The
 * opponent tab is optional and only narrows who they faced. */
export const FILTER_TABS: FilterTab[] = [
  {
    id: "fighter",
    label: "Fighter Record",
    sections: [
      {
        title: "Bout",
        fields: [
          { kind: "range", minKey: "from", maxKey: "to", presets: [{ label: "Since 2020", min: "2020" }, { label: "Since 2015", min: "2015" }, { label: "Since 2010", min: "2010" }, { label: "Before 2010", max: "2009" }], label: "Years" },
          { kind: "select", key: "gender", label: "Roster", options: [{ value: "all", label: "Everyone" }, { value: "men", label: "Men" }, { value: "women", label: "Women" }] },
          { kind: "divisions", key: "division", label: "Divisions" },
          { kind: "select", key: "title", label: "Championship", options: [ANY, { value: "only", label: "Title bouts only" }, { value: "none", label: "No title bouts" }] },
          { kind: "select", key: "mainEvent", label: "Card position", options: [ANY, { value: "only", label: "Main events" }, { value: "none", label: "Undercard" }] },
          { kind: "select", key: "rounds", label: "Scheduled length", options: [{ value: "all", label: "Any" }, { value: "3", label: "3 rounds" }, { value: "5", label: "5 rounds" }] },
          { kind: "select", key: "method", label: "How it ended", hint: "Filters on the result, so use it to study one kind of ending.", options: [ANY, { value: "ko", label: "KO/TKO" }, { value: "sub", label: "Submission" }, { value: "finish", label: "Any finish" }, { value: "decision", label: "Decision" }] },
        ],
      },
      {
        title: "Betting",
        fields: [
          { kind: "select", key: "odds", label: "Market role", options: [ANY, { value: "priced", label: "Any priced bout" }, { value: "underdog", label: "Underdog" }, { value: "favorite", label: "Favorite" }, { value: "pickem", label: "Pick'em (within 3%)" }] },
          { kind: "range", minKey: "probMin", maxKey: "probMax", presets: PROB, label: "Implied win chance", unit: "%" },
          { kind: "range", minKey: "lineMin", maxKey: "lineMax", presets: LINE, label: "Closing line", placeholderMin: "−500", placeholderMax: "+500", hint: "American odds. Type a minus sign for a favorite. A bout without a closing price drops out." },
        ],
      },
      {
        title: "Form",
        fields: [
          { kind: "select", key: "prev", label: "Previous result", options: [ANY, { value: "debut", label: "UFC debut" }, { value: "win", label: "Win" }, { value: "finishWin", label: "Finish win" }, { value: "loss", label: "Loss" }, { value: "koLoss", label: "KO/TKO loss" }, { value: "subLoss", label: "Submission loss" }, { value: "finishLoss", label: "Any finish loss" }, { value: "decisionLoss", label: "Decision loss" }, { value: "drawOrNc", label: "Draw or NC" }] },
          { kind: "range", minKey: "layoffMin", maxKey: "layoffMax", presets: [{ label: "60 days or less", max: "60" }, { label: "61–180 days", min: "61", max: "180" }, { label: "181–364 days", min: "181", max: "364" }, { label: "A year or more", min: "365" }], label: "Days since last bout", hint: "Debuts have no previous bout and are excluded once this is set." },
          { kind: "range", minKey: "winStreakMin", maxKey: "winStreakMax", presets: [{ label: "None", max: "0" }, { label: "1 or more", min: "1" }, { label: "2 or more", min: "2" }, { label: "3 or more", min: "3" }, { label: "5 or more", min: "5" }], label: "UFC win streak" },
          { kind: "range", minKey: "lossStreakMin", maxKey: "lossStreakMax", presets: [{ label: "None", max: "0" }, { label: "1 or more", min: "1" }, { label: "2 or more", min: "2" }, { label: "3 or more", min: "3" }], label: "UFC losing streak" },
        ],
      },
      {
        title: "Profile",
        fields: [
          { kind: "range", minKey: "ageMin", maxKey: "ageMax", presets: AGE, label: "Age", hint: "On fight night. Only bouts with a known birth date qualify." },
          { kind: "range", minKey: "expMin", maxKey: "expMax", presets: EXPERIENCE, label: "UFC bouts already had" },
          { kind: "select", key: "status", label: "Belt status", hint: "Reconstructed from results across all divisions; vacancies are not dated.", options: BELT_OPTIONS },
          { kind: "select", key: "stance", label: "Stance", hint: "Listed stance. Historical changes are not tracked.", options: STANCE_OPTIONS },
          { kind: "country", key: "country", label: "Nationality", hint: NATIONALITY_HINT },
        ],
      },
      {
        title: "Edge over opponent",
        fields: [
          { kind: "range", minKey: "ageGapMin", maxKey: "ageGapMax", presets: [{ label: "Younger by 5+ yrs", max: "-5" }, { label: "Younger by 1+ yrs", max: "-1" }, { label: "Within 1 yr", min: "-1", max: "1" }, { label: "Older by 1+ yrs", min: "1" }, { label: "Older by 5+ yrs", min: "5" }], label: "Age gap", unit: "yrs", placeholderMin: "−15", placeholderMax: "+15", hint: "Fighter's age minus the opponent's. Negative means the fighter was younger." },
          { kind: "range", minKey: "reachGapMin", maxKey: "reachGapMax", presets: edge("Shorter", "Longer"), label: "Reach advantage", unit: "in", placeholderMin: "−8", placeholderMax: "+8", hint: "Fighter's reach minus the opponent's. Negative means the shorter reach." },
          { kind: "range", minKey: "heightGapMin", maxKey: "heightGapMax", presets: edge("Shorter", "Taller"), label: "Height advantage", unit: "in", placeholderMin: "−8", placeholderMax: "+8", hint: "Fighter's height minus the opponent's. Negative means shorter." },
        ],
      },
    ],
  },
  {
    id: "opponent",
    label: "Opponent",
    sections: [
      {
        title: "Profile",
        fields: [
          { kind: "range", minKey: "oppAgeMin", maxKey: "oppAgeMax", presets: AGE, label: "Age", hint: "On fight night. Only bouts with a known birth date qualify." },
          { kind: "range", minKey: "oppExpMin", maxKey: "oppExpMax", presets: EXPERIENCE, label: "UFC bouts already had" },
          { kind: "select", key: "oppStatus", label: "Belt status", hint: "Reconstructed from results across all divisions; vacancies are not dated.", options: BELT_OPTIONS },
          { kind: "select", key: "oppStance", label: "Stance", hint: "Listed stance. Historical changes are not tracked.", options: STANCE_OPTIONS },
          { kind: "country", key: "oppCountry", label: "Nationality", hint: NATIONALITY_HINT },
        ],
      },
      {
        title: "Betting",
        fields: [
          { kind: "range", minKey: "oppProbMin", maxKey: "oppProbMax", presets: PROB, label: "Implied win chance", unit: "%" },
          { kind: "range", minKey: "oppLineMin", maxKey: "oppLineMax", presets: LINE, label: "Closing line", placeholderMin: "−500", placeholderMax: "+500", hint: "American odds. Type a minus sign for a favorite. A bout without a closing price drops out." },
        ],
      },
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

const fieldKeys = (field: FilterField): (keyof LabFilters)[] => (field.kind === "range" ? [field.minKey, field.maxKey] : [field.key]);

/** Every filter one tab owns, so a tab can be cleared as a unit. */
export const tabKeys = (tab: FilterTab): (keyof LabFilters)[] => tab.sections.flatMap((section) => section.fields.flatMap(fieldKeys));

/** How many of one tab's controls are currently doing something. */
export const tabActiveCount = (tab: FilterTab, filters: LabFilters): number => tabKeys(tab).filter((key) => !isBlank(filters[key])).length;

const LABELS: Partial<Record<keyof LabFilters, string>> = {
  gender: "Roster", title: "Championship", rounds: "Length", mainEvent: "Card", method: "Ending",
  prev: "Previous", status: "Belt", oppStatus: "Opp belt",
  stance: "Stance", oppStance: "Opp stance", odds: "Market",
  country: "Nationality", oppCountry: "Opp nationality",
};

function optionLabel(key: keyof LabFilters, value: string): string {
  for (const section of FILTER_TABS.flatMap((tab) => tab.sections)) {
    for (const field of section.fields) {
      if (field.kind === "select" && field.key === key) return field.options.find((option) => option.value === value)?.label ?? value;
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
  if (filters.odds !== "any") chips.push({ id: "odds", label: `${LABELS.odds}: ${optionLabel("odds", filters.odds)}`, keys: ["odds"] });
  range("lineMin", "lineMax", "Line");
  range("probMin", "probMax", "Implied", "%");
  range("oppLineMin", "oppLineMax", "Opp line");
  range("oppProbMin", "oppProbMax", "Opp implied", "%");
  range("ageMin", "ageMax", "Age");
  range("oppAgeMin", "oppAgeMax", "Opp age");
  gap("ageGapMin", "ageGapMax", "Age gap", "y");
  if (filters.prev !== "any") chips.push({ id: "prev", label: `${LABELS.prev}: ${optionLabel("prev", filters.prev)}`, keys: ["prev"] });
  range("winStreakMin", "winStreakMax", "Win streak");
  range("lossStreakMin", "lossStreakMax", "Loss streak");
  range("layoffMin", "layoffMax", "Layoff", "d");
  range("expMin", "expMax", "UFC bouts");
  range("oppExpMin", "oppExpMax", "Opp UFC bouts");
  for (const key of ["status", "oppStatus", "stance", "oppStance"] as const) {
    if (filters[key] !== "any") chips.push({ id: key, label: `${LABELS[key]}: ${optionLabel(key, filters[key])}`, keys: [key] });
  }
  for (const key of ["country", "oppCountry"] as const) {
    if (filters[key]) chips.push({ id: key, label: `${LABELS[key]}: ${filters[key]}`, keys: [key] });
  }
  gap("reachGapMin", "reachGapMax", "Reach edge", "\u2033");
  gap("heightGapMin", "heightGapMax", "Height edge", "\u2033");
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


/** Whether a control is currently asking anything of the population. */
export const isBlank = (value: LabFilters[keyof LabFilters]): boolean =>
  Array.isArray(value) ? value.length === 0 : value === "" || value === "any" || value === "all";
