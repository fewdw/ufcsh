export type ActionType = "significantStrikes" | "totalStrikes" | "headStrikes" | "bodyStrikes" | "legStrikes"
  | "distanceStrikes" | "clinchStrikes" | "groundStrikes" | "takedowns" | "knockdowns" | "submissions" | "control";

export const ACTION_TYPES: ActionType[] = [
  "significantStrikes", "totalStrikes", "headStrikes", "bodyStrikes", "legStrikes",
  "distanceStrikes", "clinchStrikes", "groundStrikes", "takedowns", "knockdowns", "submissions", "control",
];

export type FightAction = { scored: number; attempted: number | null };
export type FightActionSide = Partial<Record<ActionType, FightAction>>;

export function parseActionNumber(value: unknown): number | null {
  const match = String(value ?? "").trim().match(/^\d+$/);
  return match ? Number(match[0]) : null;
}

export function parseActionPair(value: unknown): FightAction | null {
  const match = String(value ?? "").trim().match(/^(\d+)\s+of\s+(\d+)$/i);
  if (!match) return null;
  const scored = Number(match[1]);
  const attempted = Number(match[2]);
  return scored <= attempted ? { scored, attempted } : null;
}

export function parseActionClock(value: unknown): number | null {
  const match = String(value ?? "").trim().match(/^(\d+):(\d{2})$/);
  if (!match || Number(match[2]) > 59) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function actionPercentage(scored: number, attempted: number, defense = false): number | null {
  if (!Number.isFinite(scored) || !Number.isFinite(attempted) || attempted <= 0 || scored < 0 || scored > attempted) return null;
  return ((defense ? attempted - scored : scored) / attempted) * 100;
}

/** Convert one official fight-detail record into the normalized Actions vocabulary. */
export function fightActions(fight: any): { f1: FightActionSide; f2: FightActionSide } {
  const result: { f1: FightActionSide; f2: FightActionSide } = { f1: {}, f2: {} };
  let detail: any = null;
  try {
    detail = fight.detail_json ? JSON.parse(fight.detail_json) : null;
  } catch {
    // Summary stats below remain an accurate landed-count fallback.
  }
  for (const side of ["f1", "f2"] as const) {
    const totals = detail?.totals;
    const significant = detail?.sigStrikes;
    const totalValues = new Map<string, unknown>(
      Array.isArray(totals?.labels) && Array.isArray(totals?.[side])
        ? totals.labels.map((label: string, index: number): [string, unknown] => [label, totals[side][index]])
        : [],
    );
    const significantValues = new Map<string, unknown>(
      Array.isArray(significant?.labels) && Array.isArray(significant?.[side])
        ? significant.labels.map((label: string, index: number): [string, unknown] => [label, significant[side][index]])
        : [],
    );
    const putPair = (key: ActionType, value: unknown) => {
      const pair = parseActionPair(value);
      if (pair) result[side][key] = pair;
    };
    putPair("significantStrikes", totalValues.get("Sig. str."));
    putPair("totalStrikes", totalValues.get("Total str."));
    putPair("takedowns", totalValues.get("Td"));
    putPair("headStrikes", significantValues.get("Head"));
    putPair("bodyStrikes", significantValues.get("Body"));
    putPair("legStrikes", significantValues.get("Leg"));
    putPair("distanceStrikes", significantValues.get("Distance"));
    putPair("clinchStrikes", significantValues.get("Clinch"));
    putPair("groundStrikes", significantValues.get("Ground"));

    const knockdowns = parseActionNumber(totalValues.get("KD")) ?? parseActionNumber(fight[`${side}_kd`]);
    if (knockdowns != null) result[side].knockdowns = { scored: knockdowns, attempted: null };
    const submissions = parseActionNumber(totalValues.get("Sub. att")) ?? parseActionNumber(fight[`${side}_sub`]);
    if (submissions != null) result[side].submissions = { scored: submissions, attempted: null };
    const control = parseActionClock(totalValues.get("Ctrl"));
    if (control != null) result[side].control = { scored: control, attempted: null };

    // Event pages provide authoritative landed totals even before the richer
    // detail page has been cached. Never invent the missing attempt denominator.
    const significantLanded = parseActionNumber(fight[`${side}_str`]);
    if (!result[side].significantStrikes && significantLanded != null) {
      result[side].significantStrikes = { scored: significantLanded, attempted: null };
    }
    const takedownsLanded = parseActionNumber(fight[`${side}_td`]);
    if (!result[side].takedowns && takedownsLanded != null) {
      result[side].takedowns = { scored: takedownsLanded, attempted: null };
    }
  }
  return result;
}

/** Structural/source invariants that must hold before a completed detail page is trusted. */
export function validateFightActions(fight: any): string[] {
  const issues: string[] = [];
  const actions = fightActions(fight);
  if (parseActionNumber(fight.f1_str) == null) return issues;
  for (const side of ["f1", "f2"] as const) {
    const summaryChecks = [
      ["str", "significantStrikes"],
      ["td", "takedowns"],
      ["kd", "knockdowns"],
      ["sub", "submissions"],
    ] as const;
    for (const [field, actionType] of summaryChecks) {
      const summary = parseActionNumber(fight[`${side}_${field}`]);
      const detail = actions[side][actionType];
      if (summary != null && (!detail || detail.scored !== summary)) issues.push(`${side} ${actionType} disagrees with event summary`);
    }
    const requiredAttempts: ActionType[] = [
      "significantStrikes", "totalStrikes", "headStrikes", "bodyStrikes", "legStrikes",
      "distanceStrikes", "clinchStrikes", "groundStrikes", "takedowns",
    ];
    for (const actionType of requiredAttempts) {
      if (actions[side][actionType]?.attempted == null) issues.push(`${side} ${actionType} is missing attempts`);
    }
    const significant = actions[side].significantStrikes;
    const target = [actions[side].headStrikes, actions[side].bodyStrikes, actions[side].legStrikes];
    const position = [actions[side].distanceStrikes, actions[side].clinchStrikes, actions[side].groundStrikes];
    const sumsToSignificant = (parts: Array<FightAction | undefined>) => significant && parts.every(Boolean)
      && parts.reduce((sum, part) => sum + part!.scored, 0) === significant.scored
      && parts.reduce((sum, part) => sum + part!.attempted!, 0) === significant.attempted;
    if (significant && target.every(Boolean) && !sumsToSignificant(target)) issues.push(`${side} strike targets do not sum to significant strikes`);
    if (significant && position.every(Boolean) && !sumsToSignificant(position)) issues.push(`${side} strike positions do not sum to significant strikes`);
    const total = actions[side].totalStrikes;
    if (significant && total && (total.scored < significant.scored || total.attempted! < significant.attempted!)) {
      issues.push(`${side} all strikes are below significant strikes`);
    }
  }
  return issues;
}

const actionCache = new Map<string, { fingerprint: string; actions: ReturnType<typeof fightActions> }>();

/** Reuse normalized immutable detail pages while invalidating on any source update. */
export function cachedFightActions(fight: any): ReturnType<typeof fightActions> {
  if (!fight.id) return fightActions(fight);
  const fingerprint = [
    fight.detail_fetched_at ?? "",
    fight.f1_str, fight.f2_str, fight.f1_td, fight.f2_td,
    fight.f1_kd, fight.f2_kd, fight.f1_sub, fight.f2_sub,
  ].join("|");
  const cached = actionCache.get(fight.id);
  if (cached?.fingerprint === fingerprint) return cached.actions;
  const actions = fightActions(fight);
  actionCache.set(fight.id, { fingerprint, actions });
  return actions;
}
