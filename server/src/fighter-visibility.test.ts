import test from "node:test";
import assert from "node:assert/strict";
import { db } from "./db.ts";
import {
  getFighter,
  getFighterPreview,
  hasCompletedUfcFight,
  pageSeo,
  search,
  sitemap,
} from "./api.ts";

const STRAY_FIGHTER_ID = "9211aae062b799d6";

test("a directory-only identity is not a browsable UFC fighter", async () => {
  assert.equal(hasCompletedUfcFight(STRAY_FIGHTER_ID), false);
  assert.equal(await getFighter(STRAY_FIGHTER_ID, "meta"), null);
  assert.equal(getFighterPreview(STRAY_FIGHTER_ID), null);
});

test("fighter search returns only athletes with a recorded UFC result", () => {
  const rows = db.prepare(`
    SELECT id, name FROM fighters
    WHERE NOT EXISTS (
      SELECT 1 FROM fights f
      WHERE (f.f1_id = fighters.id OR f.f2_id = fighters.id)
        AND (f.f1_outcome IS NOT NULL OR f.f2_outcome IS NOT NULL)
    )
    ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, id
    LIMIT 25
  `).all(STRAY_FIGHTER_ID) as { id: string; name: string }[];

  assert.ok(rows.length > 0, "fixture should include at least one directory-only identity or debutant");
  for (const row of rows) {
    const result = search(row.name) as { fighters: { id: string }[] };
    assert.equal(result.fighters.some((fighter) => fighter.id === row.id), false, row.name);
  }
});

test("non-UFC fighter profiles are absent from discovery metadata", () => {
  assert.equal(sitemap().includes(`/fighters/${STRAY_FIGHTER_ID}`), false);
  assert.equal(pageSeo(`/fighters/${STRAY_FIGHTER_ID}`).canonical, "https://ufc.sh/");
});
