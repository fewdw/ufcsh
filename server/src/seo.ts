import { POTENTIAL_EVENT_ID, POTENTIAL_EVENT_NAME, potentialMatchups } from "./potential-matchups.ts";
import { prepared } from "./db.ts";
import { ufcFightExistsSql, currentRecord, hasUfcFight, recordText } from "./fighter-identity.ts";
import { judgeProfile, officialsIndex, refereeProfile } from "./officials.ts";
import { locationPage, venueBySlug, venueIndex, venuePage } from "./venues.ts";
import { cardOrder } from "./card-schedule.ts";

/**
 * What a page is called before any script runs: the title, description,
 * canonical address, share image and structured data that search engines and
 * link previews read, plus a short plain-HTML summary for readers without
 * JavaScript. A route that names something the archive does not hold answers
 * 404 and asks not to be indexed.
 */

export const SITE_URL = (process.env.SITE_ORIGIN || "https://ufc.sh").replace(/\/$/, "");

export type PageSeo = {
  title: string;
  description: string;
  canonical: string;
  type: "website" | "profile";
  structuredData?: Record<string, unknown>;
  /** Absolute URL of the 1200×630 share image. */
  image?: string | null;
  status: number;
  noindex?: boolean;
  /** Plain HTML placed in <noscript>: what the page is, with links onward. */
  summary?: string;
  /** With status 301: the page this address plainly means. */
  redirect?: string;
};

const HTML_ENTITIES: Record<string, string> = { "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&#39;", '"': "&quot;" };
export function htmlEscape(value: string): string {
  return value.replace(/[<>&'"]/g, (char) => HTML_ENTITIES[char]);
}
const XML_ENTITIES: Record<string, string> = { "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" };
const xmlEscape = (value: string) => value.replace(/[<>&'"]/g, (char) => XML_ENTITIES[char]);

const SITE_IMAGE = `${SITE_URL}/og/site.jpg`;
const DEFAULT: Omit<PageSeo, "canonical"> = {
  title: "UFC Data: Events, Odds, Stats & Rankings | ufc.sh",
  description: "UFC data for hardcore fans: fight cards, matchup odds, results, fighter statistics and current rankings in one fast interface.",
  type: "website",
  image: SITE_IMAGE,
  status: 200,
};

const STATIC_PAGES: Record<string, { title: string; description: string }> = {
  "/rankings": { title: "UFC Rankings by Division | ufc.sh", description: "Current UFC rankings by division, including champions, activity and each fighter's next booking." },
  "/stats": { title: "UFC Statistics Leaderboards | ufc.sh", description: "All-time UFC leaderboards for records, finishes, output, opposition and the betting market, plus the most disputed decisions, biggest upsets, judges and referees." },
  "/officials": { title: "UFC Judges & Referees | ufc.sh", description: "Every UFC judge and referee on record: scorecards, agreement, dissents, stoppages and the bouts behind each number." },
  "/venues": { title: "UFC Venues | ufc.sh", description: "Every arena that has hosted a UFC event, with the cards held there, attendance and upcoming events." },
  "/locations": { title: "UFC Locations | ufc.sh", description: "Every city that has hosted a UFC event, with the cards held there, the venues, title fights and upcoming events." },
  "/controversial": { title: "Controversial UFC Decisions: Closest Fights & Robberies | ufc.sh", description: "Every UFC decision the fans' scorecards call close or got the other way, with each judge's card, the fans' average round by round and what the stats say." },
  "/awards": { title: "MMA Awards: Fighter, Fight & Knockout of the Year | ufc.sh", description: "Sherdog's year-end awards since 2008: Fighter, Breakthrough and Comeback Fighter of the Year, and Fight, Knockout, Submission and Upset of the Year." },
  "/news": { title: "UFC News: Latest from Every Outlet | ufc.sh", description: "The latest UFC news from MMA Fighting, Sherdog, BBC Sport, The Guardian and more, in one list: top stories first, every headline linked to its source." },
  "/roster": { title: "UFC Roster Changes: Signings & Releases | ufc.sh", description: "Fighters the UFC has recently signed and recently released, with division, record and date." },
  "/info": { title: "About | ufc.sh", description: "UFC data for hardcore fans. About, shortcuts, community rules, privacy, support and the latest changes." },
};

const link = (href: string, text: string) => `<a href="${htmlEscape(href)}">${htmlEscape(text)}</a>`;
const notFound = (): PageSeo => ({
  ...DEFAULT, title: "Page not found | ufc.sh", description: "This page could not be found on ufc.sh.",
  canonical: `${SITE_URL}/`, status: 404, noindex: true,
});

/** Addresses people guess or paste that name no page as written. */
const SECTION_ALIASES: Record<string, string> = { "/events": "/", "/fights": "/", "/contact": "/info", "/about": "/info" };
const nameSlug = (name: string) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/** Every fighter with a UFC bout whose name reads as this slug. */
function fightersNamed(slug: string): string[] {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(slug)) return [];
  const rows = prepared(`SELECT fr.id, fr.name FROM fighters fr WHERE ${ufcFightExistsSql("fr.id", "f")}`).all() as { id: string; name: string }[];
  return rows.filter(row => nameSlug(row.name) === slug).map(row => row.id);
}

/**
 * Where an address that names no page should go when it plainly means one: a
 * fighter or bout written by name ("/fighters/ilia-topuria",
 * "/fights/alex-oliveira-vs-tim-means", their latest meeting), an id with junk
 * pasted after it, or a guessable section. Null when the meaning is not certain:
 * two fighters by one name are never guessed between.
 */
export function pageRedirect(pathname: string): string | null {
  const section = SECTION_ALIASES[pathname.replace(/\/+$/, "")];
  if (section) return section;
  const match = /^\/(fighters|fights|events)\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  const [, kind, raw] = match;
  let id: string;
  try { id = decodeURIComponent(raw); } catch { return null; }
  const table = kind === "fighters" ? "fighters" : kind === "fights" ? "fights" : "events";
  // "/fights/9861b6d04e6ed43c&gsessionid=…": the id, then what a mail client appended.
  const leading = /^([a-f0-9]{16})(?![a-f0-9])/.exec(id)?.[1];
  if (leading && leading !== id) {
    if (prepared(`SELECT 1 FROM ${table} WHERE id = ?`).get(leading)) return `/${kind}/${leading}`;
    return null;
  }
  const slug = nameSlug(id);
  if (kind === "fighters") {
    const ids = fightersNamed(slug);
    return ids.length === 1 && ids[0] !== id ? `/fighters/${ids[0]}` : null;
  }
  if (kind !== "fights") return null;
  const sides = slug.split("-vs-");
  if (sides.length !== 2) return null;
  const [a, b] = sides.map(fightersNamed);
  if (!a.length || !b.length) return null;
  const marks = (ids: string[]) => ids.map(() => "?").join(", ");
  const fight = prepared(`SELECT f.id FROM fights f JOIN events e ON e.id = f.event_id
    WHERE (f.f1_id IN (${marks(a)}) AND f.f2_id IN (${marks(b)})) OR (f.f1_id IN (${marks(b)}) AND f.f2_id IN (${marks(a)}))
    ORDER BY e.date DESC, f.ord LIMIT 1`).get(...a, ...b, ...b, ...a) as { id: string } | undefined;
  return fight ? `/fights/${fight.id}` : null;
}

export function pageSeo(pathname: string): PageSeo {
  const seo = pageSeoFor(pathname);
  if (seo.status !== 404) return seo;
  const redirect = pageRedirect(pathname);
  return redirect ? { ...seo, status: 301, redirect } : seo;
}

function pageSeoFor(pathname: string): PageSeo {
  const home: PageSeo = { ...DEFAULT, canonical: `${SITE_URL}/`, summary: `<p>${link("/rankings", "Rankings")} · ${link("/stats", "Statistics")} · ${link("/officials", "Judges & referees")} · ${link("/venues", "Venues")} · ${link("/info", "About")}</p>` };
  if (pathname === "/" || pathname === "/index.html") return home;
  const fixed = STATIC_PAGES[pathname];
  if (fixed) return { ...DEFAULT, ...fixed, canonical: `${SITE_URL}${pathname}` };
  if (pathname === "/admin" || pathname === "/admin/bugs" || /^\/sign-(in|up)(\/|$)/.test(pathname)) return { ...home, noindex: true };
  // Stream overlays are for a streaming tool's browser, not for search.
  if (pathname === "/overlay" || /^\/overlay\/[a-f0-9]{16}$/.test(pathname)) return { ...home, title: "Live fan scorecard overlay | ufc.sh", noindex: true };
  const parts = pathname.split("/");
  const id = decodeURIComponent(parts[2] ?? "");
  if (parts.length !== 3 || !id) return notFound();
  if (parts[1] === "profiles") return { ...home, canonical: `${SITE_URL}${pathname}`, title: "Fan profile | ufc.sh", description: "A fan's UFC scorecards, predictions and how often their cards matched the judges." };

  if (parts[1] === "events" && id === POTENTIAL_EVENT_ID || parts[1] === "fights" && id.startsWith("potential-")) {
    const rows = potentialMatchups();
    const fight = parts[1] === "fights" ? rows.find(row => row.id === id) : null;
    if (parts[1] === "fights" && !fight) return notFound();
    const name = fight ? `${fight.f1_name} vs ${fight.f2_name}` : POTENTIAL_EVENT_NAME;
    return { ...DEFAULT, title: `${name} | ufc.sh`, canonical: `${SITE_URL}${pathname}`, image: `${SITE_URL}/og/${parts[1]}/${id}.jpg`,
      description: `${name}: odds for unconfirmed UFC matchups. These fights are not scheduled.`,
      summary: `<h1>${htmlEscape(name)}</h1><p>Unconfirmed fights with odds.</p><ul>${(fight ? [fight] : rows).map(row => `<li>${link(`/fights/${row.id}`, `${row.f1_name} vs ${row.f2_name}`)}</li>`).join("")}</ul>`,
    };
  }
  if (parts[1] === "events") {
    const event = prepared("SELECT id, name, date, location, complete FROM events WHERE id = ?").get(id) as { id: string; name: string; date: string; location: string; complete: number } | undefined;
    if (!event) return notFound();
    const fights = cardOrder(prepared("SELECT id, f1_name, f2_name, weight_class, ord, segment, card_pos FROM fights WHERE event_id = ? ORDER BY ord").all(id) as { id: string; f1_name: string; f2_name: string; weight_class: string; ord: number; segment: string | null; card_pos: number | null }[]);
    const headliner = fights[0] ? `${fights[0].f1_name} vs ${fights[0].f2_name}` : "";
    return {
      ...DEFAULT,
      title: `${event.name} | ufc.sh`,
      description: `${event.name}${event.date ? ` on ${event.date}` : ""}: ${fights.length} matchups${headliner ? ` headlined by ${headliner}` : ""}, with odds${event.complete ? " and results" : ""}.${event.location ? ` ${event.location}.` : ""}`,
      canonical: `${SITE_URL}/events/${event.id}`,
      image: `${SITE_URL}/og/events/${event.id}.jpg`,
      structuredData: {
        "@context": "https://schema.org", "@type": "SportsEvent", name: event.name, startDate: event.date,
        eventStatus: event.complete ? "https://schema.org/EventCompleted" : "https://schema.org/EventScheduled",
        url: `${SITE_URL}/events/${event.id}`,
        ...(event.location ? { location: { "@type": "Place", name: event.location } } : {}),
      },
      summary: `<h1>${htmlEscape(event.name)}</h1><p>${htmlEscape(event.date)} · ${htmlEscape(event.location)}</p><ul>${fights.map((fight) => `<li>${link(`/fights/${fight.id}`, `${fight.f1_name} vs ${fight.f2_name}`)} (${htmlEscape(fight.weight_class)})</li>`).join("")}</ul>`,
    };
  }
  if (parts[1] === "fights") {
    const fight = prepared(`
      SELECT f.id, f.f1_id, f.f2_id, f.f1_name, f.f2_name, f.weight_class, f.method, f.round, f.time, f.f1_outcome, f.f2_outcome,
             e.id AS event_id, e.name AS event_name, e.date, e.location, e.complete
      FROM fights f JOIN events e ON e.id = f.event_id WHERE f.id = ?
    `).get(id) as any;
    if (!fight) return notFound();
    const name = `${fight.f1_name} vs ${fight.f2_name}`;
    const winner = fight.f1_outcome === "win" ? fight.f1_name : fight.f2_outcome === "win" ? fight.f2_name : null;
    const result = winner && fight.method ? ` ${winner} won by ${fight.method}${fight.round ? ` in round ${fight.round}` : ""}.` : "";
    return {
      ...DEFAULT,
      title: `${name} | ufc.sh`,
      description: `${name} at ${fight.event_name}: ${fight.weight_class} odds, tale of the tape, fighter statistics${fight.complete ? " and result" : ""}.${result}`,
      canonical: `${SITE_URL}/fights/${fight.id}`,
      image: `${SITE_URL}/og/fights/${fight.id}.jpg`,
      structuredData: {
        "@context": "https://schema.org", "@type": "SportsEvent", name, sport: "Mixed Martial Arts", startDate: fight.date,
        eventStatus: fight.complete ? "https://schema.org/EventCompleted" : "https://schema.org/EventScheduled",
        url: `${SITE_URL}/fights/${fight.id}`,
        competitor: [
          { "@type": "Person", name: fight.f1_name, ...(hasUfcFight(fight.f1_id) ? { url: `${SITE_URL}/fighters/${fight.f1_id}` } : {}) },
          { "@type": "Person", name: fight.f2_name, ...(hasUfcFight(fight.f2_id) ? { url: `${SITE_URL}/fighters/${fight.f2_id}` } : {}) },
        ],
        superEvent: { "@type": "SportsEvent", name: fight.event_name, url: `${SITE_URL}/events/${fight.event_id}` },
        ...(fight.location ? { location: { "@type": "Place", name: fight.location } } : {}),
      },
      summary: `<h1>${htmlEscape(name)}</h1><p>${link(`/events/${fight.event_id}`, fight.event_name)} · ${htmlEscape(fight.date)} · ${htmlEscape(fight.weight_class)}.${htmlEscape(result)}</p>`,
    };
  }
  if (parts[1] === "fighters") {
    const fighter = prepared("SELECT id, name, nickname, wins, losses, draws, photo_url FROM fighters WHERE id = ?").get(id) as any;
    if (!fighter || !hasUfcFight(id)) return notFound();
    const record = recordText(currentRecord(fighter.id, fighter).value);
    return {
      ...DEFAULT,
      title: `${fighter.name} — Record & Fight History | ufc.sh`,
      description: `${fighter.name}${fighter.nickname ? ` “${fighter.nickname}”` : ""} UFC profile: ${record} record, physical statistics, ranking, every ranked statistic and complete fight history.`,
      canonical: `${SITE_URL}/fighters/${fighter.id}`,
      type: "profile",
      image: `${SITE_URL}/og/fighters/${fighter.id}.jpg`,
      structuredData: {
        "@context": "https://schema.org", "@type": "Person", name: fighter.name,
        ...(fighter.nickname ? { alternateName: fighter.nickname } : {}),
        url: `${SITE_URL}/fighters/${fighter.id}`,
        ...(fighter.photo_url ? { image: fighter.photo_url } : {}),
      },
      summary: `<h1>${htmlEscape(fighter.name)}</h1><p>Professional record ${htmlEscape(record)}.</p>`,
    };
  }
  if (parts[1] === "judges" || parts[1] === "referees") {
    const index = officialsIndex();
    const official = (parts[1] === "judges" ? index.judgeSlugs : index.refereeSlugs).get(id);
    if (!official) return notFound();
    const role = parts[1] === "judges" ? "judge" : "referee";
    const url = `${SITE_URL}/${parts[1]}/${official.slug}`;
    const years = official.fights.length ? `${official.fights.at(-1)!.fight.year}–${official.fights[0].fight.year}` : "";
    const count = official.fights.length.toLocaleString("en-US");
    const bouts = (rows: { fight_id: string; event_name: string; date: string; f1: { name: string }; f2: { name: string } }[]) =>
      `<ul>${rows.map((row) => `<li>${link(`/fights/${row.fight_id}`, `${row.f1.name} vs ${row.f2.name}`)} · ${htmlEscape(row.event_name)} (${htmlEscape(row.date)})</li>`).join("")}</ul>`;
    let description: string;
    let facts: string;
    let list: string;
    if (role === "judge") {
      const profile = judgeProfile(official.slug, new URLSearchParams()) as any;
      const s = profile.summary;
      description = `${official.name}, UFC judge${years ? ` (${years})` : ""}: ${count} scorecards, picked the winner on ${s.agreed_result_rate ?? "—"}%, lone dissent on ${s.dissent_rate ?? "—"}%, 10–8s on ${s.ten_eight_rate ?? "—"}% of rounds, and every card beside the other judges and the fans.`;
      facts = `Picked the winner ${s.agreed_result_rate ?? "—"}% · Lone dissents ${s.dissent_rate ?? "—"}% · Rounds agreed ${s.round_agreement_rate ?? "—"}%`;
      list = bouts(profile.rows);
    } else {
      const profile = refereeProfile(official.slug, new URLSearchParams()) as any;
      const s = profile.summary;
      description = `${official.name}, UFC referee${years ? ` (${years})` : ""}: ${count} bouts, ${s.finish_rate ?? "—"}% finished (UFC ${profile.baseline.finish_rate ?? "—"}%), ${s.title_fights} title bouts, stoppages by round, disqualifications and every bout they refereed.`;
      facts = `Finished ${s.finish_rate ?? "—"}% · KO/TKO ${s.ko_rate ?? "—"}% · Submission ${s.sub_rate ?? "—"}% · Decision ${s.decision_rate ?? "—"}%`;
      list = bouts(profile.rows);
    }
    return {
      ...DEFAULT,
      title: `${official.name} — UFC ${role === "judge" ? "Judge Scorecards & Stats" : "Referee Record & Stoppages"} | ufc.sh`,
      description,
      canonical: url,
      type: "profile",
      structuredData: {
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "ProfilePage", url, name: `${official.name} — UFC ${role}`, mainEntity: { "@type": "Person", name: official.name, jobTitle: `MMA ${role}`, url } },
          { "@type": "BreadcrumbList", itemListElement: [
            { "@type": "ListItem", position: 1, name: "Judges & referees", item: `${SITE_URL}/officials` },
            { "@type": "ListItem", position: 2, name: official.name, item: url },
          ] },
        ],
      },
      summary: `<h1>${htmlEscape(official.name)}</h1><p>UFC ${role} · ${count} ${role === "judge" ? "scorecards" : "bouts"}${years ? ` · ${years}` : ""}. ${htmlEscape(facts)}. ${link("/officials", "All judges & referees")}</p>${list}`,
    };
  }
  if (parts[1] === "venues") {
    const venue = venueBySlug(id);
    if (!venue) return notFound();
    const place = [venue.city, venue.state, venue.country].filter(Boolean).join(", ");
    const page = venuePage(venue.slug) as any;
    const held = page.summary.events as number;
    const url = `${SITE_URL}/venues/${venue.slug}`;
    const span = page.summary.first ? `${page.summary.first.slice(0, 4)}–${page.summary.last.slice(0, 4)}` : "";
    const titles = page.title_bouts as { fight_id: string; event_name: string; date: string; division: string; f1: { name: string }; f2: { name: string } }[];
    return {
      ...DEFAULT,
      title: `${venue.name} — UFC Events & Title Fights | ufc.sh`,
      description: `Every UFC event at ${venue.name}${place ? `, ${place}` : ""}${span ? ` (${span})` : ""}: ${held} ${held === 1 ? "card" : "cards"}, ${page.summary.fights.toLocaleString("en-US")} bouts, ${page.summary.title_fights} title fights${page.summary.attendance_record && page.summary.attendance_known >= 3 ? `, a record crowd of ${page.summary.attendance_record.attendance.toLocaleString("en-US")}` : ""} and upcoming events.`,
      canonical: url,
      structuredData: {
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "StadiumOrArena", name: venue.name, url, ...(venue.former_names.length ? { alternateName: venue.former_names } : {}),
            ...(place ? { address: { "@type": "PostalAddress", addressLocality: venue.city ?? undefined, addressRegion: venue.state ?? undefined, addressCountry: venue.country ?? undefined } } : {}) },
          { "@type": "BreadcrumbList", itemListElement: [
            { "@type": "ListItem", position: 1, name: "Venues", item: `${SITE_URL}/venues` },
            { "@type": "ListItem", position: 2, name: venue.name, item: url },
          ] },
        ],
      },
      summary: `<h1>${htmlEscape(venue.name)}</h1><p>${htmlEscape([place, span].filter(Boolean).join(" · "))}. ${held} UFC cards, ${page.summary.title_fights} title fights. ${link("/venues", "All venues")}</p>`
        + (titles.length ? `<h2>Title fights</h2><ul>${titles.map((bout) => `<li>${link(`/fights/${bout.fight_id}`, `${bout.f1.name} vs ${bout.f2.name}`)} · ${htmlEscape(bout.division)} · ${htmlEscape(bout.event_name)} (${htmlEscape(bout.date)})</li>`).join("")}</ul>` : "")
        + `<h2>Events</h2><ul>${venue.events.slice(0, 60).map((event) => `<li>${link(`/events/${event.id}`, event.name)} (${htmlEscape(event.date)})</li>`).join("")}</ul>`,
    };
  }
  if (parts[1] === "locations") {
    const location = venueIndex().locations.get(id);
    if (!location) return notFound();
    const page = locationPage(location.slug) as any;
    const held = page.summary.events as number;
    const url = `${SITE_URL}/locations/${location.slug}`;
    const span = page.summary.first ? `${page.summary.first.slice(0, 4)}–${page.summary.last.slice(0, 4)}` : "";
    const venues = page.venues as { slug: string; name: string }[];
    return {
      ...DEFAULT,
      title: `UFC in ${location.city} — Events, Venues & Title Fights | ufc.sh`,
      description: `Every UFC event in ${location.name}${span ? ` (${span})` : ""}: ${held} ${held === 1 ? "card" : "cards"}, ${page.summary.fights.toLocaleString("en-US")} bouts, ${page.summary.title_fights} title fights and upcoming events.`,
      canonical: url,
      structuredData: {
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "City", name: location.city, url, address: { "@type": "PostalAddress", addressLocality: location.city, addressRegion: location.state ?? undefined, addressCountry: location.country ?? undefined } },
          { "@type": "BreadcrumbList", itemListElement: [
            { "@type": "ListItem", position: 1, name: "Locations", item: `${SITE_URL}/locations` },
            { "@type": "ListItem", position: 2, name: location.city, item: url },
          ] },
        ],
      },
      summary: `<h1>UFC in ${htmlEscape(location.name)}</h1><p>${held} UFC cards${span ? ` · ${span}` : ""}, ${page.summary.title_fights} title fights. ${link("/locations", "All locations")}</p>`
        + (venues.length ? `<h2>Venues</h2><ul>${venues.map((venue) => `<li>${link(`/venues/${venue.slug}`, venue.name)}</li>`).join("")}</ul>` : "")
        + `<h2>Events</h2><ul>${location.events.slice(0, 60).map((event) => `<li>${link(`/events/${event.id}`, event.name)} (${htmlEscape(event.date)})</li>`).join("")}</ul>`,
    };
  }
  return notFound();
}

export function injectPageSeo(html: string, pathname: string, seo = pageSeo(pathname)): string {
  const replaceMeta = (source: string, attribute: "name" | "property", key: string, value: string) => {
    const pattern = new RegExp(`<meta\\s+${attribute}="${key}"\\s+content="[^"]*"\\s*/?>`);
    const tag = `<meta ${attribute}="${key}" content="${htmlEscape(value)}" />`;
    return pattern.test(source) ? source.replace(pattern, () => tag) : source.replace("</head>", `    ${tag}\n  </head>`);
  };
  let result = html.replace(/<title>[^<]*<\/title>/, () => `<title>${htmlEscape(seo.title)}</title>`);
  if (seo.noindex || pathname.startsWith("/admin")) {
    result = result.replace(/<meta\s+name="robots"\s+content="[^"]*"\s*\/?>/, '<meta name="robots" content="noindex, nofollow" />');
  }
  result = replaceMeta(result, "name", "description", seo.description);
  result = replaceMeta(result, "property", "og:title", seo.title);
  result = replaceMeta(result, "property", "og:description", seo.description);
  result = replaceMeta(result, "property", "og:type", seo.type);
  result = replaceMeta(result, "property", "og:url", seo.canonical);
  result = replaceMeta(result, "name", "twitter:title", seo.title);
  result = replaceMeta(result, "name", "twitter:description", seo.description);
  if (seo.image) {
    result = replaceMeta(result, "property", "og:image", seo.image);
    result = replaceMeta(result, "property", "og:image:width", "1200");
    result = replaceMeta(result, "property", "og:image:height", "630");
    result = replaceMeta(result, "name", "twitter:image", seo.image);
    result = replaceMeta(result, "name", "twitter:card", "summary_large_image");
  }
  result = result.replace(/<link\s+rel="canonical"\s+href="[^"]*"\s*\/>/, () => `<link rel="canonical" href="${htmlEscape(seo.canonical)}" />`);
  if (seo.structuredData) {
    const json = JSON.stringify(seo.structuredData).replace(/</g, "\\u003c");
    result = result.replace("</head>", `    <script id="route-structured-data" type="application/ld+json">${json}</script>\n  </head>`);
  }
  if (seo.summary) result = result.replace(/<noscript>[\s\S]*?<\/noscript>/, () => `<noscript>${seo.summary}<p>ufc.sh needs JavaScript for its interactive cards, charts and odds.</p></noscript>`);
  return result;
}

export function sitemap(): string {
  const events = prepared("SELECT id, date FROM events ORDER BY date DESC").all() as { id: string; date: string }[];
  const fights = prepared("SELECT f.id, e.date FROM fights f JOIN events e ON e.id = f.event_id ORDER BY e.date DESC")
    .all() as { id: string; date: string }[];
  const fighters = prepared(`
    SELECT id FROM fighters fr
    WHERE ${ufcFightExistsSql("fr.id", "f")}
    ORDER BY id
  `).all() as { id: string }[];
  const officials = officialsIndex();
  const venues = venueIndex();
  const today = new Date().toISOString().slice(0, 10);
  // A past card's page stops changing soon after it is fought; say so.
  const entry = (route: string, date?: string) => `<url><loc>${xmlEscape(`${SITE_URL}${route}`)}</loc>${date && date <= today ? `<lastmod>${date}</lastmod>` : ""}</url>`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    entry("/"),
    entry(`/events/${POTENTIAL_EVENT_ID}`),
    ...Object.keys(STATIC_PAGES).map((route) => entry(route)),
    ...events.map((event) => entry(`/events/${encodeURIComponent(event.id)}`, event.date)),
    ...fights.map((fight) => entry(`/fights/${encodeURIComponent(fight.id)}`, fight.date)),
    ...fighters.map((fighter) => entry(`/fighters/${encodeURIComponent(fighter.id)}`)),
    ...[...officials.judgeSlugs.values()].map((judge) => entry(`/judges/${judge.slug}`, judge.fights[0]?.fight.date)),
    ...[...officials.refereeSlugs.values()].map((referee) => entry(`/referees/${referee.slug}`, referee.fights[0]?.fight.date)),
    ...[...venues.bySlug.values()].map((venue) => entry(`/venues/${venue.slug}`, venue.events.find((event) => event.complete)?.date)),
    ...[...venues.locations.values()].map((location) => entry(`/locations/${location.slug}`, location.events.find((event) => event.complete)?.date)),
    "</urlset>",
  ].join("");
}
