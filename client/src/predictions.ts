export type PredictionMethod = "ko" | "submission" | "decision";
export const METHOD_LABEL: Record<PredictionMethod, string> = { ko: "KO/TKO", submission: "Submission", decision: "Decision" };
export type PredictionPick = {
  fighterId: string; method: PredictionMethod | null; round: number | null;
  f1Id: string; f2Id: string; f1Name: string; f2Name: string;
  eventId: string; eventName: string; eventDate: string; ruleVersion: number;
};
export type PredictionResult = {
  state: "pending" | "won" | "lost" | "void"; points: number | null;
  /** What a pick is worth just for being made, right or wrong. */
  entry: number; fighter: number; method: number; round: number; reason: string | null;
};
/** How everyone has called this bout, for the community charts. */
export type PredictionDistribution = {
  total: number;
  fighters: { fighterId: string; name: string; count: number }[];
  methods: { method: PredictionMethod | null; count: number }[];
  rounds: { round: number | null; count: number }[];
};
export type PredictionStatus = {
  matchupKey: string;
  open: boolean; reason: string; lockedAt: number | null; eventStartsAt: number | null;
  closesAt: number | null;
  triggerFightId: string | null; scheduledRounds: number | null;
  fighters: { fighterId: string; name: string }[];
  /** False once the official result is published: the pick is on the record. */
  removable: boolean;
  rules: { version: number; entry: number; fighter: number; method: number; round: number };
  maxPoints: number;
};
export type PredictionSummary = PredictionStatus & { total: number; distribution: PredictionDistribution };
export type MyPrediction = PredictionStatus & { revision: number; pick: PredictionPick | null; updatedAt: number | null; result: PredictionResult | null };
/** Right/wrong over the calls a fan actually made. `pct` is null with none. */
export type PredictionRate = { right: number; wrong: number; total: number; pct: number | null };
export type ProfilePredictions = {
  total: number; offset: number; pageSize: number;
  totals: { points: number; won: number; lost: number; pending: number; void: number };
  accuracy: { fighter: PredictionRate; method: PredictionRate; round: PredictionRate };
  predictions: { fightId: string; revision: number; updatedAt: number; pick: PredictionPick; result: PredictionResult }[];
};
export const predictionPoints = (points: number) => `${points > 0 ? "+" : ""}${points.toLocaleString()}`;
export const predictionName = (pick: PredictionPick) => pick.fighterId === pick.f1Id ? pick.f1Name : pick.f2Name;
export const predictionLabel = (pick: PredictionPick) => [predictionName(pick), pick.method ? METHOD_LABEL[pick.method] : null, pick.round ? `R${pick.round}` : null].filter(Boolean).join(" · ");
/** A whole-number share, and the one place rounding is decided. */
export const sharePct = (count: number, total: number) => total ? Math.round((count / total) * 100) : 0;
