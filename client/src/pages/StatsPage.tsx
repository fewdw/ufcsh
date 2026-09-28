import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { RotateCcw, X } from "lucide-react";
import OptionsSheet, { SHEET_SELECT, SheetField, SwitchRow } from "../components/OptionsSheet";
import { useApi } from "../api";
import type { StatChip, StatsDashboard, StatsLeader } from "../api";
import Avatar from "../components/Avatar";
import FighterSearch, { type PickedFighter } from "../components/FighterSearch";
import RequestNotice from "../components/RequestNotice";
import { segmentedGroup, segmentedIdle, segmentedSelected } from "../components/segmented";
import { formatValue, PANEL } from "../components/chartTokens";
import { useSeo } from "../seo";
import { useHistoryState, useRouteScrollRestoration } from "../navigationState";
import { DEFAULT_SETTINGS, statsRequest, type Method, type Metric, type StatsSettings } from "../statsDefaults";

const shell = PANEL;
const selectClass = "max-w-full rounded-full border border-zinc-200 bg-zinc-50 py-1 pl-2.5 pr-7 text-[10px] font-medium text-zinc-700 outline-none transition hover:border-zinc-300 focus:border-zinc-400";

type Update = <K extends keyof StatsSettings>(key: K, value: StatsSettings[K]) => void;

function formatRank(rank: number | null, tied: boolean): string {
  if (rank == null) return "NR";
  return tied ? `T${rank}` : String(rank);
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
// Per-card controls. Six cards, each opening with one select that names the
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
        <>
          <Select label="Bouts statistic" value={settings.boutsMode} onChange={(value) => update("boutsMode", value as StatsSettings["boutsMode"])}>
            <optgroup label="Career">
              <option value="total">Most UFC bouts</option>
              <option value="span">Longest career span</option>
              <option value="divisions" disabled={divisionLocked}>Most divisions{divisionLocked ? " · all divisions only" : ""}</option>
            </optgroup>
            <optgroup label="Spotlight">
              <option value="titleFights">Most championship bouts</option>
              <option value="mainEvents">Most main events</option>
              <option value="bonuses">Most post-fight bonuses</option>
            </optgroup>
          </Select>
          {settings.boutsMode === "bonuses" ? (
            <>
              <Select label="Bonus" value={settings.bonusKind} onChange={(value) => update("bonusKind", value as StatsSettings["bonusKind"])}>
                <option value="all">Every bonus</option>
                <option value="performance">Performance of the Night</option>
                <option value="fotn">Fight of the Night</option>
              </Select>
              <Select label="Count or share" value={settings.bonusMetric} onChange={(value) => update("bonusMetric", value as Metric)}>
                <option value="total">Count</option>
                <option value="percent">% of bouts</option>
              </Select>
            </>
          ) : null}
        </>
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
              <Select label="Which opponents count" value={settings.oppositionScope} onChange={(value) => update("oppositionScope", value as StatsSettings["oppositionScope"])}>
                <option value="beaten">Opponents beaten</option>
                <option value="faced">Opponents faced</option>
              </Select>
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

      {boardKey === "fights" && settings.fightsGroup === "fights" ? (
        <>
          <Select label="Fights statistic" value={settings.fightsMode} onChange={(value) => update("fightsMode", value as StatsSettings["fightsMode"])}>
            <option value="disputed">Most disputed decisions</option>
            <option value="upsets">Biggest upsets</option>
            <option value="action">Most action</option>
            <option value="fastest">Fastest finishes</option>
          </Select>
          {settings.fightsMode === "action" ? (
            <Select label="Total or pace" value={settings.fightsAction} onChange={(value) => update("fightsAction", value as StatsSettings["fightsAction"])}>
              <option value="total">Total strikes</option>
              <option value="perMinute">Per minute</option>
            </Select>
          ) : null}
          {settings.fightsMode === "fastest" ? (
            <Select label="Finish method" value={settings.fastestMethod} onChange={(value) => update("fastestMethod", value as StatsSettings["fastestMethod"])}>
              <option value="finish">Any finish</option>
              <option value="ko">KO/TKO</option>
              <option value="sub">Submission</option>
            </Select>
          ) : null}
        </>
      ) : null}

      {boardKey === "fights" && settings.fightsGroup === "judges" ? (
        <>
          <Select label="Judges statistic" value={settings.judgesMode} onChange={(value) => update("judgesMode", value as StatsSettings["judgesMode"])}>
            <option value="agreement">Agreement with the panel</option>
            <option value="dissents">Lone dissents</option>
            <option value="splits">Split decisions judged</option>
            <option value="cards">Cards scored</option>
          </Select>
          {settings.judgesMode === "agreement" || settings.judgesMode === "dissents" ? (
            <Select label="Order" value={settings.officialsOrder} onChange={(value) => update("officialsOrder", value as StatsSettings["officialsOrder"])}>
              <option value="high">Highest first</option>
              <option value="low">Lowest first</option>
            </Select>
          ) : null}
        </>
      ) : null}

      {boardKey === "fights" && settings.fightsGroup === "referees" ? (
        <>
          <Select label="Referees statistic" value={settings.refereesMode} onChange={(value) => update("refereesMode", value as StatsSettings["refereesMode"])}>
            <option value="finishRate">Stoppage rate</option>
            <option value="stoppageTime">Average stoppage time</option>
            <option value="bouts">Bouts refereed</option>
          </Select>
          {settings.refereesMode !== "bouts" ? (
            <Select label="Order" value={settings.officialsOrder} onChange={(value) => update("officialsOrder", value as StatsSettings["officialsOrder"])}>
              <option value="high">{settings.refereesMode === "stoppageTime" ? "Earliest first" : "Highest first"}</option>
              <option value="low">{settings.refereesMode === "stoppageTime" ? "Latest first" : "Lowest first"}</option>
            </Select>
          ) : null}
        </>
      ) : null}
    </div>
  );
}


/** Cards whose statistic is picked in two steps: a group first, then a select. */
const GROUPS = {
  record: { key: "recordGroup", options: ["bouts", "wins", "losses"], label: "Bouts, wins or losses" },
  fights: { key: "fightsGroup", options: ["fights", "judges", "referees"], label: "Fights, judges or referees" },
} as const;

/** Formats a bar can honestly stand behind: magnitudes that start at zero. */
const BARRED = new Set(["number", "percent", "decimal", "years"]);

const initials = (name: string) => name.split(" ").filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase();

/** A fighter's photo (a bout's winner), or an official's initials. */
function RowPortrait({ row }: { row: StatsLeader }) {
  if (row.href && !row.opponent) {
    return <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-zinc-100 text-[9px] font-semibold text-zinc-500" aria-hidden="true">{initials(row.name)}</span>;
  }
  return <span className="shrink-0"><Avatar src={row.photo_url} name={row.name} size="xs" /></span>;
}

function Leaderboard({
  board,
  settings,
  update,
  fighterSelected,
  pinnedFighterIds,
  division,
}: {
  board: StatsDashboard["leaderboards"][number];
  settings: StatsSettings;
  update: Update;
  fighterSelected: boolean;
  pinnedFighterIds: ReadonlySet<string>;
  division: string;
}) {
  const rowsScroll = useRouteScrollRestoration<HTMLDivElement>(`stats-board:${board.key}`);
  const group = board.key in GROUPS ? GROUPS[board.key as keyof typeof GROUPS] : null;
  // A bar under each row, scaled to 100% or to the leader, wherever the list
  // runs from most to least of something that starts at zero.
  const values = board.rows.map((row) => row.value);
  const barred = BARRED.has(board.format) && values.length > 1 && values.every((value) => value >= 0) && values[0] >= values[values.length - 1];
  const scale = board.format === "percent" ? 100 : Math.max(...values, 0);
  return (
    // Three rows — title with its definition, controls, list — shared through subgrid
    // with every card on the same line of the grid: each header row takes the
    // height of the tallest card beside it, so titles, definitions, controls
    // and the first ranked row all line up without reserving empty space.
    <section className={`${shell} row-span-3 grid min-w-0 grid-rows-subgrid gap-0 overflow-hidden`}>
      <div className="px-4 pb-1 pt-3.5" title={board.description}>
        {group ? (
          <div className={`${segmentedGroup} inline-flex`} role="group" aria-label={group.label}>
            {group.options.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={settings[group.key] === option}
                onClick={() => update(group.key, option as never)}
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize transition ${settings[group.key] === option ? segmentedSelected : segmentedIdle}`}
              >
                {option}
              </button>
            ))}
          </div>
        ) : (
          <h2 className="text-[15px] font-semibold leading-6 text-zinc-950">{board.title}</h2>
        )}
        <p className="mt-1 text-[11px] leading-4 text-zinc-400">{board.description}</p>
      </div>
      <div className="border-b border-zinc-100 px-4 pb-3">
        <CardControls boardKey={board.key} settings={settings} update={update} division={division} />
      </div>
      <div ref={rowsScroll} className="h-[30rem] min-h-0 divide-y divide-zinc-100 overflow-y-auto">
        {board.rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-zinc-400">
            {fighterSelected ? "None of the selected fighters qualify for this statistic." : "Nothing matches these filters."}
          </div>
        ) : null}
        {board.rows.map((row, index) => {
          const pinned = !row.href && pinnedFighterIds.has(row.fighter_id);
          const podium = row.rank != null && row.rank <= 3;
          return (
          <Link
            key={`${row.href ?? row.fighter_id}-${index}`}
            to={row.href ?? `/fighters/${row.fighter_id}`}
            className={`grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-start gap-x-2.5 px-3 py-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-900 ${pinned ? "bg-zinc-100/90 hover:bg-zinc-200/80" : "hover:bg-zinc-50"}`}
          >
            <span
              className={`mt-0.5 flex h-5 min-w-7 shrink-0 items-center justify-center rounded-full px-1 text-[11px] font-semibold tabular-nums ${podium ? "bg-zinc-100 text-zinc-900" : "text-zinc-400"}`}
              title={row.rank == null ? "Not ranked for these filters" : row.tied ? `Tied at rank ${row.rank}` : `Rank ${row.rank}`}
            >
              {formatRank(row.rank, row.tied)}
            </span>
            <RowPortrait row={row} />
            <span className="min-w-0 flex-1">
              <span className="block min-w-0 text-sm leading-5 text-zinc-900">
                <span className="font-medium">{row.name}</span>
                {row.opponent ? <> <span className="text-xs text-zinc-400">{row.opponent.verb}</span> <span className="font-medium text-zinc-600">{row.opponent.name}</span></> : null}
                {pinned ? <span className="ml-1.5 rounded bg-zinc-200 px-1 py-px align-middle text-[7px] font-bold uppercase tracking-wider text-zinc-500">Pinned</span> : null}
              </span>
              <span className="block text-[10px] leading-[1.35] text-zinc-400">
                {[row.division, row.detail].filter(Boolean).join(" · ")}
              </span>
              <Chips chips={row.chips ?? []} />
            </span>
            <span className="pt-0.5 text-right text-sm font-semibold tabular-nums text-zinc-950">
              {formatValue(row.value, board.format)}
            </span>
            {/* Under the name and the number alike, so every track is one length. */}
            {barred ? (
              <span className="col-span-2 col-start-3 mt-1 block h-1 overflow-hidden rounded-full bg-zinc-100" aria-hidden="true">
                <span className={`block h-full rounded-full ${podium ? "bg-zinc-400" : "bg-zinc-300"}`} style={{ width: `${scale > 0 ? Math.max(2, Math.min(100, (row.value / scale) * 100)) : 0}%` }} />
              </span>
            ) : null}
          </Link>
          );
        })}
      </div>
    </section>
  );
}

const ROW_COUNTS = Array.from({ length: 15 }, (_, index) => String((index + 1) * 10));

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
  count,
  onReset,
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
  count: number;
  onReset: () => void;
}) {
  return (
    <OptionsSheet label="Filters" count={count || null} onReset={onReset} iconOnlyOnPhone>
      <p className="px-4 pb-2 text-[11px] text-zinc-400">Applies to every card.</p>
      <div className="grid grid-cols-2 gap-x-2 gap-y-2.5 border-b border-zinc-100 px-4 pb-3">
        <SheetField label="From">
          <select aria-label="Starting year" value={settings.statsSince} onChange={(event) => update("statsSince", event.target.value)} className={SHEET_SELECT}>
            <option value="all">First event</option>
            {years.map((yearValue) => <option key={yearValue} value={yearValue}>{yearValue}</option>)}
          </select>
        </SheetField>
        <SheetField label="To">
          <select aria-label="Ending year" value={settings.statsUntil} onChange={(event) => update("statsUntil", event.target.value)} className={SHEET_SELECT}>
            <option value="all">Latest event</option>
            {years.map((yearValue) => <option key={yearValue} value={yearValue}>{yearValue}</option>)}
          </select>
        </SheetField>
        <SheetField label="Bout type">
          <select value={settings.boutType} onChange={(event) => update("boutType", event.target.value as StatsSettings["boutType"])} className={SHEET_SELECT}>
            <option value="all">All bouts</option>
            <option value="title">Championship only</option>
            <option value="nonTitle">Exclude championship</option>
          </select>
        </SheetField>
        <SheetField label="Card position">
          <select value={settings.cardPosition} onChange={(event) => update("cardPosition", event.target.value as StatsSettings["cardPosition"])} className={SHEET_SELECT}>
            <option value="all">Whole card</option>
            <option value="main">Main events</option>
            <option value="undercard">Undercard</option>
          </select>
        </SheetField>
        <SheetField label="Scheduled length">
          <select value={settings.scheduledRounds} onChange={(event) => update("scheduledRounds", event.target.value as StatsSettings["scheduledRounds"])} className={SHEET_SELECT}>
            <option value="all">Any length</option>
            <option value="3">3-round bouts</option>
            <option value="5">5-round bouts</option>
          </select>
        </SheetField>
        <SheetField label="Division">
          <select value={division} onChange={(event) => setDivision(event.target.value)} className={SHEET_SELECT}>
            <option value="all">All divisions</option>
            {divisions.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </SheetField>
        <SheetField label="Minimum UFC bouts">
          <select title="Career UFC bouts a fighter needs to appear at all" value={settings.minimumFights} onChange={(event) => update("minimumFights", event.target.value as StatsSettings["minimumFights"])} className={SHEET_SELECT}>
            {["1", "3", "5", "10", "15", "20"].map((count) => <option key={count} value={count}>{count}+</option>)}
          </select>
        </SheetField>
        <SheetField label="Minimum sample">
          <select title="Qualifying attempts a rate needs before it is ranked, so a one-for-one record cannot top a percentage board" value={settings.minimumSample} onChange={(event) => update("minimumSample", event.target.value as StatsSettings["minimumSample"])} className={SHEET_SELECT}>
            {["1", "3", "5", "10", "15"].map((count) => <option key={count} value={count}>{count}+</option>)}
          </select>
        </SheetField>
        <SheetField label="Fighters per chart">
          <select value={settings.limit} onChange={(event) => update("limit", event.target.value)} className={SHEET_SELECT}>
            {ROW_COUNTS.map((count) => <option key={count} value={count}>{count}</option>)}
          </select>
        </SheetField>
      </div>
      <div className="px-1.5 py-1">
        <SwitchRow label="Show more info" hint="Name the bouts behind every number" on={showMoreInfo} onChange={setShowMoreInfo} />
        <SwitchRow label="Keep full lists" hint="Pin selected fighters above each full list" on={keepFullLists} onChange={setKeepFullLists} />
        <SwitchRow label="Include women" on={includeWomen} onChange={(on) => {
          setIncludeWomen(on);
          if (!on && division.startsWith("Women's ")) setDivision("all");
        }} />
        <SwitchRow label="Include inactive fighters" hint="Off: only fought in 2 years or booked" on={includeInactiveFighters} onChange={setIncludeInactiveFighters} />
      </div>
    </OptionsSheet>
  );
}

type ActiveFilter = { key: string; label: string; clear: () => void };

/** A filter or a picked fighter shown above the cards, removable in one press. */
function FilterChip({ label, onClear, children }: { label: string; onClear: () => void; children?: React.ReactNode }) {
  return (
    <span className="flex h-7 max-w-full items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 pl-1 pr-0.5 text-[11px] font-medium text-zinc-700">
      {children ?? <span className="w-1.5 shrink-0" />}
      <span className="truncate">{label}</span>
      <button
        type="button"
        aria-label={`Remove ${label}`}
        onClick={onClear}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-900"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </span>
  );
}

export default function StatsPage() {
  const [division, setDivision] = useHistoryState("stats:division", "all");
  const [includeWomen, setIncludeWomen] = useHistoryState("stats:include-women", false);
  const [includeInactiveFighters, setIncludeInactiveFighters] = useHistoryState("stats:include-inactive-fighters", true);
  const [showMoreInfo, setShowMoreInfo] = useHistoryState("stats:show-more-info", false);
  const [keepFullLists, setKeepFullLists] = useHistoryState("stats:keep-full-lists", true);
  const [settings, setSettings] = useHistoryState<StatsSettings>("stats:settings", DEFAULT_SETTINGS);
  const [selectedFighters, setSelectedFighters] = useHistoryState<PickedFighter[]>("stats:fighters", []);
  const [resetTurns, setResetTurns] = useState(0);

  const request = useMemo(() => statsRequest({
    division, includeWomen, includeInactiveFighters, showMoreInfo, keepFullLists, settings,
    fighterIds: selectedFighters.map((fighter) => fighter.id),
  }), [division, includeWomen, includeInactiveFighters, showMoreInfo, keepFullLists, selectedFighters, settings]);

  const { data, loading, error, retry } = useApi<StatsDashboard>(request, 5 * 60_000);
  const [displayed, setDisplayed] = useState<StatsDashboard | null>(null);
  useEffect(() => {
    if (data) setDisplayed(data);
  }, [data]);
  const dashboard = data ?? displayed;

  // The cards keep the one order they are defined in: it is what makes
  // "the third card is Output" true of every visit and every reader.
  const orderedBoards = dashboard?.leaderboards ?? [];
  const pinnedFighterIds = useMemo(
    () => keepFullLists ? new Set(selectedFighters.map((fighter) => fighter.id)) : new Set<string>(),
    [keepFullLists, selectedFighters],
  );

  const pageScroll = useRouteScrollRestoration<HTMLDivElement>("stats:page", Boolean(dashboard));
  useSeo({
    title: "UFC Statistics & Leaderboards",
    description: "Configurable UFC leaderboards for records, finishing, output, context, the betting market, and the fights, judges and referees themselves.",
    path: "/stats",
  });

  const update: Update = (key, value) => setSettings((current) => ({ ...current, [key]: value }));
  // A statistic that compares divisions has nothing to compare inside one.
  const pickDivision = (next: string) => {
    setDivision(next);
    if (next === "all") return;
    if (settings.winsMode === "divisions") update("winsMode", "total");
    if (settings.lossesMode === "divisions") update("lossesMode", "total");
    if (settings.boutsMode === "divisions") update("boutsMode", "total");
  };
  const reset = () => {
    setDivision("all");
    setIncludeWomen(false);
    setIncludeInactiveFighters(true);
    setShowMoreInfo(false);
    setKeepFullLists(true);
    setSettings({ ...DEFAULT_SETTINGS });
    setSelectedFighters([]);
    setResetTurns((turns) => turns + 1);
  };

  // Every filter away from its default, named, so what shapes the cards is
  // always in view and each can be dropped without opening the sheet.
  const { statsSince: since, statsUntil: until } = settings;
  const active: ActiveFilter[] = [];
  if (since !== "all" || until !== "all") {
    active.push({
      key: "years",
      label: since === "all" ? `Until ${until}` : until === "all" ? `Since ${since}` : since === until ? since : `${since}–${until}`,
      clear: () => { update("statsSince", "all"); update("statsUntil", "all"); },
    });
  }
  if (division !== "all") active.push({ key: "division", label: division, clear: () => setDivision("all") });
  if (settings.boutType !== "all") active.push({ key: "boutType", label: settings.boutType === "title" ? "Championship bouts" : "No championship bouts", clear: () => update("boutType", "all") });
  if (settings.cardPosition !== "all") active.push({ key: "cardPosition", label: settings.cardPosition === "main" ? "Main events" : "Undercard", clear: () => update("cardPosition", "all") });
  if (settings.scheduledRounds !== "all") active.push({ key: "rounds", label: `${settings.scheduledRounds}-round bouts`, clear: () => update("scheduledRounds", "all") });
  if (settings.minimumFights !== DEFAULT_SETTINGS.minimumFights) active.push({ key: "minimumFights", label: `${settings.minimumFights}+ UFC bouts`, clear: () => update("minimumFights", DEFAULT_SETTINGS.minimumFights) });
  if (settings.minimumSample !== DEFAULT_SETTINGS.minimumSample) active.push({ key: "minimumSample", label: `Sample ${settings.minimumSample}+`, clear: () => update("minimumSample", DEFAULT_SETTINGS.minimumSample) });
  if (settings.limit !== DEFAULT_SETTINGS.limit) active.push({ key: "limit", label: `${settings.limit} per card`, clear: () => update("limit", DEFAULT_SETTINGS.limit) });
  if (includeWomen) active.push({ key: "women", label: "Women included", clear: () => { setIncludeWomen(false); if (division.startsWith("Women's ")) setDivision("all"); } });
  if (!includeInactiveFighters) active.push({ key: "active", label: "Active fighters only", clear: () => setIncludeInactiveFighters(true) });
  if (showMoreInfo) active.push({ key: "moreInfo", label: "More info", clear: () => setShowMoreInfo(false) });
  if (!keepFullLists) active.push({ key: "fullLists", label: "Picked fighters only", clear: () => setKeepFullLists(true) });

  if (loading && !dashboard) return <div role="status" className="appear-late flex h-full items-center justify-center text-sm text-zinc-400">Calculating rankings…</div>;
  if (!dashboard) return <div className="flex h-full items-center justify-center p-4 text-sm text-zinc-400">{error ? <RequestNotice onRetry={retry}>Couldn’t load statistics.</RequestNotice> : "No statistics yet."}</div>;

  return (
    <div ref={pageScroll} className="h-full overflow-y-auto">
      <main className="mx-auto max-w-[100rem] p-2 pb-8 sm:p-3">
        <section className={`${shell} relative z-30 mb-2 px-2.5 py-2 sm:mb-3 sm:px-3`}>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 sm:max-w-80">
              <FighterSearch
                selected={selectedFighters}
                showSelected={false}
                emptyPlaceholder="Compare fighters…"
                onChange={(fighters) => {
                  setSelectedFighters(fighters);
                  if (fighters.length) setDivision("all");
                }}
              />
            </div>
            <div className="flex shrink-0 items-center gap-1.5 sm:ml-auto sm:gap-2">
              <span className={`text-[10px] font-medium text-zinc-400 max-sm:sr-only ${loading ? "visible" : "invisible"}`} role="status" aria-hidden={!loading}>Updating…</span>
              <select
                aria-label="Division"
                value={division}
                onChange={(event) => pickDivision(event.target.value)}
                className="hidden h-8 max-w-44 rounded-full border border-zinc-200 bg-white pl-3 pr-7 text-xs font-medium text-zinc-700 outline-none transition hover:border-zinc-300 hover:bg-zinc-50 focus:border-zinc-400 sm:block"
              >
                <option value="all">All divisions</option>
                {dashboard.divisions.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
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
                setDivision={pickDivision}
                count={active.length}
                onReset={reset}
              />
              <button
                type="button"
                onClick={reset}
                aria-label="Reset all statistics filters"
                title="Reset all filters"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-zinc-200 bg-white text-zinc-500 transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
              >
                <RotateCcw
                  className="h-3.5 w-3.5 transition-transform duration-500 ease-out"
                  style={{ transform: `rotate(${-resetTurns * 360}deg)` }}
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>
          {selectedFighters.length || active.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5 border-t border-zinc-100 pt-2" aria-label="Selected fighters and filters">
              {selectedFighters.map((fighter) => (
                <FilterChip key={fighter.id} label={fighter.name} onClear={() => setSelectedFighters(selectedFighters.filter((current) => current.id !== fighter.id))}>
                  <Avatar src={fighter.photo_url} name={fighter.name} size="xs" />
                </FilterChip>
              ))}
              {active.map((filter) => <FilterChip key={filter.key} label={filter.label} onClear={filter.clear} />)}
            </div>
          ) : null}
        </section>

        {error ? <div className="mb-3"><RequestNotice onRetry={retry}>Couldn’t update statistics. The last successful results are shown.</RequestNotice></div> : null}

        <div aria-busy={loading} className={`grid grid-cols-1 gap-3 transition-opacity lg:grid-cols-2 xl:grid-cols-3 ${loading || error ? "opacity-70 delay-200" : ""}`}>
          {orderedBoards.map((board) => (
            <Leaderboard
              key={board.key}
              board={board}
              settings={settings}
              update={update}
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
