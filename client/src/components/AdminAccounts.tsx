import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAdminResource } from "../admin";
import { normalizeSearch, relativeAge } from "../format";
import type { ScorerIdentity } from "../scoring";
import FanAvatar from "./FanAvatar";
import { Card, Loading, ViewHead, whole } from "./adminKit";
import { segmentedGroup, segmentedIdle, segmentedOption, segmentedSelected } from "./segmented";

type Account = ScorerIdentity & {
  joinedAt: number | null; deletedAt: number | null; commentsPublic: boolean; mutedUntil: number | null;
  cards: number; predictions: number; bets: number; comments: number; lastActivityAt: number | null;
  email: string | null; lastSignInAt: number | null; lastActiveAt: number | null; signIn: string[];
};
type Accounts = { generatedAt: number; clerk: "ok" | "unavailable" | "not configured"; clerkError: string | null; accounts: Account[] };

type Show = "active" | "muted" | "deleted" | "all";
type Sort = "joined" | "active" | "activity";
const SORTS: [Sort, string][] = [["joined", "Newest"], ["active", "Last seen"], ["activity", "Most active"]];
const date = (at: number | null) => at == null ? "—" : new Date(at).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
const seen = (account: Account) => Math.max(account.lastActiveAt ?? 0, account.lastSignInAt ?? 0, account.lastActivityAt ?? 0) || null;
const activity = (account: Account) => account.cards + account.predictions + account.bets + account.comments;
const PERMANENT = Number.MAX_SAFE_INTEGER;

/** Every account on the site: who, since when, last seen, what they have
 *  done here, and whether comments are muted. Muting is in Comments. */
export default function AdminAccounts() {
  const { data, error, loading } = useAdminResource<Accounts>("/api/admin/accounts");
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<Show>("active");
  const [sort, setSort] = useState<Sort>("joined");
  const now = data?.generatedAt ?? 0;

  const rows = useMemo(() => {
    if (!data) return [];
    const words = normalizeSearch(query).split(" ").filter(Boolean);
    return data.accounts
      .filter(account => show === "all" || (show === "deleted" ? account.deletedAt != null
        : account.deletedAt == null && (show === "active" || (account.mutedUntil ?? 0) > now)))
      .filter(account => {
        const text = normalizeSearch(`${account.displayName} ${account.handle} ${account.email ?? ""}`);
        return words.every(word => text.includes(word));
      })
      .sort((a, b) => sort === "active" ? (seen(b) ?? 0) - (seen(a) ?? 0)
        : sort === "activity" ? activity(b) - activity(a) : (b.joinedAt ?? 0) - (a.joinedAt ?? 0));
  }, [data, query, show, sort, now]);

  if (!data) return <Loading>{loading || !error ? "Loading accounts…" : `Couldn’t load accounts. ${error}`}</Loading>;
  const live = data.accounts.filter(account => account.deletedAt == null);
  const week = now - 7 * 86_400_000;
  return (
    <div className="flex flex-col gap-4">
      <ViewHead title="Accounts" note={data.clerk === "ok" ? "Emails and sign-ins from Clerk; everything else from this site."
        : `Clerk ${data.clerk}${data.clerkError ? `: ${data.clerkError}` : ""}. Emails and sign-ins are missing.`} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Card label="Accounts" value={whole(live.length)} hint={`${whole(data.accounts.length - live.length)} deleted`} />
        <Card label="Joined this week" value={whole(live.filter(account => (account.joinedAt ?? 0) > week).length)} />
        <Card label="Seen this week" value={whole(live.filter(account => (seen(account) ?? 0) > week).length)} hint="signed in or did something" />
        <Card label="Have done something" value={whole(live.filter(account => activity(account) > 0).length)} hint="a card, pick, bet or comment" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Name, handle or email" aria-label="Find an account"
          className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 sm:w-64" />
        <div className={segmentedGroup} role="group" aria-label="Show">
          {(["active", "muted", "deleted", "all"] as const).map(key => (
            <button key={key} type="button" onClick={() => setShow(key)} aria-pressed={show === key}
              className={`${segmentedOption} capitalize ${show === key ? segmentedSelected : segmentedIdle}`}>{key}</button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-zinc-500">
          Sort
          <select value={sort} onChange={event => setSort(event.target.value as Sort)} className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-900">
            {SORTS.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
          </select>
        </label>
        <span className="ml-auto text-xs tabular-nums text-zinc-400">{whole(rows.length)} shown</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-xs">
            <thead className="bg-zinc-50 text-left text-[11px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Account</th>
                <th className="px-3 py-2 font-semibold">Joined</th>
                <th className="px-3 py-2 font-semibold">Last seen</th>
                {["Cards", "Picks", "Bets", "Comments"].map(name => <th key={name} className="px-3 py-2 text-right font-semibold">{name}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 tabular-nums">
              {rows.map(account => {
                const muted = (account.mutedUntil ?? 0) > now;
                return (
                  <tr key={account.publicId} className={account.deletedAt != null ? "text-zinc-400" : ""}>
                    <td className="px-4 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <FanAvatar src={account.imageUrl} name={account.displayName} size="md" />
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-1.5">
                            {account.deletedAt == null
                              ? <Link to={`/profiles/${account.handle}`} className="font-medium text-zinc-900 hover:underline">{account.displayName}</Link>
                              : <span className="font-medium">Deleted {date(account.deletedAt)}</span>}
                            {muted ? <span className="rounded-full bg-rose-50 px-1.5 text-[10px] font-semibold text-rose-700">{account.mutedUntil === PERMANENT ? "banned" : `muted until ${date(account.mutedUntil)}`}</span> : null}
                            {account.signIn.map(provider => <span key={provider} className="rounded-full bg-zinc-100 px-1.5 text-[10px] text-zinc-500">{provider}</span>)}
                          </p>
                          <p className="truncate text-[11px] text-zinc-500">{account.email ?? (account.username ? `@${account.handle}` : "no username yet")}</p>
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-600">{date(account.joinedAt)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-600">{relativeAge(seen(account), now) ?? "—"}</td>
                    <td className="px-3 py-2 text-right text-zinc-700">{account.cards || "—"}</td>
                    <td className="px-3 py-2 text-right text-zinc-700">{account.predictions || "—"}</td>
                    <td className="px-3 py-2 text-right text-zinc-700">{account.bets || "—"}</td>
                    <td className="px-3 py-2 text-right text-zinc-700">{account.comments || "—"}</td>
                  </tr>
                );
              })}
              {!rows.length ? <tr><td colSpan={7} className="px-4 py-6 text-center text-zinc-400">No accounts match.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
