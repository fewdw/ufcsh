import { useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../api";
import { signedMoney, type Bet, type BetState, type ProfileBets as BetsData } from "../bets";
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

function BetRow({ bet }: { bet: Bet }) {
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
        <span className={`shrink-0 text-sm font-semibold tabular-nums ${STATE_TEXT[bet.state]}`}>{result}</span>
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
    </li>
  );
}

/** Every bet a fan has put on their profile, settled against the official
 *  result, with the running profit or loss of a flat $1–$20 stake per bet. */
export default function ProfileBets({ handle, mine }: { handle: string; mine: boolean }) {
  const [offset, setOffset] = useState(0);
  const { data, error, retry } = useApi<BetsData>(`/api/profiles/${encodeURIComponent(handle)}/bets?offset=${offset}`, 30_000);
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
      {!data.total ? <p className="px-5 py-10 text-center text-sm text-zinc-500">
        {mine ? "You haven’t placed a bet yet. Click any price on an upcoming fight’s odds, then use Add to profile on your slip."
          : "This fan hasn’t placed any bets yet."}
      </p> : <ul className="divide-y divide-zinc-100">{data.bets.map(bet => <BetRow key={bet.id} bet={bet} />)}</ul>}
      {data.total > data.pageSize ? <div className="flex justify-between border-t border-zinc-100 px-5 py-3 text-xs text-zinc-600">
        <button disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - data.pageSize))} className="rounded-full px-3 py-2 hover:bg-zinc-100 disabled:opacity-40">Newer</button>
        <button disabled={offset + data.pageSize >= data.total} onClick={() => setOffset(value => value + data.pageSize)} className="rounded-full px-3 py-2 hover:bg-zinc-100 disabled:opacity-40">Older</button>
      </div> : null}
    </section>
  </>;
}
