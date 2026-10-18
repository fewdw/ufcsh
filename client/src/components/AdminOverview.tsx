import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAdminResource } from "../admin";
import { relativeAge } from "../format";
import FanAvatar from "./FanAvatar";
import {
  Card, day, DOT, FailingUrlRow, Loading, MinuteChart, ms, percent, routeName, SectionHead, ShareList, TONE, ViewHead, whole,
  type Level, type Metrics, type Traffic,
} from "./adminKit";
import type { Accounts } from "./AdminAccounts";
import type { Errors } from "./AdminErrors";

const SOURCE: Record<string, string> = { direct: "Direct, bookmarks and apps", other: "Other sites" };
const DAY = 86_400_000;
const section = (tab: string, view?: string) => `/admin?tab=${tab}${view ? `&view=${view}` : ""}`;

type Check = { level: Level; label: string; detail: string; to: string };

/** Every check, worst first. The long-term alert rules live in deploy/observability. */
function checks(data: Metrics, errors: Errors | null, now: number): Check[] {
  const recent = data.http.lastFiveMinutes;
  const errorRate = recent.requests ? recent.errors / recent.requests : 0;
  const heartbeatAge = data.sync.heartbeatAt ? now - data.sync.heartbeatAt : null;
  const sync = errors?.sync;
  const late = sync?.sources.filter(source => source.late) ?? [];
  const failing = errors?.http.serverErrors.filter(row => now - row.lastAt < DAY) ?? [];
  const list: Check[] = [
    { level: data.ready ? "ok" : "bad", label: "Server", detail: data.ready ? "Ready to serve" : "Not ready: query workers are starting or the server is stopping", to: section("traffic", "server") },
    { level: errorRate > 0.05 ? "bad" : errorRate > 0.01 ? "warn" : "ok", label: "Server errors", to: section("errors"),
      detail: `${percent(recent.errors, recent.requests)} of requests in the last 5 minutes${failing.length ? ` · ${failing.length} failing ${failing.length === 1 ? "address" : "addresses"} today` : ""}` },
    { level: recent.p95Ms > 1000 ? "bad" : recent.p95Ms > 300 ? "warn" : "ok", label: "Speed", detail: `95% of requests answered within ${ms(recent.p95Ms)}`, to: section("slow") },
    { level: data.process.eventLoopP95Ms > 200 ? "bad" : data.process.eventLoopP95Ms > 50 ? "warn" : "ok", label: "Responsiveness", detail: `Event loop delay ${ms(data.process.eventLoopP95Ms)} (p95)`, to: section("traffic", "server") },
    { level: data.queries.pending > 100 ? "bad" : data.queries.pending > 20 ? "warn" : "ok", label: "Query queue", detail: `${data.queries.pending} waiting`, to: section("traffic", "server") },
    heartbeatAge == null
      ? { level: "idle", label: "Sync worker", detail: "No heartbeat (normal when sync runs inside the web server)", to: section("errors") }
      : { level: heartbeatAge > 90_000 ? "bad" : "ok", label: "Sync worker", detail: heartbeatAge > 90_000 ? `Silent for ${Math.round(heartbeatAge / 60_000)} min` : "Heartbeat current", to: section("errors") },
    { level: late.length ? "warn" : sync ? "ok" : "idle", label: "Data sources", to: section("errors"),
      detail: !sync ? "Checking…" : late.length ? `Late: ${late.map(source => source.name).join(", ")}` : "Every source refreshed on schedule" },
    { level: (sync?.errorsLastDay ?? 0) > 20 ? "warn" : "ok", label: "Sync errors", to: section("errors"),
      detail: !sync ? "Checking…" : sync.errorsLastDay ? `${sync.errorsLastDay} in the last 24 hours, most from ${sync.failingLastDay[0]?.kind}` : "None in the last 24 hours" },
    { level: data.community.openReports ? "warn" : "ok", label: "Moderation", to: section("people", "comments"),
      detail: data.community.openReports ? `${data.community.openReports} reported ${data.community.openReports === 1 ? "comment" : "comments"} waiting` : "Nothing waiting" },
  ];
  const rank: Record<Level, number> = { bad: 0, warn: 1, idle: 2, ok: 3 };
  return list.sort((a, b) => rank[a.level] - rank[b.level]);
}

/** What needs an administrator first, then who just joined, then who is
 *  reading. Everything else is a click away in the sidebar. */
export default function AdminOverview() {
  const metrics = useAdminResource<Metrics>("/api/admin/metrics", 10_000);
  const errors = useAdminResource<Errors>("/api/admin/errors", 60_000);
  const accounts = useAdminResource<Accounts>("/api/admin/accounts", 5 * 60_000);
  const traffic = useAdminResource<Traffic>("/api/admin/traffic?range=30d", 60_000);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  const data = metrics.data;
  if (!data) return <Loading>{metrics.loading || !metrics.error ? "Loading…" : `Couldn’t load metrics. ${metrics.error}`}</Loading>;
  const status = checks(data, errors.data, now);
  const problems = status.filter(check => check.level === "bad" || check.level === "warn");
  const overall: Level = problems.some(check => check.level === "bad") ? "bad" : problems.length ? "warn" : "ok";
  const failing = (errors.data?.http.serverErrors ?? []).filter(row => now - row.lastAt < DAY);
  const syncErrors = (errors.data?.sync.errors ?? []).filter(entry => now - entry.at < DAY);
  const newest = (accounts.data?.accounts ?? []).filter(account => account.deletedAt == null).slice(0, 6);
  const people = traffic.data?.people;
  const days = traffic.data?.series ?? [];
  const yesterday = people?.windows.yesterday;
  const change = people && yesterday?.visitors ? people.windows.today.visitors - yesterday.visitors : null;

  return (
    <div className="flex flex-col gap-5">
      <ViewHead title="Overview" note={`Updated ${relativeAge(data.generatedAt, now) ?? "just now"} · server up since ${relativeAge(data.http.startedAt, now)}`} />

      <section className={`rounded-xl px-4 py-3 ${TONE[overall]}`} aria-live="polite">
        <p className="text-sm font-semibold">
          {overall === "ok" ? "Everything looks healthy." : overall === "warn" ? `${problems.length} ${problems.length === 1 ? "thing needs" : "things need"} a look.` : "Something needs attention now."}
        </p>
        {problems.length ? (
          <ul className="mt-2 flex flex-col gap-1 text-xs">
            {problems.map(check => (
              <li key={check.label} className="flex min-w-0 items-start gap-1.5">
                <span aria-hidden="true" className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[check.level]}`} />
                <span className="min-w-0"><Link to={check.to} className="font-semibold hover:underline">{check.label}</Link> <span className="opacity-80">{check.detail}</span></span>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-2 text-[11px] opacity-70">
          {problems.length ? "Fine: " : ""}{status.filter(check => !problems.includes(check)).map(check => check.label).join(" · ")}
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <SectionHead title="Errors, last 24 hours" note={<Link to={section("errors")} className="font-medium text-zinc-700 underline">All errors, sync jobs and missing pages</Link>} />
        {!errors.data ? <Loading>{errors.error ? `Couldn’t load errors. ${errors.error}` : "Loading errors…"}</Loading>
          : !failing.length && !syncErrors.length ? <p className="rounded-xl border border-zinc-200 bg-white px-4 py-4 text-center text-xs text-zinc-500">No server or sync errors in the last 24 hours.</p> : (
            <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
              {failing.slice(0, 5).map(row => <FailingUrlRow key={`${row.status} ${row.method} ${row.path}`} row={row} now={now} />)}
              {syncErrors.slice(0, 3).map(entry => (
                <li key={`${entry.at}-${entry.job}`} className="px-4 py-2 text-xs">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="rounded bg-amber-50 px-1.5 font-semibold text-amber-700">sync</span>
                    <b className="font-semibold text-zinc-900">{entry.job}</b><span className="text-zinc-400">{relativeAge(entry.at, now)}</span>
                  </p>
                  <p className="mt-0.5 break-words font-mono text-[11px] text-zinc-600">{entry.error}</p>
                </li>
              ))}
            </ul>
          )}
      </section>

      <section className="flex flex-col gap-2">
        <SectionHead title="Newest accounts" note={<Link to={section("people", "accounts")} className="font-medium text-zinc-700 underline">Every account</Link>} />
        {!accounts.data ? <Loading>{accounts.error ? `Couldn’t load accounts. ${accounts.error}` : "Loading accounts…"}</Loading> : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {newest.map(account => (
              <li key={account.publicId} className="flex min-w-0 items-center gap-2.5 rounded-xl border border-zinc-200 bg-white px-3 py-2">
                <FanAvatar src={account.imageUrl} name={account.displayName} size="md" />
                <div className="min-w-0 text-xs">
                  <Link to={`/profiles/${account.handle}`} className="block truncate text-sm font-medium text-zinc-900 hover:underline">{account.displayName}</Link>
                  <p className="truncate text-zinc-500">joined {relativeAge(account.joinedAt, now) ?? "—"}{account.email ? ` · ${account.email}` : ""}</p>
                </div>
              </li>
            ))}
            {!newest.length ? <li className="text-xs text-zinc-400">No accounts yet.</li> : null}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <SectionHead title="Readers" note={<>Browsers that opened the site; crawlers left out. Days are UTC. <Link to={section("traffic")} className="font-medium text-zinc-700 underline">All traffic</Link></>} />
        {!people ? <Loading>{traffic.error ? `Couldn’t load traffic. ${traffic.error}` : "Loading readers…"}</Loading> : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Card label="Visitors today" value={whole(people.windows.today.visitors)}
                hint={change == null ? `${whole(people.windows.today.returning)} returning` : `${change >= 0 ? "+" : "−"}${whole(Math.abs(change))} vs all of yesterday (${whole(yesterday!.visitors)})`} />
              <Card label="Last 7 days" value={whole(people.windows.last7Days)} hint="unique visitors" />
              <Card label="Last 30 days" value={whole(people.windows.last30Days)} hint="unique visitors" />
              <Card label="Page views today" value={whole(days.at(-1)?.pageViews ?? 0)}
                hint={`${whole(data.http.pageViews.lastFiveMinutes)} in the last 5 min · ${whole(data.http.pageViews.lastHour)} this hour`} />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <MinuteChart title="Visitors per day" points={days.map(point => ({ at: point.at, value: point.people }))} format={whole} tone="text-series-3" time={at => day(at)} span="last 30 days"
                total={people.unique == null ? undefined : `${whole(people.unique)} unique`} />
              <ShareList title="Where visits came from, 30 days" data={people.breakdown.source} label={value => SOURCE[value] ?? value} />
            </div>
            <ShareList title="First page of a visit, 30 days" data={people.breakdown.landing} label={routeName} />
          </>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <SectionHead title="Community, last 24 hours" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Card label="Accounts" value={data.community.accounts == null ? "—" : whole(data.community.accounts)} hint={`${whole(data.community.accountsLastDay ?? 0)} new`} />
          <Card label="Comments" value={whole(data.community.commentsLastDay)} hint={`${whole(data.community.commentersLastDay)} commenters`} />
          <Card label="Predictions" value={data.community.predictionsLastDay == null ? "—" : whole(data.community.predictionsLastDay)} />
          <Card label="Waiting on you" value={whole(data.community.openReports + data.community.heldComments)}
            hint={`${whole(data.community.openReports)} reported · ${whole(data.community.heldComments)} held`} level={data.community.openReports ? "warn" : "ok"} />
        </div>
      </section>
    </div>
  );
}
