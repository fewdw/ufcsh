import { Link } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pin, RotateCcw } from "lucide-react";
import { useApi } from "../api";
import type { StatChip, StatsDashboard } from "../api";
import Avatar from "../components/Avatar";
import FighterSearch, { type PickedFighter } from "../components/FighterSearch";
import StatsModeSwitch from "../components/StatsModeSwitch";
import { segmentedGroup, segmentedIdle, segmentedSelected } from "../components/segmented";
import { formatValue } from "../components/chartTokens";
import { useSeo } from "../seo";
import { useHistoryState, useRouteScrollRestoration } from "../navigationState";

const shell = "rounded-2xl border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]";
const selectClass = "max-w-full rounded-full border border-zinc-200 bg-zinc-50 py-1 pl-2.5 pr-7 text-[10px] font-medium text-zinc-700 outline-none transition hover:border-zinc-300 focus:border-zinc-400";

type Method = "all" | "ko" | "sub" | "finish" | "decision" | "unanimous" | "majority" | "split" | "dq";
type Metric = "total" | "percent";

type StatsSettings = {
  // shared by every card
  statsSince: string;
  statsUntil: string;
  minimumFights: "1" | "3" | "5" | "10" | "15" | "20";
  minimumSample: "1" | "3" | "5" | "10" | "15";
  limit: string;
  boutType: "all" | "title" | "nonTitle";
  cardPosition: "all" | "main" | "undercard";
  scheduledRounds: "all" | "3" | "5";
  // Record
  recordGroup: "bouts" | "wins" | "losses";
  boutsMode: "total" | "span" | "titleFights" | "divisions";
  winsMode: "total" | "streak" | "titleWins" | "titleDefenses" | "championWins" | "divisions" | "ageAtWin";
  winsByMethod: Method;
  winsByMetric: Metric;
  winsPercentOf: "allFights" | "allWins" | "finishWins" | "decisionWins";
  streakKind: "wins" | "unbeaten";
  streakByMethod: Method;
  streakWhen: "longest" | "current";
  titleWinMethod: Method;
  titleWinsMetric: Metric;
  defenseScope: "total" | "consecutive";
  titleDefenseMethod: Method;
  titleDefenseMetric: Metric;
  championScope: "ever" | "current";
  championWinMethod: Method;
  championWinsMetric: Metric;
  divisionWinMethod: Method;
  ageEnd: "youngest" | "oldest";
  lossesMode: "total" | "streak" | "titleLosses" | "failedTitleDefenses" | "divisions";
  lossesByMethod: Method;
  lossesByMetric: Metric;
  lossesPercentOf: "allFights" | "allLosses" | "finishLosses" | "decisionLosses";
  lossStreakMethod: Method;
  titleLossMethod: Method;
  titleLossesMetric: Metric;
  failedDefenseMethod: Method;
  failedDefenseMetric: Metric;
  divisionLossMethod: Method;
  // Finishing
  finishMode: "count" | "speed" | "fightTime" | "cageTime";
  finishDirection: "given" | "taken";
  speedScope: "average" | "single";
  roundFinishMethod: "ko" | "sub" | "finish";
  roundFinishRound: "all" | "1" | "2" | "3" | "4" | "5" | "1-3" | "4-5";
  roundFinishMetric: Metric;
  roundFinishPercentOf: "allFights" | "allResults" | "methodResults" | "roundResults";
  fightTimeOrder: "shortest" | "longest";
  // Output
  actionType: "significantStrikes" | "totalStrikes" | "headStrikes" | "bodyStrikes" | "legStrikes" | "distanceStrikes" | "clinchStrikes" | "groundStrikes" | "takedowns" | "knockdowns" | "submissions" | "control";
  actionDirection: "given" | "taken";
  actionMode: "perFight" | "perRound" | "per15" | "perMinute" | "total" | "single";
  actionBasis: "scored" | "attempted" | "differential" | "percent";
  actionMinimumAttempts: "1" | "3" | "5" | "10" | "20" | "50";
  // Context
  contextMode: "opposition" | "championsFaced" | "streakBreakers" | "bounceBack" | "rematches" | "returns" | "durability";
  oppositionSource: "ufc" | "all";
  oppositionWhen: "atTime" | "today";
  rematchMetric: "rate" | "revenge";
  returnWindow: "quick" | "layoff";
  // Market
  bettingMode: "underdog" | "favorite" | "aboveExpectation" | "roi" | "avgLine";
  underdogMetric: "wins" | "rate" | "biggest";
  favoriteMetric: "rate" | "losses";
};

const DEFAULT_SETTINGS: StatsSettings = {
  statsSince: "all",
  statsUntil: "all",
  minimumFights: "3",
  minimumSample: "3",
  limit: "50",
  boutType: "all",
  cardPosition: "all",
  scheduledRounds: "all",
  recordGroup: "wins",
  boutsMode: "total",
  winsMode: "total",
  winsByMethod: "all",
  winsByMetric: "total",
  winsPercentOf: "allFights",
  streakKind: "wins",
  streakByMethod: "all",
  streakWhen: "longest",
  titleWinMethod: "all",
  titleWinsMetric: "total",
  defenseScope: "total",
  titleDefenseMethod: "all",
  titleDefenseMetric: "total",
  championScope: "ever",
  championWinMethod: "all",
  championWinsMetric: "total",
  divisionWinMethod: "all",
  ageEnd: "youngest",
  lossesMode: "total",
  lossesByMethod: "all",
  lossesByMetric: "total",
  lossesPercentOf: "allFights",
  lossStreakMethod: "all",
  titleLossMethod: "all",
  titleLossesMetric: "total",
  failedDefenseMethod: "all",
  failedDefenseMetric: "total",
  divisionLossMethod: "all",
  finishMode: "count",
  finishDirection: "given",
  speedScope: "average",
  roundFinishMethod: "finish",
  roundFinishRound: "all",
  roundFinishMetric: "total",
  roundFinishPercentOf: "allFights",
  fightTimeOrder: "shortest",
  actionType: "significantStrikes",
  actionDirection: "given",
  actionMode: "perFight",
  actionBasis: "scored",
  actionMinimumAttempts: "1",
  contextMode: "opposition",
  oppositionSource: "all",
  oppositionWhen: "atTime",
  rematchMetric: "rate",
  returnWindow: "quick",
  bettingMode: "underdog",
  underdogMetric: "wins",
  favoriteMetric: "rate",
};

type Update = <K extends keyof StatsSettings>(key: K, value: StatsSettings[K]) => void;

function formatRank(rank: number | null, tied: boolean): string {
  if (rank == null) return "NR";
  return tied ? `T${rank}` : String(rank);
}

/** A percentage read at a glance: the ring fills clockwise with the value. */
function PercentageDonut({ value }: { value: number }) {
  const percentage = Math.max(0, Math.min(100, value));
  return (
    <span
      className="grid h-5 w-5 shrink-0 place-items-center rounded-full"
      style={{ background: `conic-gradient(var(--color-win-2) 0% ${percentage}%, var(--color-zinc-200) ${percentage}% 100%)` }}
      aria-hidden="true"
    >
      <span className="h-2.5 w-2.5 rounded-full bg-white" />
    </span>
  );
}

const CHIP_TONE: Record<string, string> = {
  win: "bg-emerald-50 text-emerald-800 ring-emerald-100",
  loss: "bg-rose-50 text-rose-800 ring-rose-100",
  draw: "bg-amber-50 text-amber-800 ring-amber-100",
  nc: "bg-zinc-100 text-zinc-600 ring-zinc-200",
};

const CHIP_WORD: Record<string, string> = { win: "won", loss: "lost", draw: "drew", nc: "no contest" };

/**
 * The names behind a row's number, coloured by result so a list of champions
 * or a run of opponents can be read at a glance. Colour never carries the
 * meaning alone: every chip's tooltip spells the outcome out.
 */
function Chips({ chips }: { chips: StatChip[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!chips.length) return null;
  const visible = expanded ? chips : chips.slice(0, 6);
  const hidden = chips.length - visible.length;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1">
      {visible.map((chip, index) => (
        <span
          key={`${chip.fight_id}-${chip.label}-${index}`}
          title={[chip.label, chip.note, chip.outcome ? CHIP_WORD[chip.outcome] : null].filter(Boolean).join(" · ")}
          className={`max-w-full truncate rounded px-1.5 py-px text-[9px] font-medium leading-4 ring-1 ring-inset ${
            chip.outcome ? CHIP_TONE[chip.outcome] : "bg-zinc-100 text-zinc-600 ring-zinc-200"
          }`}
        >
          {chip.label}
          {chip.note && chip.note.length <= 9 ? <span className="opacity-60"> {chip.note}</span> : null}
        </span>
      ))}
      {hidden > 0 ? (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setExpanded(true);
          }}
          className="rounded px-1.5 py-px text-[9px] font-semibold leading-4 text-zinc-500 ring-1 ring-inset ring-zinc-200 transition hover:bg-zinc-100 hover:text-zinc-900"
        >
          +{hidden}
        </button>
      ) : null}
      {expanded && chips.length > 6 ? (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setExpanded(false);
          }}
          className="rounded px-1.5 py-px text-[9px] font-semibold leading-4 text-zinc-500 ring-1 ring-inset ring-zinc-200 transition hover:bg-zinc-100 hover:text-zinc-900"
          aria-label="Hide expanded information"
        >
          Hide
        </button>
      ) : null}
    </span>
  );
}

function Select({ label, value, onChange, children, width }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode; width?: string }) {
  return (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className={`${selectClass} ${width ?? ""}`}>
      {children}
    </select>
  );
}

function MethodSelect({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <Select label={label} value={value} onChange={onChange}>
      <option value="all">All methods</option>
      <option value="ko">KO/TKO</option>
      <option value="sub">Submission</option>
      <option value="finish">Finish</option>
      <option value="decision">All decisions</option>
      <option value="unanimous">Unanimous decision</option>
      <option value="majority">Majority decision</option>
      <option value="split">Split decision</option>
      <option value="dq">Disqualification</option>
    </Select>
  );
}

// ---------------------------------------------------------------------------
// Per-card controls. Five cards, each opening with one select that names the
// statistic it ranks; everything after it qualifies that one statistic. The
// families inside a select are grouped, so a long menu still reads as a menu
// rather than a wall of options.

function CardControls({ boardKey, settings, update, division }: { boardKey: string; settings: StatsSettings; update: Update; division: string }) {
  const actionSupportsAttempts = !["knockdowns", "submissions", "control"].includes(settings.actionType);
  const actionIsPercent = settings.actionBasis === "percent";
  const scoredLabel = settings.actionType === "knockdowns" ? "Scored"
    : settings.actionType === "submissions" ? "Attempts"
      : settings.actionType === "control" ? "Controlled"
        : "Landed";
  const divisionLocked = division !== "all";
  const finishSide = settings.finishDirection === "taken" ? "losses" : "wins";
  const finishMethodLabel = settings.roundFinishMethod === "ko" ? "KO/TKO" : settings.roundFinishMethod === "sub" ? "submission" : "finish";

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {boardKey === "record" && settings.recordGroup === "bouts" ? (
        <Select label="Bouts statistic" value={settings.boutsMode} onChange={(value) => update("boutsMode", value as StatsSettings["boutsMode"])}>
          <option value="total">Most UFC bouts</option>
          <option value="span">Longest career span</option>
          <option value="titleFights">Most championship bouts</option>
          <option value="divisions" disabled={divisionLocked}>Most divisions{divisionLocked ? " · all divisions only" : ""}</option>
        </Select>
      ) : null}

      {boardKey === "record" && settings.recordGroup === "wins" ? (
        <>
          <Select label="Wins statistic" value={settings.winsMode} onChange={(value) => update("winsMode", value as StatsSettings["winsMode"])}>
            <optgroup label="Volume">
              <option value="total">Wins, by method or share</option>
              <option value="streak">Winning runs</option>
            </optgroup>
            <optgroup label="Championship">
              <option value="titleWins">Championship wins</option>
              <option value="titleDefenses">Title defenses</option>
              <option value="championWins">Wins over champions</option>
            </optgroup>
            <optgroup label="Reach">
              <option value="divisions" disabled={divisionLocked}>Divisions won in{divisionLocked ? " · all divisions only" : ""}</option>
              <option value="ageAtWin">Age at a win</option>
            </optgroup>
          </Select>
          {settings.winsMode === "total" ? (
            <>
              <MethodSelect label="Win method" value={settings.winsByMethod} onChange={(value) => {
                update("winsByMethod", value as Method);
                update("winsPercentOf", "allFights");
              }} />
              <Select label="Count or share" value={settings.winsByMetric} onChange={(value) => {
                update("winsByMetric", value as Metric);
                if (value === "percent") update("winsPercentOf", "allFights");
              }}>
                <option value="total">Count</option>
                <option value="percent">%</option>
              </Select>
              {settings.winsByMetric === "percent" ? (
                <Select label="Win percentage denominator" value={settings.winsPercentOf} onChange={(value) => update("winsPercentOf", value as StatsSettings["winsPercentOf"])}>
                  <option value="allFights">of all fights</option>
                  {settings.winsByMethod !== "all" ? <option value="allWins">of all wins</option> : null}
                  {settings.winsByMethod === "ko" || settings.winsByMethod === "sub" ? <option value="finishWins">of finish wins</option> : null}
                  {["unanimous", "majority", "split"].includes(settings.winsByMethod) ? <option value="decisionWins">of decision wins</option> : null}
                </Select>
              ) : null}
            </>
          ) : null}
          {settings.winsMode === "streak" ? (
            <>
              <Select label="Kind of run" value={settings.streakKind} onChange={(value) => update("streakKind", value as StatsSettings["streakKind"])}>
                <option value="wins">Win streak</option>
                <option value="unbeaten">Unbeaten run</option>
              </Select>
              <Select label="Longest or current" value={settings.streakWhen} onChange={(value) => update("streakWhen", value as StatsSettings["streakWhen"])}>
                <option value="longest">Longest ever</option>
                <option value="current">Running now</option>
              </Select>
              {settings.streakKind === "wins" ? <MethodSelect label="Streak method" value={settings.streakByMethod} onChange={(value) => update("streakByMethod", value as Method)} /> : null}
            </>
          ) : null}
          {settings.winsMode === "titleWins" ? (
            <>
              <MethodSelect label="Championship win method" value={settings.titleWinMethod} onChange={(value) => update("titleWinMethod", value as Method)} />
              <Select label="Championship ranking" value={settings.titleWinsMetric} onChange={(value) => update("titleWinsMetric", value as Metric)}>
                <option value="total">Total</option>
                <option value="percent">{settings.titleWinMethod === "all" ? "Win rate %" : "Share of wins %"}</option>
              </Select>
            </>
          ) : null}
          {settings.winsMode === "titleDefenses" ? (
            <>
              <Select label="Defense scope" value={settings.defenseScope} onChange={(value) => update("defenseScope", value as StatsSettings["defenseScope"])}>
                <option value="total">Total defenses</option>
                <option value="consecutive">Longest run</option>
              </Select>
              <MethodSelect label="Title defense method" value={settings.titleDefenseMethod} onChange={(value) => update("titleDefenseMethod", value as Method)} />
              {settings.defenseScope === "total" && settings.titleDefenseMethod !== "all" ? (
                <Select label="Defense ranking" value={settings.titleDefenseMetric} onChange={(value) => update("titleDefenseMetric", value as Metric)}>
                  <option value="total">Total</option>
                  <option value="percent">Share of defenses %</option>
                </Select>
              ) : null}
            </>
          ) : null}
          {settings.winsMode === "championWins" ? (
            <>
              <Select label="Which champions count" value={settings.championScope} onChange={(value) => update("championScope", value as StatsSettings["championScope"])}>
              <option value="ever">Current or former champions</option>
              <option value="current">Champions at the time</option>
            </Select>
              <Select label="Champion-win ranking" value={settings.championWinsMetric} onChange={(value) => update("championWinsMetric", value as Metric)}>
                <option value="total">Total</option>
                <option value="percent">Win rate %</option>
              </Select>
              {settings.championWinsMetric === "total" ? <MethodSelect label="Method against champions" value={settings.championWinMethod} onChange={(value) => update("championWinMethod", value as Method)} /> : null}
            </>
          ) : null}
          {settings.winsMode === "divisions" ? <MethodSelect label="Cross-division method" value={settings.divisionWinMethod} onChange={(value) => update("divisionWinMethod", value as Method)} /> : null}
          {settings.winsMode === "ageAtWin" ? (
            <Select label="Youngest or oldest" value={settings.ageEnd} onChange={(value) => update("ageEnd", value as StatsSettings["ageEnd"])}>
              <option value="youngest">Youngest</option>
              <option value="oldest">Oldest</option>
            </Select>
          ) : null}
        </>
      ) : null}

      {boardKey === "record" && settings.recordGroup === "losses" ? (
        <>
          <Select label="Losses statistic" value={settings.lossesMode} onChange={(value) => update("lossesMode", value as StatsSettings["lossesMode"])}>
            <optgroup label="Volume">
              <option value="total">Losses, by method or share</option>
              <option value="streak">Losing runs</option>
            </optgroup>
            <optgroup label="Championship">
              <option value="titleLosses">Championship losses</option>
              <option value="failedTitleDefenses">Failed title defenses</option>
            </optgroup>
            <optgroup label="Reach">
              <option value="divisions" disabled={divisionLocked}>Divisions lost in{divisionLocked ? " · all divisions only" : ""}</option>
            </optgroup>
          </Select>
          {settings.lossesMode === "total" ? (
            <>
              <MethodSelect label="Loss method" value={settings.lossesByMethod} onChange={(value) => {
                update("lossesByMethod", value as Method);
                update("lossesPercentOf", "allFights");
              }} />
              <Select label="Count or share" value={settings.lossesByMetric} onChange={(value) => {
                update("lossesByMetric", value as Metric);
                if (value === "percent") update("lossesPercentOf", "allFights");
              }}>
                <option value="total">Count</option>
                <option value="percent">%</option>
              </Select>
              {settings.lossesByMetric === "percent" ? (
                <Select label="Loss percentage denominator" value={settings.lossesPercentOf} onChange={(value) => update("lossesPercentOf", value as StatsSettings["lossesPercentOf"])}>
                  <option value="allFights">of all fights</option>
                  {settings.lossesByMethod !== "all" ? <option value="allLosses">of all losses</option> : null}
                  {settings.lossesByMethod === "ko" || settings.lossesByMethod === "sub" ? <option value="finishLosses">of finish losses</option> : null}
                  {["unanimous", "majority", "split"].includes(settings.lossesByMethod) ? <option value="decisionLosses">of decision losses</option> : null}
                </Select>
              ) : null}
            </>
          ) : null}
          {settings.lossesMode === "streak" ? (
            <>
              <Select label="Longest or current" value={settings.streakWhen} onChange={(value) => update("streakWhen", value as StatsSettings["streakWhen"])}>
                <option value="longest">Longest ever</option>
                <option value="current">Running now</option>
              </Select>
              <MethodSelect label="Losing streak method" value={settings.lossStreakMethod} onChange={(value) => update("lossStreakMethod", value as Method)} />
            </>
          ) : null}
          {settings.lossesMode === "titleLosses" ? (
            <>
              <MethodSelect label="Championship loss method" value={settings.titleLossMethod} onChange={(value) => update("titleLossMethod", value as Method)} />
              <Select label="Championship loss ranking" value={settings.titleLossesMetric} onChange={(value) => update("titleLossesMetric", value as Metric)}>
                <option value="total">Total</option>
                <option value="percent">{settings.titleLossMethod === "all" ? "Loss rate %" : "Share of losses %"}</option>
              </Select>
            </>
          ) : null}
          {settings.lossesMode === "failedTitleDefenses" ? (
            <>
              <MethodSelect label="Failed defense method" value={settings.failedDefenseMethod} onChange={(value) => update("failedDefenseMethod", value as Method)} />
              {settings.failedDefenseMethod !== "all" ? (
                <Select label="Failed defense ranking" value={settings.failedDefenseMetric} onChange={(value) => update("failedDefenseMetric", value as Metric)}>
                  <option value="total">Total</option>
                  <option value="percent">Share of failed defenses %</option>
                </Select>
              ) : null}
            </>
          ) : null}
          {settings.lossesMode === "divisions" ? <MethodSelect label="Cross-division loss method" value={settings.divisionLossMethod} onChange={(value) => update("divisionLossMethod", value as Method)} /> : null}
        </>
      ) : null}

      {boardKey === "finishing" ? (
        <>
          <Select label="Finishing statistic" value={settings.finishMode} onChange={(value) => update("finishMode", value as StatsSettings["finishMode"])}>
            <option value="count">How many finishes</option>
            <option value="speed">How fast they come</option>
            <option value="fightTime">Average fight time</option>
            <option value="cageTime">Total cage time</option>
          </Select>
          {settings.finishMode === "count" || settings.finishMode === "speed" ? (
            <Select label="Finishing or being finished" value={settings.finishDirection} onChange={(value) => update("finishDirection", value as StatsSettings["finishDirection"])}>
              <option value="given">Finishing others</option>
              <option value="taken">Being finished</option>
            </Select>
          ) : null}
          {settings.finishMode === "count" ? (
            <>
              <Select label="Round" value={settings.roundFinishRound} onChange={(value) => update("roundFinishRound", value as StatsSettings["roundFinishRound"])}>
                <option value="all">All rounds</option>
                <optgroup label="Individual rounds">
                  <option value="1">Round 1</option>
                  <option value="2">Round 2</option>
                  <option value="3">Round 3</option>
                  <option value="4">Round 4</option>
                  <option value="5">Round 5</option>
                </optgroup>
                <optgroup label="Grouped rounds">
                  <option value="1-3">Rounds 1–3</option>
                  <option value="4-5">Rounds 4–5</option>
                </optgroup>
              </Select>
              <Select label="Finish method" value={settings.roundFinishMethod} onChange={(value) => update("roundFinishMethod", value as StatsSettings["roundFinishMethod"])}>
                <option value="finish">Finish</option>
                <option value="ko">KO/TKO</option>
                <option value="sub">Submission</option>
              </Select>
              <Select label="Count or share" value={settings.roundFinishMetric} onChange={(value) => {
                update("roundFinishMetric", value as Metric);
                if (value === "percent") update("roundFinishPercentOf", "allFights");
              }}>
                <option value="total">Count</option>
                <option value="percent">%</option>
              </Select>
              {settings.roundFinishMetric === "percent" ? (
                <Select label="Percentage denominator" value={settings.roundFinishPercentOf} onChange={(value) => update("roundFinishPercentOf", value as StatsSettings["roundFinishPercentOf"])}>
                  <option value="allFights">of all fights</option>
                  <option value="allResults">of all {finishSide}</option>
                  <option value="methodResults">of {finishMethodLabel} {finishSide}</option>
                  <option value="roundResults">of {finishSide} in those rounds</option>
                </Select>
              ) : null}
            </>
          ) : null}
          {settings.finishMode === "speed" ? (
            <Select label="Average or single bout" value={settings.speedScope} onChange={(value) => update("speedScope", value as StatsSettings["speedScope"])}>
              <option value="average">Career average</option>
              <option value="single">Single fastest</option>
            </Select>
          ) : null}
          {settings.finishMode === "fightTime" ? (
            <Select label="Shortest or longest" value={settings.fightTimeOrder} onChange={(value) => update("fightTimeOrder", value as StatsSettings["fightTimeOrder"])}>
              <option value="shortest">Shortest first</option>
              <option value="longest">Longest first</option>
            </Select>
          ) : null}
        </>
      ) : null}

      {boardKey === "output" ? (
        <>
          <Select label="Action" value={settings.actionType} onChange={(value) => {
            const supportsAttempts = !["knockdowns", "submissions", "control"].includes(value);
            update("actionType", value as StatsSettings["actionType"]);
            if (!supportsAttempts && (settings.actionBasis === "attempted" || settings.actionBasis === "percent")) update("actionBasis", "scored");
          }}>
            <optgroup label="Strikes">
              <option value="significantStrikes">Significant strikes</option>
              <option value="totalStrikes">All strikes</option>
            </optgroup>
            <optgroup label="Other actions">
              <option value="takedowns">Takedowns</option>
              <option value="knockdowns">Knockdowns</option>
              <option value="submissions">Submission attempts</option>
              <option value="control">Control time</option>
            </optgroup>
            <optgroup label="Strike target">
              <option value="headStrikes">Head strikes</option>
              <option value="bodyStrikes">Body strikes</option>
              <option value="legStrikes">Leg strikes</option>
            </optgroup>
            <optgroup label="Strike position">
              <option value="distanceStrikes">Distance strikes</option>
              <option value="clinchStrikes">Clinch strikes</option>
              <option value="groundStrikes">Ground strikes</option>
            </optgroup>
          </Select>
          <Select label="Direction" value={settings.actionDirection} onChange={(value) => update("actionDirection", value as StatsSettings["actionDirection"])}>
            <option value="given">Given</option>
            <option value="taken">Taken</option>
          </Select>
          <Select label="Calculation" value={settings.actionBasis} onChange={(value) => {
            update("actionBasis", value as StatsSettings["actionBasis"]);
            if (value === "percent" && settings.actionMode !== "single") update("actionMode", "total");
          }}>
            <option value="scored">{scoredLabel}</option>
            {actionSupportsAttempts ? <option value="attempted">Attempted</option> : null}
            <option value="differential">Differential</option>
            {actionSupportsAttempts ? <option value="percent">{settings.actionDirection === "given" ? "Accuracy %" : "Defense %"}</option> : null}
          </Select>
          <Select label="Scope" value={settings.actionMode} onChange={(value) => update("actionMode", value as StatsSettings["actionMode"])}>
            {actionIsPercent ? (
              <>
                <option value="total">Career</option>
                <option value="single">Single bout</option>
              </>
            ) : (
              <>
                <option value="perFight">Per bout</option>
                <option value="perRound">Per round</option>
                <option value="per15">Per 15 minutes</option>
                <option value="perMinute">Per minute</option>
                <option value="total">Total</option>
                <option value="single">Single bout</option>
              </>
            )}
          </Select>
          {actionIsPercent ? (
            <Select label="Minimum attempts" value={settings.actionMinimumAttempts} onChange={(value) => update("actionMinimumAttempts", value as StatsSettings["actionMinimumAttempts"])}>
              <option value="1">1+ attempts</option>
              <option value="3">3+ attempts</option>
              <option value="5">5+ attempts</option>
              <option value="10">10+ attempts</option>
              <option value="20">20+ attempts</option>
              <option value="50">50+ attempts</option>
            </Select>
          ) : null}
        </>
      ) : null}

      {boardKey === "context" ? (
        <>
          <Select label="Context statistic" value={settings.contextMode} onChange={(value) => update("contextMode", value as StatsSettings["contextMode"])}>
            <optgroup label="Who they faced">
              <option value="opposition">Toughest opposition faced</option>
              <option value="championsFaced">Champions faced</option>
              <option value="streakBreakers">Streaks broken</option>
            </optgroup>
            <optgroup label="What they overcame">
              <option value="bounceBack">Bounce-back rate</option>
              <option value="rematches">Rematches</option>
              <option value="returns">Returning from time off</option>
              <option value="durability">Durability streak</option>
            </optgroup>
          </Select>
          {settings.contextMode === "opposition" ? (
            <>
              <Select label="Which of an opponent's fights count" value={settings.oppositionSource} onChange={(value) => update("oppositionSource", value as StatsSettings["oppositionSource"])}>
                <option value="ufc">UFC record</option>
                <option value="all">Complete career</option>
              </Select>
              <Select label="When the opponent's record is read" value={settings.oppositionWhen} onChange={(value) => update("oppositionWhen", value as StatsSettings["oppositionWhen"])}>
                <option value="atTime">At the time of the fight</option>
                <option value="today">As it stands today</option>
              </Select>
            </>
          ) : null}
          {settings.contextMode === "championsFaced" ? (
            <Select label="Which champions count" value={settings.championScope} onChange={(value) => update("championScope", value as StatsSettings["championScope"])}>
              <option value="ever">Current or former champions</option>
              <option value="current">Champions at the time</option>
            </Select>
          ) : null}
          {settings.contextMode === "rematches" ? (
            <Select label="Rematch measure" value={settings.rematchMetric} onChange={(value) => update("rematchMetric", value as StatsSettings["rematchMetric"])}>
              <option value="rate">Win rate</option>
              <option value="revenge">Revenge wins</option>
            </Select>
          ) : null}
          {settings.contextMode === "returns" ? (
            <Select label="Time off" value={settings.returnWindow} onChange={(value) => update("returnWindow", value as StatsSettings["returnWindow"])}>
              <option value="quick">Within 120 days</option>
              <option value="layoff">After 365+ days</option>
            </Select>
          ) : null}
        </>
      ) : null}

      {boardKey === "market" ? (
        <>
          <Select label="Market statistic" value={settings.bettingMode} onChange={(value) => update("bettingMode", value as StatsSettings["bettingMode"])}>
            <option value="underdog">As the underdog</option>
            <option value="favorite">As the favorite</option>
            <option value="aboveExpectation">Wins above expectation</option>
            <option value="roi">$100 stake return</option>
            <option value="avgLine">Longest average price</option>
          </Select>
          {settings.bettingMode === "underdog" ? (
            <Select label="Underdog measure" value={settings.underdogMetric} onChange={(value) => update("underdogMetric", value as StatsSettings["underdogMetric"])}>
              <option value="wins">Wins</option>
              <option value="rate">Win rate</option>
              <option value="biggest">Biggest upset</option>
            </Select>
          ) : null}
          {settings.bettingMode === "favorite" ? (
            <Select label="Favorite measure" value={settings.favoriteMetric} onChange={(value) => update("favoriteMetric", value as StatsSettings["favoriteMetric"])}>
              <option value="rate">Win rate</option>
              <option value="losses">Losses</option>
            </Select>
          ) : null}
        </>
      ) : null}
    </div>
  );
}


function Leaderboard({
  board,
  settings,
  update,
  pinned,
  onTogglePin,
  fighterSelected,
  pinnedFighterIds,
  division,
  className = "",
}: {
  board: StatsDashboard["leaderboards"][number];
  settings: StatsSettings;
  update: Update;
  pinned: boolean;
  onTogglePin: () => void;
  fighterSelected: boolean;
  pinnedFighterIds: ReadonlySet<string>;
  division: string;
  className?: string;
}) {
  const rowsScroll = useRouteScrollRestoration<HTMLDivElement>(`stats-board:${board.key}`);
  return (
    <section className={`${shell} flex h-[41rem] min-w-0 flex-col overflow-hidden ${className}`}>
      <header className="flex min-h-36 shrink-0 flex-col border-b border-zinc-200 px-4 py-3">
        <div className="flex min-h-7 items-start justify-between gap-2">
          {board.key === "record" ? (
            <div className={segmentedGroup} aria-label="Bouts, wins or losses">
              {(["bouts", "wins", "losses"] as const).map((group) => (
                <button
                  key={group}
                  type="button"
                  aria-pressed={settings.recordGroup === group}
                  onClick={() => update("recordGroup", group)}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize transition ${settings.recordGroup === group ? segmentedSelected : segmentedIdle}`}
                >
                  {group}
                </button>
              ))}
            </div>
          ) : (
            <h2 className="pt-1 text-sm font-semibold text-zinc-950">{board.title}</h2>
          )}
          <button
            type="button"
            onClick={onTogglePin}
            aria-label={`${pinned ? "Unpin" : "Pin"} ${board.title}`}
            aria-pressed={pinned}
            title={`${pinned ? "Unpin" : "Pin"} ${board.title}`}
            className={`grid h-7 w-7 shrink-0 place-items-center rounded-full transition ${pinned ? "bg-zinc-900 text-white shadow-sm" : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"}`}
          >
            <Pin size={14} strokeWidth={2} fill={pinned ? "currentColor" : "none"} />
          </button>
        </div>
        <p className="mt-0.5 text-[10px] leading-4 text-zinc-400">{board.description}</p>
        <div className="mt-auto min-h-6">
          <CardControls boardKey={board.key} settings={settings} update={update} division={division} />
        </div>
      </header>
      <div ref={rowsScroll} className="min-h-0 flex-1 divide-y divide-zinc-50 overflow-y-auto">
        {board.rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-zinc-400">
            {fighterSelected ? "None of the selected fighters qualify for this statistic." : "No fighters match these filters."}
          </div>
        ) : null}
        {board.rows.map((fighter) => {
          const fighterPinned = pinnedFighterIds.has(fighter.fighter_id);
          return (
          <Link
            key={fighter.fighter_id}
            to={`/fighters/${fighter.fighter_id}`}
            className={`flex items-start gap-2.5 px-3 py-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-900 ${fighterPinned ? "bg-zinc-100/90 hover:bg-zinc-200/80" : "hover:bg-zinc-50"}`}
          >
            <span
              className={`w-8 shrink-0 self-start pt-0.5 text-center text-xs font-semibold tabular-nums ${fighter.rank != null && fighter.rank <= 3 ? "text-zinc-900" : "text-zinc-400"}`}
              title={fighter.rank == null ? "Not ranked for these filters" : fighter.tied ? `Tied at rank ${fighter.rank}` : `Rank ${fighter.rank}`}
            >
              {formatRank(fighter.rank, fighter.tied)}
            </span>
            <span className="shrink-0 self-start"><Avatar src={fighter.photo_url} name={fighter.name} size="xs" /></span>
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="min-w-0 truncate text-sm font-medium text-zinc-900" title={fighter.name}>{fighter.name}</span>
                {fighterPinned ? <span className="shrink-0 rounded bg-zinc-200 px-1 py-px text-[7px] font-bold uppercase tracking-wider text-zinc-500">Pinned</span> : null}
              </span>
              <span className="block text-[10px] leading-[1.3] text-zinc-400" title={`${fighter.division} · ${fighter.detail}`}>
                {fighter.division} · {fighter.detail}
              </span>
              <Chips chips={fighter.chips ?? []} />
            </span>
            <span className="flex shrink-0 items-center gap-1.5 self-start pt-0.5 text-sm font-semibold tabular-nums text-zinc-950">
              <span>{formatValue(fighter.value, board.format)}</span>
              {board.format === "percent" ? <PercentageDonut value={fighter.value} /> : null}
            </span>
          </Link>
          );
        })}
      </div>
    </section>
  );
}

const PINNED_BOARDS_KEY = "ufcsh:stats:pinned-boards";

function loadPinnedBoards(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(PINNED_BOARDS_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((key): key is string => typeof key === "string") : [];
  } catch {
    return [];
  }
}

const ROW_COUNTS = Array.from({ length: 15 }, (_, index) => String((index + 1) * 10));

function FilterRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex items-start justify-between gap-4 px-4 py-2.5 text-zinc-700">
      <span className="min-w-0">
        <span className="block text-xs font-medium">{label}</span>
        {hint ? <span className="mt-0.5 block text-[10px] leading-4 text-zinc-400">{hint}</span> : null}
      </span>
      <span className="shrink-0">{children}</span>
    </label>
  );
}

function FiltersMenu({
  years,
  divisions,
  settings,
  update,
  includeWomen,
  setIncludeWomen,
  includeInactiveFighters,
  setIncludeInactiveFighters,
  showMoreInfo,
  setShowMoreInfo,
  keepFullLists,
  setKeepFullLists,
  division,
  setDivision,
}: {
  years: number[];
  divisions: string[];
  settings: StatsSettings;
  update: Update;
  includeWomen: boolean;
  setIncludeWomen: (value: boolean) => void;
  includeInactiveFighters: boolean;
  setIncludeInactiveFighters: (value: boolean) => void;
  showMoreInfo: boolean;
  setShowMoreInfo: (value: boolean) => void;
  keepFullLists: boolean;
  setKeepFullLists: (value: boolean) => void;
  division: string;
  setDivision: (value: string) => void;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (returnFocus = false) => {
      const details = detailsRef.current;
      if (!details?.open) return;
      details.open = false;
      if (returnFocus) details.querySelector<HTMLElement>("summary")?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      const details = detailsRef.current;
      if (details?.open && !details.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !detailsRef.current?.open) return;
      event.preventDefault();
      close(true);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const active = [
    settings.statsSince !== "all",
    settings.statsUntil !== "all",
    settings.boutType !== "all",
    settings.cardPosition !== "all",
    settings.scheduledRounds !== "all",
    division !== "all",
    includeWomen,
    !includeInactiveFighters,
    showMoreInfo,
    keepFullLists,
  ].filter(Boolean).length;

  return (
    <details ref={detailsRef} className="relative z-40">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 [&::-webkit-details-marker]:hidden">
        Filters
        {active ? <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[9px] tabular-nums text-zinc-500">{active}</span> : null}
        <svg className="h-3 w-3 text-zinc-400" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="m3 4.5 3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="absolute right-0 mt-2 max-h-[32rem] w-[22rem] overflow-y-auto rounded-2xl border border-zinc-200 bg-white shadow-xl">
        <div className="border-b border-zinc-100 px-4 py-3">
          <div className="text-xs font-semibold text-zinc-900">Shared filters</div>
          <div className="mt-0.5 text-[10px] text-zinc-400">These scope all five cards at once.</div>
        </div>
        <div className="divide-y divide-zinc-100">
          <FilterRow label="From" hint="Only bouts on or after this year.">
            <Select label="Starting year" value={settings.statsSince} onChange={(value) => update("statsSince", value)}>
              <option value="all">First event</option>
              {years.map((yearValue) => <option key={yearValue} value={yearValue}>{yearValue}</option>)}
            </Select>
          </FilterRow>
          <FilterRow label="To" hint="Only bouts on or before this year.">
            <Select label="Ending year" value={settings.statsUntil} onChange={(value) => update("statsUntil", value)}>
              <option value="all">Latest event</option>
              {years.map((yearValue) => <option key={yearValue} value={yearValue}>{yearValue}</option>)}
            </Select>
          </FilterRow>
          <FilterRow label="Bout type">
            <Select label="Bout type" value={settings.boutType} onChange={(value) => update("boutType", value as StatsSettings["boutType"])}>
              <option value="all">All bouts</option>
              <option value="title">Championship only</option>
              <option value="nonTitle">Exclude championship</option>
            </Select>
          </FilterRow>
          <FilterRow label="Card position">
            <Select label="Card position" value={settings.cardPosition} onChange={(value) => update("cardPosition", value as StatsSettings["cardPosition"])}>
              <option value="all">Whole card</option>
              <option value="main">Main events</option>
              <option value="undercard">Undercard</option>
            </Select>
          </FilterRow>
          <FilterRow label="Scheduled length">
            <Select label="Scheduled length" value={settings.scheduledRounds} onChange={(value) => update("scheduledRounds", value as StatsSettings["scheduledRounds"])}>
              <option value="all">Any length</option>
              <option value="3">3-round bouts</option>
              <option value="5">5-round bouts</option>
            </Select>
          </FilterRow>
          <FilterRow label="Division">
            <select
              aria-label="Division"
              value={division}
              onChange={(event) => {
                const next = event.target.value;
                setDivision(next);
                if (next !== "all" && settings.winsMode === "divisions") update("winsMode", "total");
                if (next !== "all" && settings.lossesMode === "divisions") update("lossesMode", "total");
                if (next !== "all" && settings.boutsMode === "divisions") update("boutsMode", "total");
              }}
              className={`${selectClass} w-40`}
            >
              <option value="all">All divisions</option>
              {divisions.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </FilterRow>
          <FilterRow label="Minimum bouts" hint="Career UFC bouts a fighter needs to appear at all.">
            <Select label="Minimum UFC bouts" value={settings.minimumFights} onChange={(value) => update("minimumFights", value as StatsSettings["minimumFights"])}>
              <option value="1">1+</option>
              <option value="3">3+</option>
              <option value="5">5+</option>
              <option value="10">10+</option>
              <option value="15">15+</option>
              <option value="20">20+</option>
            </Select>
          </FilterRow>
          <FilterRow label="Minimum sample" hint="Qualifying attempts a rate needs before it is ranked, so a one-for-one record cannot top a percentage board.">
            <Select label="Minimum sample for rate statistics" value={settings.minimumSample} onChange={(value) => update("minimumSample", value as StatsSettings["minimumSample"])}>
              <option value="1">1+</option>
              <option value="3">3+</option>
              <option value="5">5+</option>
              <option value="10">10+</option>
              <option value="15">15+</option>
            </Select>
          </FilterRow>
          <FilterRow label="Fighters per chart" hint="How many rows each card lists.">
            <Select label="Fighters per chart" value={settings.limit} onChange={(value) => update("limit", value)}>
              {ROW_COUNTS.map((count) => <option key={count} value={count}>{count}</option>)}
            </Select>
          </FilterRow>
          <label className="flex cursor-pointer items-start justify-between gap-4 px-4 py-2.5 text-zinc-700 transition-colors hover:bg-zinc-50">
            <span>
              <span className="block text-xs font-medium">Show more info</span>
              <span className="mt-0.5 block text-[10px] font-normal leading-4 text-zinc-400">Name the bouts behind every number: the opponents, champions, divisions and prices a row is made of.</span>
            </span>
            <input
              type="checkbox"
              checked={showMoreInfo}
              onChange={(event) => setShowMoreInfo(event.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-zinc-300 accent-zinc-900"
            />
          </label>
          <label className="flex cursor-pointer items-start justify-between gap-4 px-4 py-2.5 text-zinc-700 transition-colors hover:bg-zinc-50">
            <span>
              <span className="block text-xs font-medium">Keep full lists</span>
              <span className="mt-0.5 block text-[10px] font-normal leading-4 text-zinc-400">Keep each complete leaderboard visible and pin selected fighters above it in the order they were added.</span>
            </span>
            <input
              type="checkbox"
              checked={keepFullLists}
              onChange={(event) => setKeepFullLists(event.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-zinc-300 accent-zinc-900"
            />
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-4 px-4 py-2.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50">
            Include women
            <input
              type="checkbox"
              checked={includeWomen}
              onChange={(event) => {
                const checked = event.target.checked;
                setIncludeWomen(checked);
                if (!checked && division.startsWith("Women's ")) setDivision("all");
              }}
              className="h-3.5 w-3.5 rounded border-zinc-300 accent-zinc-900"
            />
          </label>
          <label className="flex cursor-pointer items-start justify-between gap-4 px-4 py-2.5 text-zinc-700 transition-colors hover:bg-zinc-50">
            <span>
              <span className="block text-xs font-medium">Include inactive fighters</span>
              <span className="mt-0.5 block text-[10px] font-normal leading-4 text-zinc-400">Turn off to show only fighters who competed in the past 2 years or have a bout booked.</span>
            </span>
            <input
              type="checkbox"
              checked={includeInactiveFighters}
              onChange={(event) => setIncludeInactiveFighters(event.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-zinc-300 accent-zinc-900"
            />
          </label>
        </div>
      </div>
    </details>
  );
}

function SelectedFighterStrip({ fighters, keepFullLists, onChange }: {
  fighters: PickedFighter[];
  keepFullLists: boolean;
  onChange: (fighters: PickedFighter[]) => void;
}) {
  if (!fighters.length) return null;
  return (
    <section className={`${shell} mb-3 px-3 py-2.5`} aria-label="Selected fighters">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-1">
        <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-400">Selected fighters</span>
        <span className="text-[9px] text-zinc-400">
          {keepFullLists ? "Pinned in this order above each full leaderboard." : "Only these fighters appear in each leaderboard."}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {fighters.map((fighter, index) => (
          <span key={fighter.id} className="flex h-8 max-w-full items-center gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 py-0.5 pl-1 pr-1 text-[10px] font-medium text-zinc-700">
            <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-zinc-200 text-[8px] font-bold tabular-nums text-zinc-500">{index + 1}</span>
            <Avatar src={fighter.photo_url} name={fighter.name} size="xs" />
            <span className="max-w-44 truncate" title={fighter.name}>{fighter.name}</span>
            <button
              type="button"
              aria-label={`Remove ${fighter.name}`}
              onClick={() => onChange(fighters.filter((current) => current.id !== fighter.id))}
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-sm text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-900"
            >
              ×
            </button>
          </span>
        ))}
      </div>
    </section>
  );
}

export default function StatsPage() {
  const [division, setDivision] = useHistoryState("stats:division", "all");
  const [includeWomen, setIncludeWomen] = useHistoryState("stats:include-women", false);
  const [includeInactiveFighters, setIncludeInactiveFighters] = useHistoryState("stats:include-inactive-fighters", true);
  const [showMoreInfo, setShowMoreInfo] = useHistoryState("stats:show-more-info", false);
  const [keepFullLists, setKeepFullLists] = useHistoryState("stats:keep-full-lists", false);
  const [settings, setSettings] = useHistoryState<StatsSettings>("stats:settings", DEFAULT_SETTINGS);
  const [selectedFighters, setSelectedFighters] = useHistoryState<PickedFighter[]>("stats:fighters", []);
  const [pinnedBoards, setPinnedBoards] = useState<string[]>(loadPinnedBoards);
  const [resetTurns, setResetTurns] = useState(0);

  useEffect(() => {
    try {
      window.localStorage.setItem(PINNED_BOARDS_KEY, JSON.stringify(pinnedBoards));
    } catch {
      // Pinning still works for this session when storage is unavailable.
    }
  }, [pinnedBoards]);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (division !== "all") params.set("division", division);
    if (includeWomen) params.set("includeWomen", "1");
    if (!includeInactiveFighters) params.set("includeInactiveFighters", "0");
    if (showMoreInfo) params.set("moreInfo", "1");
    if (keepFullLists) params.set("keepFullLists", "1");
    for (const [key, value] of Object.entries(settings)) params.set(key, value);
    if (selectedFighters.length) params.set("fighterIds", selectedFighters.map((fighter) => fighter.id).join(","));
    return params.toString();
  }, [division, includeWomen, includeInactiveFighters, showMoreInfo, keepFullLists, selectedFighters, settings]);

  const { data, loading, error } = useApi<StatsDashboard>(`/api/stats?${query}`, 5 * 60_000);
  const [displayed, setDisplayed] = useState<StatsDashboard | null>(null);
  useEffect(() => {
    if (data) setDisplayed(data);
  }, [data]);
  const dashboard = data ?? displayed;

  const orderedBoards = useMemo(() => {
    if (!dashboard) return [];
    const pinned = new Set(pinnedBoards);
    return dashboard.leaderboards
      .map((board, index) => ({ board, index }))
      .sort((a, b) => Number(pinned.has(b.board.key)) - Number(pinned.has(a.board.key)) || a.index - b.index)
      .map(({ board }) => board);
  }, [dashboard, pinnedBoards]);
  const pinnedFighterIds = useMemo(
    () => keepFullLists ? new Set(selectedFighters.map((fighter) => fighter.id)) : new Set<string>(),
    [keepFullLists, selectedFighters],
  );

  const pageScroll = useRouteScrollRestoration<HTMLDivElement>("stats:page", Boolean(dashboard));
  useSeo({
    title: "UFC Statistics & Leaderboards",
    description: "Configurable UFC leaderboards for records, finishing, output, context and the betting market.",
    path: "/stats",
  });

  const update: Update = (key, value) => setSettings((current) => ({ ...current, [key]: value }));
  const togglePinnedBoard = (key: string) => {
    setPinnedBoards((current) => (current.includes(key) ? current.filter((pinned) => pinned !== key) : [...current, key]));
  };
  const reset = () => {
    setDivision("all");
    setIncludeWomen(false);
    setIncludeInactiveFighters(true);
    setShowMoreInfo(false);
    setKeepFullLists(false);
    setSettings({ ...DEFAULT_SETTINGS });
    setSelectedFighters([]);
    setResetTurns((turns) => turns + 1);
  };

  if (loading && !dashboard) return <div className="flex h-full items-center justify-center text-sm text-zinc-400">Calculating rankings…</div>;
  if (!dashboard) return <div className="flex h-full items-center justify-center text-sm text-zinc-400">{error ? "Statistics are not available." : "No statistics yet."}</div>;

  return (
    <div ref={pageScroll} className="h-full overflow-y-auto">
      <main className="mx-auto max-w-[100rem] p-3 pb-8">
        <section className={`${shell} relative z-30 mb-3 flex h-14 items-center gap-3 px-4`}>
          <StatsModeSwitch />
          <div className="min-w-24 flex-1 sm:max-w-md">
            <FighterSearch
              selected={selectedFighters}
              showSelected={false}
              emptyPlaceholder="Search fighters to compare across every card"
              onChange={(fighters) => {
                setSelectedFighters(fighters);
                if (fighters.length) setDivision("all");
              }}
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className={`text-[10px] font-medium text-zinc-400 ${loading ? "visible" : "invisible"}`} role="status" aria-hidden={!loading}>Updating…</span>
            <FiltersMenu
              years={dashboard.years}
              divisions={dashboard.divisions}
              settings={settings}
              update={update}
              includeWomen={includeWomen}
              setIncludeWomen={setIncludeWomen}
              includeInactiveFighters={includeInactiveFighters}
              setIncludeInactiveFighters={setIncludeInactiveFighters}
              showMoreInfo={showMoreInfo}
              setShowMoreInfo={setShowMoreInfo}
              keepFullLists={keepFullLists}
              setKeepFullLists={setKeepFullLists}
              division={division}
              setDivision={setDivision}
            />
            <button
              type="button"
              onClick={reset}
              aria-label="Reset all statistics filters"
              title="Reset all filters"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-zinc-200 bg-white text-zinc-500 transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
            >
              <RotateCcw
                className="h-3.5 w-3.5 transition-transform duration-500 ease-out"
                style={{ transform: `rotate(${-resetTurns * 360}deg)` }}
                aria-hidden="true"
              />
            </button>
          </div>
        </section>

        <SelectedFighterStrip fighters={selectedFighters} keepFullLists={keepFullLists} onChange={setSelectedFighters} />

        <p className="mb-3 px-1 text-[11px] text-zinc-500">
          {selectedFighters.length
            ? keepFullLists
              ? `Pinned ${selectedFighters.length === 1 ? selectedFighters[0].name : `${selectedFighters.length} selected fighters`} above every complete list, with their rank among everyone who qualifies.`
              : `Showing ${selectedFighters.length === 1 ? selectedFighters[0].name : `${selectedFighters.length} selected fighters`} on every card, each with the rank they hold among everyone who qualifies.`
            : `${dashboard.coverage.fighters.toLocaleString("en-US")} fighters across ${dashboard.coverage.fights.toLocaleString("en-US")} bouts match these filters. Each card lists its top ${dashboard.limit}.`}
        </p>

        <div className={`grid grid-cols-1 gap-3 transition-opacity md:grid-cols-4 xl:grid-cols-6 ${loading ? "opacity-70" : ""}`}>
          {orderedBoards.map((board, index) => (
            <Leaderboard
              key={board.key}
              className={`md:col-span-2 xl:col-span-2 ${index === 3 ? "xl:col-start-2" : ""} ${index === 4 ? "md:col-start-2 xl:col-start-auto" : ""}`}
              board={board}
              settings={settings}
              update={update}
              pinned={pinnedBoards.includes(board.key)}
              onTogglePin={() => togglePinnedBoard(board.key)}
              fighterSelected={selectedFighters.length > 0}
              pinnedFighterIds={pinnedFighterIds}
              division={division}
            />
          ))}
        </div>
      </main>
    </div>
  );
}
