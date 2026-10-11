import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAdminResource } from "../admin";
import { relativeAge } from "../format";
import {
  Card, day, DOT, Loading, MinuteChart, ms, percent, routeName, SectionHead, ShareList, TONE, ViewHead, whole,
  type Level, type Metrics, type Traffic,
} from "./adminKit";
import type { SyncStatus } from "./AdminSync";

const SOURCE: Record<string, string> = { direct: "Direct, bookmarks and apps", other: "Other sites" };
const tabLink = (tab: string) => `/admin?tab=${tab}`;

type Check = { level: Level; label: string; detail: string; tab?: string };

/** What needs a look, most serious first. The long-term alert rules live in
 *  deploy/observability. */
function checks(data: Metrics, sync: SyncStatus | null, now: number): Check[] {
  const recent = data.http.lastFiveMinutes;
  const errorRate = recent.requests ? recent.errors / recent.requests : 0;
  const heartbeatAge = data.sync.heartbeatAt ? now - data.sync.heartbeatAt : null;
  const late = sync?.sources.filter(source => source.late) ?? [];
  return [
    { level: data.ready ? "ok" : "bad", label: "Server", detail: data.ready ? "Ready to serve" : "Not ready: query workers are starting or the server is stopping", tab: "server" },
    { level: errorRate > 0.05 ? "bad" : errorRate > 0.01 ? "warn" : "ok", label: "Server errors", detail: `${percent(recent.errors, recent.requests)} of requests in the last 5 minutes`, tab: "server" },
    { level: recent.p95Ms > 1000 ? "bad" : recent.p95Ms > 300 ? "warn" : "ok", label: "Speed", detail: `95% of requests answered within ${ms(recent.p95Ms)}`, tab: "server" },
    { level: data.process.eventLoopP95Ms > 200 ? "bad" : data.process.eventLoopP95Ms > 50 ? "warn" : "ok", label: "Responsiveness", detail: `Event loop delay ${ms(data.process.eventLoopP95Ms)} (p95)`, tab: "server" },
    { level: data.queries.pending > 100 ? "bad" : data.queries.pending > 20 ? "warn" : "ok", label: "Query queue", detail: `${data.queries.pending} waiting`, tab: "server" },
    heartbeatAge == null
      ? { level: "idle", label: "Sync worker", detail: "No heartbeat (normal when sync runs inside the web server)", tab: "sync" }
      : { level: heartbeatAge > 90_000 ? "bad" : "ok", label: "Sync worker", detail: heartbeatAge > 90_000 ? `Silent for ${Math.round(heartbeatAge / 60_000)} min` : "Heartbeat current", tab: "sync" },
    { level: late.length ? "warn" : sync ? "ok" : "idle", label: "Data sources", tab: "sync",
      detail: !sync ? "Checking…" : late.length ? `Late: ${late.map(source => source.name).join(", ")}` : "Every source refreshed on schedule" },
    { level: (sync?.errorsLastDay ?? 0) > 20 ? "warn" : "ok", label: "Sync errors", tab: "sync",
      detail: !sync ? "Checking…" : sync.errorsLastDay ? `${sync.errorsLastDay} in the last 24 hours, most from ${sync.failingLastDay[0]?.kind}` : "None in the last 24 hours" },
    { level: data.community.openReports ? "warn" : "ok", label: "Moderation", tab: "comments",
      detail: data.community.openReports ? `${data.community.openReports} reported ${data.community.openReports === 1 ? "comment" : "comments"} waiting` : "Nothing waiting" },
  ];
}

/** Is the site up and current, who is reading it, and does anything need an
 *  administrator: everything else is a click away in the sidebar. */
export default function AdminOverview() {
  const metrics = useAdminResource<Metrics>("/api/admin/metrics", 10_000);
  const traffic = useAdminResource<Traffic>("/api/admin/traffic?range=30d", 60_000);
  const sync = useAdminResource<SyncStatus>("/api/admin/sync", 60_000);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  const data = metrics.data;
  if (!data) return <Loading>{metrics.loading || !metrics.error ? "Loading…" : `Couldn’t load metrics. ${metrics.error}`}</Loading>;
  const status = checks(data, sync.data, now);
  const overall: Level = status.some(check => check.level === "bad") ? "bad" : status.some(check => check.level === "warn") ? "warn" : "ok";
  const people = traffic.data?.people;
  const days = traffic.data?.series ?? [];
  const today = days.at(-1);
  const yesterday = people?.windows.yesterday;
  const change = people && yesterday?.visitors ? people.windows.today.visitors - yesterday.visitors : null;
  const community = data.community;

  return (
    <div className="flex flex-col gap-4">
      <ViewHead title="Overview" note={`Updated ${relativeAge(data.generatedAt, now) ?? "just now"} · server up since ${relativeAge(data.http.startedAt, now)}`} />

      <section className={`rounded-xl px-4 py-3 ${TONE[overall]}`} aria-live="polite">
        <p className="text-sm font-semibold">
          {overall === "ok" ? "Everything looks healthy." : overall === "warn" ? "Running, with something worth a look." : "Something needs attention now."}
        </p>
        <ul className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
          {status.map(check => (
            <li key={check.label} className="flex min-w-0 items-start gap-1.5">
              <span aria-hidden="true" className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[check.level]}`} />
              <span className="min-w-0">
                {check.tab ? <Link to={tabLink(check.tab)} className="font-semibold hover:underline">{check.label}</Link> : <b className="font-semibold">{check.label}</b>}
                {" "}<span className="opacity-80">{check.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <SectionHead title="Readers" note={<>Browsers that opened the site; crawlers left out. Days are UTC. <Link to={tabLink("traffic")} className="font-medium text-zinc-700 underline">All traffic</Link></>} />
        {!people ? <Loading>{traffic.error ? `Couldn’t load traffic. ${traffic.error}` : "Loading readers…"}</Loading> : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Card label="Visitors today" value={whole(people.windows.today.visitors)}
                hint={change == null ? `${whole(people.windows.today.returning)} returning` : `${change >= 0 ? "+" : "−"}${whole(Math.abs(change))} vs all of yesterday (${whole(yesterday!.visitors)})`} />
              <Card label="Last 7 days" value={whole(people.windows.last7Days)} hint="unique visitors" />
              <Card label="Last 30 days" value={whole(people.windows.last30Days)} hint="unique visitors" />
              <Card label="Page views today" value={whole(today?.pageViews ?? 0)}
                hint={`${whole(data.http.pageViews.lastFiveMinutes)} in the last 5 min · ${whole(data.http.pageViews.lastHour)} this hour`} />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <MinuteChart title="Visitors per day" points={days.map(point => ({ at: point.at, value: point.people }))} format={whole} tone="text-series-3" time={at => day(at)} span="last 30 days"
                total={people.unique == null ? undefined : `${whole(people.unique)} unique`} />
              <MinuteChart title="Page views per day" points={days.map(point => ({ at: point.at, value: point.pageViews }))} format={whole} time={at => day(at)} span="last 30 days"
                total={whole(traffic.data!.totals.pageViews)} />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <ShareList title="Where visits came from, 30 days" data={people.breakdown.source} label={value => SOURCE[value] ?? value} />
              <ShareList title="First page of a visit, 30 days" data={people.breakdown.landing} label={routeName} />
            </div>
          </>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <SectionHead title="Community" note={<><Link to={tabLink("accounts")} className="font-medium text-zinc-700 underline">Accounts</Link> · <Link to={tabLink("comments")} className="font-medium text-zinc-700 underline">Comments</Link></>} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Card label="Accounts" value={community.accounts == null ? "—" : whole(community.accounts)} hint={`${whole(community.accountsLastDay ?? 0)} new in 24 h`} />
          <Card label="Comments, 24 h" value={whole(community.commentsLastDay)} hint={`${whole(community.commentersLastDay)} commenters · ${whole(community.commentsLastHour)} this hour`} />
          <Card label="Predictions, 24 h" value={community.predictionsLastDay == null ? "—" : whole(community.predictionsLastDay)} hint={`${whole(traffic.data?.community.bets ?? 0)} bets in 30 days`} />
          <Card label="Waiting on you" value={whole(community.openReports + community.heldComments)}
            hint={`${whole(community.openReports)} reported · ${whole(community.heldComments)} held · ${whole(community.mutedAccounts)} muted`}
            level={community.openReports ? "warn" : "ok"} />
        </div>
      </section>

      {sync.data?.errors.length ? (
        <section className="flex flex-col gap-2">
          <SectionHead title="Latest sync errors" note={<Link to={tabLink("sync")} className="font-medium text-zinc-700 underline">Every source and error</Link>} />
          <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white text-xs">
            {sync.data.errors.slice(0, 3).map(error => (
              <li key={`${error.at}-${error.job}`} className="px-4 py-2">
                <p className="flex flex-wrap gap-x-2"><b className="font-semibold text-zinc-900">{error.job}</b><span className="text-zinc-400">{relativeAge(error.at, now)}</span></p>
                <p className="mt-0.5 break-words text-zinc-600">{error.error}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
