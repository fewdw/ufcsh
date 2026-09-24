import { useAuth } from "@clerk/react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { removeBet, signedMoney, type Bet, type BetState, type ProfileBets as BetsData } from "../bets";
import { formatDateShortWithYear } from "../format";
import { ConfirmRemove, RemoveX } from "./ConfirmRemove";
import { PANEL_SHELL, PanelHeading } from "./FightStats";
import { fetchPage, LIST_META, LIST_ROW, LIST_ROW_END, LIST_TITLE, LIST_VALUE, LoadMore, useInfiniteList } from "./InfiniteList";

const STATE_TEXT: Record<BetState, string> = { won: "text-emerald-600", lost: "text-rose-600", pending: "text-zinc-500", void: "text-zinc-400" };
const LEG_DOT: Record<BetState, string> = { won: "bg-emerald-500", lost: "bg-rose-500", pending: "bg-zinc-300", void: "bg-zinc-200" };
const LEG_LABEL: Record<BetState, string> = { won: "Won", lost: "Lost", pending: "Pending", void: "Void" };

function Stat({ label, value, tone = "text-zinc-900" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className={`truncate text-sm font-semibold tabular-nums sm:text-base ${tone}`}>{value}</p>
      <p className="truncate text-[10px] font-medium uppercase tracking-wide text-zinc-400">{label}</p>
    </div>
  );
}

const money = (value: number) => `$${value.toFixed(2)}`;

function BetRow({ bet, mine, onRemove }: { bet: Bet; mine: boolean; onRemove: () => void }) {
  const parlay = bet.legs.length > 1;
  // An open bet needs no label: it simply has no result yet.
  const result = bet.state === "pending" ? null : bet.state === "void" ? "Void" : signedMoney(bet.net);
  const removable = mine && bet.removable;
  return (
    <li className={`relative ${LIST_ROW} ${LIST_ROW_END(removable)}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`truncate ${LIST_TITLE}`}>{parlay ? `Parlay · ${bet.legs.length} legs` : bet.legs[0].selection}</p>
          <p className={`tabular-nums ${LIST_META}`}>
            {money(bet.stake)} at {bet.price} · pays {money(bet.payout)} · {formatDateShortWithYear(new Date(bet.placedAt).toISOString().slice(0, 10))}
          </p>
        </div>
        {result ? <span className={`${LIST_VALUE} ${STATE_TEXT[bet.state]}`}>{result}</span> : null}
      </div>
      <ul className={`mt-1.5 flex flex-col gap-1 ${parlay ? "border-l border-zinc-100 pl-3" : ""}`}>
        {bet.legs.map((leg, index) => (
          <li key={index}>
            <Link to={`/fights/${leg.fightId}`} className="group flex items-center gap-2 text-[13px] leading-5">
              <span aria-label={LEG_LABEL[leg.state]} title={LEG_LABEL[leg.state]} className={`h-2 w-2 shrink-0 rounded-full ${LEG_DOT[leg.state]}`} />
              <span className="min-w-0 flex-1 truncate text-zinc-600 group-hover:text-zinc-900">
                {parlay ? <span className="font-medium text-zinc-800">{leg.selection} · </span> : null}
                {leg.f1Name} vs {leg.f2Name}
                <span className="text-zinc-400"> · {leg.market}</span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-zinc-700">{leg.price}</span>
            </Link>
          </li>
        ))}
      </ul>
      {removable ? <RemoveX large label="Remove bet" onClick={onRemove} /> : null}
    </li>
  );
}

/** Every bet a fan has put on their profile, settled against the official
 *  result, with the running profit or loss of a flat $1–$20 stake per bet. */
export default function ProfileBets({ handle, mine }: { handle: string; mine: boolean }) {
  const [confirming, setConfirming] = useState<Bet | null>(null);
  const [busy, setBusy] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const { getToken } = useAuth();
  const list = useInfiniteList({
    resetKey: handle,
    load: offset => fetchPage<BetsData>(`/api/profiles/${encodeURIComponent(handle)}/bets?offset=${offset}`, {}, "Bets could not be loaded."),
    items: page => page.bets,
    itemKey: bet => bet.id,
    refreshMs: 30_000,
  });
  const remove = async (id: string) => {
    if (busy) return;
    setBusy(true); setRemoveError("");
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session expired. Sign in again.");
      await removeBet(token, id);
      setConfirming(null);
    } catch (problem) {
      setRemoveError(problem instanceof Error ? problem.message : "That bet could not be removed.");
    } finally {
      setBusy(false);
      void list.reload();
    }
  };
  const data = list.first;
  if (!data) return <section className={`${PANEL_SHELL} p-5 text-sm text-zinc-500`} role="status">
    {list.error ? <>{list.error} <button className="underline" onClick={() => void list.retry()}>Retry</button></> : "Loading bets…"}
  </section>;
  const { totals } = data;
  const tone = totals.net > 0 ? "text-emerald-600" : totals.net < 0 ? "text-rose-600" : "text-zinc-900";
  return <>
    <section className={PANEL_SHELL}>
      <PanelHeading title="Betting record"
        subtitle={`${data.total.toLocaleString()} ${data.total === 1 ? "bet" : "bets"} · $${data.maxStake} max`}
        aside={<span className={`whitespace-nowrap text-sm font-semibold tabular-nums ${tone}`} title="Profit / loss">{signedMoney(totals.net)}</span>} />
      <div className="grid grid-cols-5 gap-2 px-4 py-2.5 sm:gap-4 sm:px-5 sm:py-3">
        <Stat label="Won" value={totals.won.toLocaleString()} tone="text-emerald-600" />
        <Stat label="Lost" value={totals.lost.toLocaleString()} tone="text-rose-600" />
        <Stat label="Pending" value={totals.pending.toLocaleString()} />
        <Stat label="Staked" value={money(totals.staked)} />
        <Stat label="At risk" value={money(totals.atRisk)} />
      </div>
    </section>

    <section className={`${PANEL_SHELL} overflow-hidden`}>
      <PanelHeading title="All bets" subtitle={data.total ? data.total.toLocaleString() : undefined} />
      {!data.total ? <p className="px-5 py-10 text-center text-sm text-zinc-500">
        {mine ? "You haven’t placed a bet yet. Click any price on an upcoming fight’s odds, then use Add to profile on your slip."
          : "This fan hasn’t placed any bets yet."}
      </p> : <ul className="divide-y divide-zinc-100">{list.items.map(bet => <BetRow key={bet.id} bet={bet} mine={mine}
        onRemove={() => { setConfirming(bet); setRemoveError(""); }} />)}</ul>}
      <LoadMore list={list} />
    </section>
    {confirming ? <ConfirmRemove
      title="Remove this bet?"
      detail={`${confirming.legs.length > 1 ? `Parlay · ${confirming.legs.length} legs` : confirming.legs[0].selection} · ${money(confirming.stake)} at ${confirming.price}`}
      busy={busy} error={removeError}
      onCancel={() => { setConfirming(null); setRemoveError(""); }}
      onConfirm={() => void remove(confirming.id)} /> : null}
  </>;
}
