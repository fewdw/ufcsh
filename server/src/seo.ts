import { prepared } from "./db.ts";
import { completedUfcFightExistsSql, currentRecord, hasCompletedUfcFight, recordText } from "./fighter-identity.ts";
import { officialsIndex } from "./officials.ts";
import { venueIndex } from "./venues.ts";

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
};

const HTML_ENTITIES: Record<string, string> = { "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&#39;", '"': "&quot;" };
export function htmlEscape(value: string): string {
  return value.replace(/[<>&'"]/g, (char) => HTML_ENTITIES[char]);
}
const XML_ENTITIES: Record<string, string> = { "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" };
const xmlEscape = (value: string) => value.replace(/[<>&'"]/g, (char) => XML_ENTITIES[char]);

const SITE_IMAGE = `${SITE_URL}/og/site.jpg`;
const DEFAULT: Omit<PageSeo, "canonical"> = {
  title: "UFC Events, Odds, Stats & Rankings | ufc.sh",
  description: "Explore UFC fight cards, matchup odds, results, fighter statistics and current rankings in one fast interface.",
  type: "website",
  image: SITE_IMAGE,
  status: 200,
};

const STATIC_PAGES: Record<string, { title: string; description: string }> = {
  "/rankings": { title: "UFC Rankings by Division | ufc.sh", description: "Current UFC rankings by division, including champions, activity and each fighter's next booking." },
  "/stats": { title: "UFC Statistics Leaderboards | ufc.sh", description: "All-time UFC leaderboards for records, finishes, output, opposition and the betting market, with the bouts behind every number." },
  "/labs": { title: "UFC Labs — Fighter-Bout Studies | ufc.sh", description: "Build a population of UFC fighter-bouts by age, streak, layoff, odds and more, and read its combined record." },
  "/officials": { title: "UFC Judges & Referees | ufc.sh", description: "Every UFC judge and referee on record: scorecards, agreement, dissents, stoppages and the bouts behind each number." },
  "/venues": { title: "UFC Venues | ufc.sh", description: "Every arena that has hosted a UFC event, with the cards held there, attendance and upcoming events." },
  "/info": { title: "About, Sources & Methods | ufc.sh", description: "About UFC.sh: an independent, fan-made UFC research tool. Data sources, definitions, community rules, privacy and changelog." },
};

const link = (href: string, text: string) => `<a href="${htmlEscape(href)}">${htmlEscape(text)}</a>`;
const notFound = (): PageSeo => ({
  ...DEFAULT, title: "Page not found | ufc.sh", description: "This page could not be found on ufc.sh.",
  canonical: `${SITE_URL}/`, status: 404, noindex: true,
});

export function pageSeo(pathname: string): PageSeo {
  const home: PageSeo = { ...DEFAULT, canonical: `${SITE_URL}/`, summary: `<p>${link("/rankings", "Rankings")} · ${link("/stats", "Statistics")} · ${link("/officials", "Judges & referees")} · ${link("/venues", "Venues")} · ${link("/info", "About")}</p>` };
  if (pathname === "/" || pathname === "/index.html") return home;
  const fixed = STATIC_PAGES[pathname];
  if (fixed) return { ...DEFAULT, ...fixed, canonical: `${SITE_URL}${pathname}` };
  if (pathname === "/admin" || pathname === "/admin/bugs" || /^\/sign-(in|up)(\/|$)/.test(pathname)) return { ...home, noindex: true };
  const parts = pathname.split("/");
  const id = decodeURIComponent(parts[2] ?? "");
  if (parts.length !== 3 || !id) return notFound();
  if (parts[1] === "profiles") return { ...home, canonical: `${SITE_URL}${pathname}`, title: "Fan profile | ufc.sh", description: "A fan's UFC scorecards, predictions and how often their cards matched the judges." };

  if (parts[1] === "events") {
    const event = prepared("SELECT id, name, date, location, complete FROM events WHERE id = ?").get(id) as { id: string; name: string; date: string; location: string; complete: number } | undefined;
    if (!event) return notFound();
    const fights = prepared("SELECT id, f1_name, f2_name, weight_class FROM fights WHERE event_id = ? ORDER BY ord").all(id) as { id: string; f1_name: string; f2_name: string; weight_class: string }[];
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
          { "@type": "Person", name: fight.f1_name, ...(hasCompletedUfcFight(fight.f1_id) ? { url: `${SITE_URL}/fighters/${fight.f1_id}` } : {}) },
          { "@type": "Person", name: fight.f2_name, ...(hasCompletedUfcFight(fight.f2_id) ? { url: `${SITE_URL}/fighters/${fight.f2_id}` } : {}) },
        ],
        superEvent: { "@type": "SportsEvent", name: fight.event_name, url: `${SITE_URL}/events/${fight.event_id}` },
        ...(fight.location ? { location: { "@type": "Place", name: fight.location } } : {}),
      },
      summary: `<h1>${htmlEscape(name)}</h1><p>${link(`/events/${fight.event_id}`, fight.event_name)} · ${htmlEscape(fight.date)} · ${htmlEscape(fight.weight_class)}.${htmlEscape(result)}</p>`,
    };
  }
  if (parts[1] === "fighters") {
    const fighter = prepared("SELECT id, name, nickname, wins, losses, draws, photo_url FROM fighters WHERE id = ?").get(id) as any;
    if (!fighter || !hasCompletedUfcFight(id)) return notFound();
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
    return {
      ...DEFAULT,
      title: `${official.name} — UFC ${role === "judge" ? "Judge Scorecards" : "Referee Record"} | ufc.sh`,
      description: role === "judge"
        ? `${official.name}: ${official.fights.length.toLocaleString("en-US")} UFC scorecards, dissent rate, 10–8 frequency and agreement with other judges and fans.`
        : `${official.name}: ${official.fights.length.toLocaleString("en-US")} UFC bouts refereed, stoppage types and disqualifications, against a UFC-wide baseline.`,
      canonical: `${SITE_URL}/${parts[1]}/${official.slug}`,
      type: "profile",
      structuredData: { "@context": "https://schema.org", "@type": "Person", name: official.name, jobTitle: `MMA ${role}`, url: `${SITE_URL}/${parts[1]}/${official.slug}` },
      summary: `<h1>${htmlEscape(official.name)}</h1><p>UFC ${role}, ${official.fights.length} bouts on record. ${link("/officials", "All officials")}</p>`,
    };
  }
  if (parts[1] === "venues") {
    const venue = venueIndex().bySlug.get(id);
    if (!venue) return notFound();
    const place = [venue.city, venue.country].filter(Boolean).join(", ");
    const held = venue.events.filter((event) => event.complete).length;
    return {
      ...DEFAULT,
      title: `${venue.name} — UFC Events | ufc.sh`,
      description: `Every UFC event at ${venue.name}${place ? `, ${place}` : ""}: ${held} ${held === 1 ? "card" : "cards"} held, attendance and upcoming events.`,
      canonical: `${SITE_URL}/venues/${venue.slug}`,
      structuredData: { "@context": "https://schema.org", "@type": "StadiumOrArena", name: venue.name, url: `${SITE_URL}/venues/${venue.slug}`, ...(place ? { address: place } : {}) },
      summary: `<h1>${htmlEscape(venue.name)}</h1><p>${htmlEscape(place)}</p><ul>${venue.events.slice(0, 40).map((event) => `<li>${link(`/events/${event.id}`, event.name)} (${htmlEscape(event.date)})</li>`).join("")}</ul>`,
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
    WHERE ${completedUfcFightExistsSql("fr.id", "f")}
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
    ...Object.keys(STATIC_PAGES).map((route) => entry(route)),
    ...events.map((event) => entry(`/events/${encodeURIComponent(event.id)}`, event.date)),
    ...fights.map((fight) => entry(`/fights/${encodeURIComponent(fight.id)}`, fight.date)),
    ...fighters.map((fighter) => entry(`/fighters/${encodeURIComponent(fighter.id)}`)),
    ...[...officials.judgeSlugs.keys()].map((slug) => entry(`/judges/${slug}`)),
    ...[...officials.refereeSlugs.keys()].map((slug) => entry(`/referees/${slug}`)),
    ...[...venues.bySlug.keys()].map((slug) => entry(`/venues/${slug}`)),
    "</urlset>",
  ].join("");
}
