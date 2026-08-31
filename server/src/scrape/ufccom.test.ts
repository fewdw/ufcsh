import assert from "node:assert/strict";
import test from "node:test";
import { parseRankingsHtml } from "./ufccom.ts";

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
