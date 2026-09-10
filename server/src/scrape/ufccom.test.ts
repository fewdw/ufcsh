import assert from "node:assert/strict";
import test from "node:test";
import { athleteSlug, parseAthleteImages, parseRankingsHtml, parseSearchAthlete, scrapeFighterImages } from "./ufccom.ts";

const MEDIA_LABELS = [
  "Men's Pound-for-Pound",
  "Peso mosca",
  "Poids coq",
  "Featherweight",
  "Ligero",
  "Poids mi-moyen",
  "Peso medio",
  "Poids mi-lourd",
  "De peso pesado",
  "Women's Pound-for-Pound",
  "Peso de la mujer",
  "Poids mouche féminin",
  "Gallo de las mujeres",
];

const MEDIA_DIVISIONS = [
  "Men's Pound-for-Pound",
  "Flyweight",
  "Bantamweight",
  "Featherweight",
  "Lightweight",
  "Welterweight",
  "Middleweight",
  "Light Heavyweight",
  "Heavyweight",
  "Women's Pound-for-Pound",
  "Women's Strawweight",
  "Women's Flyweight",
  "Women's Bantamweight",
];

const META_DIVISIONS = [
  "Flyweight",
  "Bantamweight",
  "Featherweight",
  "Lightweight",
  "Welterweight",
  "Middleweight",
  "Light Heavyweight",
  "Heavyweight",
  "Women's Strawweight",
  "Women's Flyweight",
  "Women's Bantamweight",
];

function group(label: string, index: number, meta: boolean, rankChange = ""): string {
  const prefix = meta ? "meta-weight-class" : "weight-class";
  const rows = Array.from({ length: 15 }, (_, i) => {
    const rank = i + 1;
    return `<tr>
      <td class="views-field-${prefix}-rank">${rank}</td>
      <td class="views-field-title">Fighter ${index}-${rank}</td>
      <td class="views-field-${prefix}-rank-change">${rank === 1 ? rankChange : ""}</td>
    </tr>`;
  }).join("");
  return `
    <div class="view-grouping">
      <div class="view-grouping-header">${label}</div>
      <div class="rankings--athlete--champion"><h5>Champion ${index}</h5></div>
      <table><tbody>${rows}</tbody></table>
    </div>`;
}

function page(mediaLabels = MEDIA_LABELS, metaLabels = META_DIVISIONS): string {
  const increase = '<span class="athlete-rankings--rank-change athlete-rankings--rank-increase">Up</span> 2';
  return `
    <div class="view-display-id-block_1">
      ${mediaLabels.map((label, i) => group(label, i, false)).join("")}
    </div>
    <div class="view-display-id-meta_rankings">
      ${metaLabels.map((label, i) => group(label, i, true, i === 10 ? increase : "")).join("")}
    </div>`;
}

test("parses and separates complete Media and Meta ranking views", () => {
  const rankings = parseRankingsHtml(page());

  assert.deepEqual(rankings.media.map((division) => division.division), MEDIA_DIVISIONS);
  assert.deepEqual(rankings.meta.map((division) => division.division), META_DIVISIONS);
  assert.equal(rankings.media.length, 13);
  assert.equal(rankings.meta.length, 11);
  assert.equal(rankings.media[0].entries.length, 15);
  assert.equal(rankings.media[1].entries.length, 16);
  assert.equal(rankings.meta[0].entries.length, 16);
  assert.equal(rankings.meta[10].entries[1].rankChange, "+2");
  assert.equal(rankings.meta[8].weightLimit, "115 lbs");
});

test("uses each view's stable division order for completely unknown languages", () => {
  const unknownMedia = MEDIA_DIVISIONS.map((_, i) => `Unknown media label ${i}`);
  const unknownMeta = META_DIVISIONS.map((_, i) => `Unknown meta label ${i}`);
  const rankings = parseRankingsHtml(page(unknownMedia, unknownMeta));

  assert.deepEqual(rankings.media.map((division) => division.division), MEDIA_DIVISIONS);
  assert.deepEqual(rankings.meta.map((division) => division.division), META_DIVISIONS);
});

test("rejects a partial ranking view instead of returning inaccurate data", () => {
  assert.throws(
    () => parseRankingsHtml(page(MEDIA_LABELS.slice(0, 12))),
    /media rankings divisions invalid/,
  );
});

// ---------------------------------------------------------------------------
// Athlete pictures

const athletePage = ({ og, fullBody, extra = "" }: { og?: string; fullBody?: string; extra?: string }) => `
<html><head>
  ${og ? `<meta property="og:image" content="${og}" />` : ""}
</head><body>
  <div class="hero-profile">
    ${fullBody ? `<img src="${fullBody}">` : ""}
  </div>
  <div class="athlete-results">
    <img src="https://ufc.com/images/styles/event_results_athlete_headshot/s3/2025-10/OPPONENT_ONE_10-25.png?itok=aaa">
    <img src="https://ufc.com/images/styles/event_results_athlete_headshot/s3/2025-10/OPPONENT_TWO_10-25.png?itok=bbb">
  </div>
  ${extra}
</body></html>`;

test("takes the bio hero as the full body and never an opponent's headshot", () => {
  const images = parseAthleteImages(athletePage({
    og: "https://ufc.com/images/styles/teaser/s3/2025-10/ABDELWAHAB_HAMDY_10-25.png?itok=xyz",
    fullBody: "https://ufc.com/images/styles/athlete_bio_full_body/s3/2025-10/ABDELWAHAB_HAMDY_L_10-25.png?itok=O14",
  }));

  assert.equal(images.headshot, "https://ufc.com/images/styles/teaser/s3/2025-10/ABDELWAHAB_HAMDY_10-25.png?itok=xyz");
  assert.equal(images.fullBody, "https://ufc.com/images/styles/athlete_bio_full_body/s3/2025-10/ABDELWAHAB_HAMDY_L_10-25.png?itok=O14");
});

test("a fighter with no full-body art still yields a headshot", () => {
  const images = parseAthleteImages(athletePage({ og: "https://ufc.com/images/styles/teaser/s3/LIDDELL_CHUCK.png" }));
  assert.equal(images.headshot, "https://ufc.com/images/styles/teaser/s3/LIDDELL_CHUCK.png");
  assert.equal(images.fullBody, null);
});

test("reads the hero wrapper when the full-body image style is renamed", () => {
  const images = parseAthleteImages(
    `<html><body>
       <div class="hero-profile__image-wrap"><img src="/images/styles/whatever_new/s3/POGUES_JAMAL_L.png" class="hero-profile__image"></div>
       <div class="athlete-results"><img src="https://ufc.com/images/styles/event_results_athlete_headshot/s3/OPPONENT.png"></div>
     </body></html>`,
  );
  assert.equal(images.fullBody, "https://www.ufc.com/images/styles/whatever_new/s3/POGUES_JAMAL_L.png");
});

test("treats the roster placeholder as no picture, and never borrows an opponent's face", () => {
  const images = parseAthleteImages(athletePage({ og: "/themes/custom/ufc/assets/img/no-profile-image.png" }));
  assert.equal(images.headshot, null);
  assert.equal(images.fullBody, null);
});

test("refuses the shadow figure ufc.com stands in for an unphotographed athlete", () => {
  // Served through the very image style the real cut-outs use, so only the file
  // name gives it away. Left in, the fighter stands as a grey outline in the
  // matchup beside an empty round avatar, and no later pass ever corrects it.
  const images = parseAthleteImages(athletePage({
    fullBody: "https://ufc.com/images/styles/athlete_bio_full_body/s3/image/fighter_images/SHADOW_Fighter_fullLength_RED.png?itok=DfVddCfn",
  }));
  assert.equal(images.headshot, null);
  assert.equal(images.fullBody, null);
});

test("refuses the roster stand-ins whatever case ufc.com spells them in", () => {
  for (const placeholder of [
    "https://ufc.com/images/2019-04/SILHOUETTE.png?VersionId=gr9Cvr32",
    "https://www.ufc.com/themes/custom/ufc/assets/img/silhouette-headshot-female.png",
    "https://ufc.com/images/styles/teaser/s3/image/fighter_images/Shadow/UFCWomen_Headshot.png?itok=zreVzeAW",
    "/themes/custom/ufc/assets/img/no-profile-image.png",
  ]) {
    assert.equal(parseAthleteImages(athletePage({ og: placeholder })).headshot, null, placeholder);
  }
});

test("keeps a real picture whose name merely looks like a stand-in", () => {
  const images = parseAthleteImages(athletePage({
    og: "https://ufc.com/images/2026-09/SHADOWY_JONES_09-05.png",
  }));
  assert.equal(images.headshot, "https://ufc.com/images/2026-09/SHADOWY_JONES_09-05.png");
});

test("an athlete page with no pictures reports none rather than throwing", () => {
  assert.deepEqual(parseAthleteImages("<html><body><p>Not found</p></body></html>"), {
    headshot: null,
    fullBody: null,
  });
});

test("a search hit is followed to the athlete page that holds the full body", () => {
  const hit = parseSearchAthlete(`
    <div class="solr-athlete-card">
      <a href="/athlete/petr-yan"><img src="/images/styles/teaser/s3/YAN_PETR.png"></a>
    </div>`);
  assert.equal(hit.href, "https://www.ufc.com/athlete/petr-yan");
  assert.equal(hit.img, "https://www.ufc.com/images/styles/teaser/s3/YAN_PETR.png");
});

test("slugs a name the way ufc.com spells its athlete URLs", () => {
  assert.equal(athleteSlug("José Aldo"), "jose-aldo");
  assert.equal(athleteSlug("Yair Rodríguez"), "yair-rodriguez");
  assert.equal(athleteSlug("Khalil Rountree Jr."), "khalil-rountree-jr");
});

test("continues searching for a full body when the direct page only has a headshot", async () => {
  const visited: string[] = [];
  const images = await scrapeFighterImages("Test Fighter", async (url) => {
    visited.push(url);
    if (url.includes("/search?")) return '<div class="solr-athlete-card"><a href="/athlete/test-fighter-correct"><h2>Test Fighter</h2><img src="/images/HEAD.png"></a></div>';
    if (url.endsWith("-correct")) return athletePage({ fullBody: "/images/styles/athlete_bio_full_body/s3/FIGHTER_L.png" });
    return athletePage({ og: "/images/HEAD.png" });
  });
  assert.equal(visited.length, 3);
  assert.equal(images.headshot, "https://www.ufc.com/images/HEAD.png");
  assert.equal(images.fullBody, "https://www.ufc.com/images/styles/athlete_bio_full_body/s3/FIGHTER_L.png");
});

test("retains the direct headshot if the full-body search fails", async () => {
  const images = await scrapeFighterImages("Test Fighter", async (url) => {
    if (url.includes("/search?")) throw new Error("unavailable");
    return athletePage({ og: "/images/HEAD.png" });
  });
  assert.deepEqual(images, { headshot: "https://www.ufc.com/images/HEAD.png", fullBody: null });
});

test("search ignores unrelated athletes and finds the matching name beyond the first card", () => {
  const html = '<div class="solr-athlete-card"><a href="/athlete/other"><h2>Other Fighter</h2></a></div>' +
    '<div class="solr-athlete-card"><a href="/athlete/correct"><h2>José Aldo</h2><img src="/images/ALDO.png"></a></div>';
  assert.equal(parseSearchAthlete(html, "Jose Aldo").href, "https://www.ufc.com/athlete/correct");
  assert.deepEqual(parseSearchAthlete(html, "Missing Fighter"), { href: null, img: null });
});
