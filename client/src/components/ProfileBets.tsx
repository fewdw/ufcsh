import { useAuth } from "@clerk/react";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { apiCache, useApi } from "../api";
import { removeBet, signedMoney, type Bet, type BetState, type ProfileBets as BetsData } from "../bets";
import { formatDateShortWithYear } from "../format";
import { PANEL_SHELL, PanelHeading } from "./FightStats";

const STATE_TEXT: Record<BetState, string> = { won: "text-emerald-600", lost: "text-rose-600", pending: "text-zinc-500", void: "text-zinc-400" };
const LEG_DOT: Record<BetState, string> = { won: "bg-emerald-500", lost: "bg-rose-500", pending: "bg-zinc-300", void: "bg-zinc-200" };
const LEG_LABEL: Record<BetState, string> = { won: "Won", lost: "Lost", pending: "Pending", void: "Void" };

function Stat({ label, value, tone = "text-zinc-900" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className={`truncate text-sm font-semibold tabular-nums ${tone}`}>{value}</p>
      <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">{label}</p>
    </div>
  );
}

const money = (value: number) => `$${value.toFixed(2)}`;

function BetRow({ bet, mine, confirming, busy, onConfirm, onCancel, onRemove }: {
  bet: Bet; mine: boolean; confirming: boolean; busy: boolean;
  onConfirm: () => void; onCancel: () => void; onRemove: () => void;
}) {
  const parlay = bet.legs.length > 1;
  const result = bet.state === "pending" ? "Pending" : bet.state === "void" ? "Void" : signedMoney(bet.net);
  return (
    <li className="px-4 py-3.5 sm:px-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-900">{parlay ? `Parlay · ${bet.legs.length} legs` : bet.legs[0].selection}</p>
          <p className="mt-0.5 text-xs tabular-nums text-zinc-500">
            {money(bet.stake)} at {bet.price} · pays {money(bet.payout)} · {formatDateShortWithYear(new Date(bet.placedAt).toISOString().slice(0, 10))}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`text-sm font-semibold tabular-nums ${STATE_TEXT[bet.state]}`}>{result}</span>
          {mine && bet.removable && !confirming ? (
            <button type="button" onClick={onConfirm} aria-label="Remove bet" title="Remove bet"
              className="grid h-7 w-7 place-items-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-rose-600">
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>
      <ul className={`mt-2 flex flex-col gap-1.5 ${parlay ? "border-l border-zinc-100 pl-3" : ""}`}>
        {bet.legs.map((leg, index) => (
          <li key={index}>
            <Link to={`/fights/${leg.fightId}`} className="group flex items-center gap-2 text-xs">
              <span aria-label={LEG_LABEL[leg.state]} title={LEG_LABEL[leg.state]} className={`h-1.5 w-1.5 shrink-0 rounded-full ${LEG_DOT[leg.state]}`} />
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
      {confirming ? <div className="mt-3 flex items-center justify-end gap-2 text-xs">
        <span className="mr-auto text-zinc-500">Remove this bet?</span>
        <button type="button" onClick={onCancel} disabled={busy} className="rounded-full px-3 py-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-40">Cancel</button>
        <button type="button" onClick={onRemove} disabled={busy} className="rounded-full bg-rose-600 px-3 py-1.5 font-medium text-white hover:bg-rose-700 disabled:opacity-40">
          {busy ? "Removing…" : "Remove"}
        </button>
      </div> : null}
    </li>
  );
}

/** Every bet a fan has put on their profile, settled against the official
 *  result, with the running profit or loss of a flat $1–$20 stake per bet. */
export default function ProfileBets({ handle, mine }: { handle: string; mine: boolean }) {
  const [offset, setOffset] = useState(0);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const { getToken } = useAuth();
  const pageUrl = (page: number) => `/api/profiles/${encodeURIComponent(handle)}/bets?offset=${page}`;
  const url = pageUrl(offset);
  const { data, error, retry } = useApi<BetsData>(url, 30_000);
  const goTo = (page: number) => {
    setOffset(page);
    void apiCache.loadAfterWrite(pageUrl(page));
  };
  const remove = async (id: string) => {
    if (busy) return;
    setBusy(true); setRemoveError("");
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session expired. Sign in again.");
      await removeBet(token, id);
      setConfirming(null);
      if (data?.bets.length === 1 && offset > 0) goTo(Math.max(0, offset - data.pageSize));
      else await apiCache.loadAfterWrite(url);
    } catch (problem) {
      setConfirming(null);
      setRemoveError(problem instanceof Error ? problem.message : "That bet could not be removed.");
      void apiCache.loadAfterWrite(url);
    } finally { setBusy(false); }
  };
  if (!data) return <section className={`${PANEL_SHELL} p-5 text-sm text-zinc-500`} role="status">
    {error ? <>{error} <button className="underline" onClick={retry}>Retry</button></> : "Loading bets…"}
  </section>;
  const { totals } = data;
  const tone = totals.net > 0 ? "text-emerald-600" : totals.net < 0 ? "text-rose-600" : "text-zinc-900";
  return <>
    <section className={PANEL_SHELL}>
      <PanelHeading title="Betting record"
        subtitle={`${data.total.toLocaleString()} ${data.total === 1 ? "bet" : "bets"} · up to $${data.maxStake} each`}
        aside={<span className="text-right">
          <span className={`block text-lg font-semibold tabular-nums ${tone}`}>{signedMoney(totals.net)}</span>
          <span className="block text-[10px] font-medium uppercase tracking-wide text-zinc-400">profit / loss</span>
        </span>} />
      <div className="grid grid-cols-3 gap-4 px-5 py-4 sm:grid-cols-5">
        <Stat label="Won" value={totals.won.toLocaleString()} tone="text-emerald-600" />
        <Stat label="Lost" value={totals.lost.toLocaleString()} tone="text-rose-600" />
        <Stat label="Pending" value={totals.pending.toLocaleString()} />
        <Stat label="Staked" value={money(totals.staked)} />
        <Stat label="At risk" value={money(totals.atRisk)} />
      </div>
    </section>

    <section className={`${PANEL_SHELL} overflow-hidden`}>
      <PanelHeading title="All bets" subtitle={data.total ? `${offset + 1}–${Math.min(offset + data.pageSize, data.total)} of ${data.total.toLocaleString()}` : undefined} />
      {removeError ? <p role="alert" className="px-5 pt-3 text-xs text-rose-600">{removeError}</p> : null}
      {!data.total ? <p className="px-5 py-10 text-center text-sm text-zinc-500">
        {mine ? "You haven’t placed a bet yet. Click any price on an upcoming fight’s odds, then use Add to profile on your slip."
          : "This fan hasn’t placed any bets yet."}
      </p> : <ul className="divide-y divide-zinc-100">{data.bets.map(bet => <BetRow key={bet.id} bet={bet} mine={mine}
        confirming={confirming === bet.id} busy={busy} onConfirm={() => { setConfirming(bet.id); setRemoveError(""); }}
        onCancel={() => setConfirming(null)} onRemove={() => void remove(bet.id)} />)}</ul>}
      {data.total > data.pageSize ? <div className="flex justify-between border-t border-zinc-100 px-5 py-3 text-xs text-zinc-600">
        <button disabled={offset === 0} onClick={() => goTo(Math.max(0, offset - data.pageSize))} className="rounded-full px-3 py-2 hover:bg-zinc-100 disabled:opacity-40">Newer</button>
        <button disabled={offset + data.pageSize >= data.total} onClick={() => goTo(offset + data.pageSize)} className="rounded-full px-3 py-2 hover:bg-zinc-100 disabled:opacity-40">Older</button>
      </div> : null}
    </section>
  </>;
}
