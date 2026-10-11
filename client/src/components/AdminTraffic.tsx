import { useState } from "react";
import { useAdminResource } from "../admin";
import { segmentedGroup, segmentedIdle, segmentedOption, segmentedSelected } from "./segmented";
import {
  Card, countryName, day, Loading, MinuteChart, ms, percent, RANGES, routeName, routePath, SectionHead, ShareList, ViewHead, whole,
  type Traffic, type TrafficRange,
} from "./adminKit";

const DEVICE: Record<string, string> = { phone: "Phone", tablet: "Tablet", desktop: "Desktop" };
const SOURCE: Record<string, string> = { direct: "Direct, bookmarks and apps", other: "Other sites" };

/** Who came, from where, to what, and how the server answered: saved hour by
 *  hour, so it outlives restarts and deploys. */
export default function AdminTraffic() {
  const [range, setRange] = useState<TrafficRange>("7d");
  const { data, error, loading } = useAdminResource<Traffic>(`/api/admin/traffic?range=${range}`, 60_000);
  const shown = data?.range === range ? data : null;
  const hourly = shown ? shown.bucketMs < 86_400_000 : true;
  const time = (at: number) => hourly
    ? new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : day(at, range === "all");
  const unit = !shown ? "" : hourly ? "hour" : shown.bucketMs > 86_400_000 ? "week" : "day";
  const label = RANGES.find(([key]) => key === range)![1].toLowerCase();
  const points = (pick: (point: Traffic["series"][number]) => number | null) => (shown?.series ?? []).map(point => ({ at: point.at, value: pick(point) }));
  const t = shown?.totals;
  const people = shown?.people;

  return (
    <div className="flex flex-col gap-4">
      <ViewHead title="Traffic" note={<>Saved every minute and kept across restarts{shown?.firstRecordedAt ? `, recorded since ${day(shown.firstRecordedAt, true)}` : ""}. Days are UTC. Admin traffic is left out.</>}>
        <div className={`${segmentedGroup} max-w-full overflow-x-auto`} role="group" aria-label="Range">
          {RANGES.map(([key, name]) => (
            <button key={key} type="button" onClick={() => setRange(key)} aria-pressed={range === key}
              className={`${segmentedOption} whitespace-nowrap ${range === key ? segmentedSelected : segmentedIdle}`}>{name}</button>
          ))}
        </div>
      </ViewHead>

      {!shown || !t || !people ? <Loading>{loading || !error ? "Loading traffic…" : `Couldn’t load traffic. ${error}`}</Loading> : (
        <>
          <section className="flex flex-col gap-2">
            <SectionHead title="Visitors" note={<>Browsers that opened the site and sent a page view; crawlers and admins left out.
              {people.firstRecordedAt ? ` Counted this way since ${day(people.firstRecordedAt, true)}.` : " Nothing counted this way yet."}</>} />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Card label="Unique visitors" value={people.unique == null ? "—" : whole(people.unique)}
                hint={people.unique == null ? "only the last 35 days are kept per browser" : `last ${label}`} />
              <Card label="Visitors / day" value={people.daily.days ? whole(people.daily.average) : "—"}
                hint={people.daily.peakDay != null ? `peak ${whole(people.daily.peak)} on ${day(people.daily.peakDay)}` : "no complete day yet"} />
              <Card label="Page views" value={whole(t.pageViews)} hint={people.unique ? `${(t.pageViews / people.unique).toFixed(1)} per visitor` : `last ${label}`} />
              <Card label="Returning today" value={percent(people.windows.today.returning, people.windows.today.visitors)}
                hint={`${whole(people.windows.today.returning)} of ${whole(people.windows.today.visitors)} seen in the last 30 days`} />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <MinuteChart title={unit === "week" ? "Visitors per day (weekly average)" : `Visitors per ${unit}`} points={points(point => point.people)} format={whole} tone="text-series-3" time={time} span={`last ${label}`} />
              <MinuteChart title={`Page views per ${unit}`} points={points(point => point.pageViews)} format={whole} tone="text-series-1" time={time} span={`last ${label}`} total={whole(t.pageViews)} />
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <ShareList title="Where visits came from" data={people.breakdown.source} label={value => SOURCE[value] ?? value} />
              <ShareList title="First page of a visit" data={people.breakdown.landing} label={routeName} />
              <ShareList title="Devices" data={people.breakdown.device} label={value => DEVICE[value] ?? value} />
              <ShareList title="Countries" data={people.breakdown.country} label={countryName} empty="Cloudflare sends no country here." />
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <SectionHead title="Requests" note="Every request the server answered: pages, data, images and scripts, from readers and crawlers alike." />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Card label="Requests" value={whole(t.requests)} hint={`last ${label}`} />
              <Card label="Response time (p95)" value={t.requests ? ms(t.p95Ms) : "—"} hint={`median ${t.requests ? ms(t.p50Ms) : "—"} · max ${t.requests ? ms(t.maxMs) : "—"}`} />
              <Card label="Server errors" value={percent(t.errors, t.requests)} hint={`${whole(t.errors)} responses · ${whole(t.throttled)} rate-limited`} level={t.requests && t.errors / t.requests > 0.01 ? "warn" : "ok"} />
              <Card label="Client addresses / day" value={shown.dailyVisitors.days ? whole(shown.dailyVisitors.average) : "—"}
                hint={shown.dailyVisitors.peakDay != null ? `includes crawlers · peak ${whole(shown.dailyVisitors.peak)}` : "includes crawlers and previews"} />
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <MinuteChart title={`Requests per ${unit}`} points={points(point => point.requests)} format={whole} time={time} span={`last ${label}`} total={whole(t.requests)} />
              <MinuteChart title="Response p95" points={points(point => point.p95Ms)} format={ms} kind="line" tone="text-series-4" time={time} span={`last ${label}`} />
              <MinuteChart title={`Errors per ${unit}`} points={points(point => point.errors)} format={whole} tone="text-rose-500" time={time} span={`last ${label}`} total={whole(t.errors)} />
              <MinuteChart title={`Rate-limited per ${unit}`} points={points(point => point.throttled)} format={whole} tone="text-series-2" time={time} span={`last ${label}`} total={whole(t.throttled)} />
            </div>
            <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-xs">
                  <thead className="bg-zinc-50 text-left text-[11px] uppercase tracking-wide text-zinc-500">
                    <tr>
                      <th className="px-4 py-2 font-semibold">Route pattern, last {label}</th>
                      {["Requests", "Share", "Views", "p95", "4xx", "429", "5xx", "≥1s"].map(name => <th key={name} className="px-3 py-2 text-right font-semibold">{name}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 tabular-nums">
                    {shown.routes.map(route => (
                      <tr key={route.route} className={route.requests && route.errors / route.requests > 0.01 ? "bg-rose-50" : route.p95Ms > 500 ? "bg-amber-50" : ""}>
                        <td className="px-4 py-2"><b className="block font-medium text-zinc-900">{routeName(route.route)}</b><code className="text-[11px] text-zinc-500">{routePath(route.route)}</code></td>
                        <td className="px-3 py-2 text-right font-semibold text-zinc-900">{whole(route.requests)}</td>
                        <td className="px-3 py-2 text-right text-zinc-600">{percent(route.requests, t.requests)}</td>
                        <td className="px-3 py-2 text-right text-zinc-600">{route.pageViews ? whole(route.pageViews) : "—"}</td>
                        <td className="px-3 py-2 text-right text-zinc-800">{route.requests ? ms(route.p95Ms) : "—"}</td>
                        <td className="px-3 py-2 text-right text-zinc-600">{route.clientErrors ? whole(route.clientErrors) : "—"}</td>
                        <td className="px-3 py-2 text-right text-zinc-600">{route.throttled ? whole(route.throttled) : "—"}</td>
                        <td className="px-3 py-2 text-right text-zinc-600">{route.errors ? whole(route.errors) : "—"}</td>
                        <td className="px-3 py-2 text-right text-zinc-600">{route.slow ? whole(route.slow) : "—"}</td>
                      </tr>
                    ))}
                    {!shown.routes.length ? <tr><td colSpan={9} className="px-4 py-6 text-center text-zinc-400">Nothing recorded in this range yet.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-xs text-zinc-600">
            <h3 className="text-sm font-semibold text-zinc-900">How visitors are counted</h3>
            <ul className="mt-1.5 list-disc space-y-1 pl-4">
              <li>Each browser keeps a random id. It is sent with page views, salted and hashed on the server, and kept 35 days for unique and returning counts. Only daily totals are kept after that. IP addresses are never stored.</li>
              <li>Crawlers and scripts are left out by user agent, automated browsers and admins by the page itself. One address can add at most 50 browsers a day.</li>
              <li>It still undercounts readers whose blocker stops the page-view signal, and counts one person twice on two devices or after clearing site data.</li>
              <li>Client addresses count every request, so link previews, crawlers and monitors inflate them. A phone moving between Wi-Fi and mobile data counts twice, while a household behind one address counts once.</li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
