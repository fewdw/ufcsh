import test from "node:test";
import assert from "node:assert/strict";
import { injectPageSeo, pageRedirect, pageSeo } from "./seo.ts";
import { db } from "./db.ts";

test("unknown routes and unknown records answer 404 and ask not to be indexed", () => {
  for (const path of ["/nope", "/graphic", "/fighters/0000000000000000", "/fights/zzz", "/judges/no-one", "/venues/nowhere", "/events/a/b"]) {
    const seo = pageSeo(path);
    assert.equal(seo.status, 404, path);
    assert.equal(seo.noindex, true, path);
  }
});

test("known routes answer 200 with a canonical address and share image", () => {
  const fight = db.prepare("SELECT id FROM fights LIMIT 1").get() as { id: string } | undefined;
  for (const path of ["/", "/rankings", "/stats", "/officials", "/venues", "/info", ...(fight ? [`/fights/${fight.id}`] : [])]) {
    const seo = pageSeo(path);
    assert.equal(seo.status, 200, path);
    assert.ok(seo.canonical.startsWith("http"), path);
    assert.ok(seo.image, path);
  }
});

test("page metadata is escaped and the preview becomes a large image", () => {
  const html = `<html><head><title>x</title><meta name="description" content="x" /><meta name="twitter:card" content="summary" /><link rel="canonical" href="x" /></head><body><noscript>old</noscript></body></html>`;
  const out = injectPageSeo(html, "/x", {
    title: `A "quoted" <title>`, description: "d", canonical: "https://ufc.sh/x", type: "website", status: 200,
    image: "https://ufc.sh/og/site.jpg", summary: "<p>hi</p>",
  });
  assert.match(out, /<title>A &quot;quoted&quot; &lt;title&gt;<\/title>/);
  assert.match(out, /twitter:card" content="summary_large_image"/);
  assert.match(out, /og:image" content="https:\/\/ufc.sh\/og\/site.jpg"/);
  assert.match(out, /<noscript><p>hi<\/p>/);
});

test("stream overlays load for a streaming tool but are never indexed", () => {
  for (const path of ["/overlay", "/overlay/7a2c841693b54dd7"]) {
    const seo = pageSeo(path);
    assert.equal(seo.status ?? 200, 200, path);
    assert.equal(seo.noindex, true, path);
  }
  assert.equal(pageSeo("/overlay/not-a-fight").status, 404);
});

test("a fighter or bout written by name, or an id with junk pasted after it, redirects to its page", () => {
  const slug = (name: string) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  // The latest meeting of two fighters whose names no one else's read as.
  const slugs = new Map<string, number>();
  for (const { name } of db.prepare("SELECT name FROM fighters").all() as { name: string }[]) slugs.set(slug(name), (slugs.get(slug(name)) ?? 0) + 1);
  const fight = (db.prepare(`SELECT f.id, a.id AS a, a.name AS a_name, b.name AS b_name FROM fights f
    JOIN fighters a ON a.id = f.f1_id JOIN fighters b ON b.id = f.f2_id JOIN events e ON e.id = f.event_id
    WHERE NOT EXISTS (SELECT 1 FROM fights g JOIN events ge ON ge.id = g.event_id
      WHERE ((g.f1_id = f.f1_id AND g.f2_id = f.f2_id) OR (g.f1_id = f.f2_id AND g.f2_id = f.f1_id)) AND ge.date > e.date)
    ORDER BY e.date DESC LIMIT 500`).all() as { id: string; a: string; a_name: string; b_name: string }[])
    .find(row => slugs.get(slug(row.a_name)) === 1 && slugs.get(slug(row.b_name)) === 1);
  if (!fight) return;
  assert.equal(pageRedirect(`/fighters/${slug(fight.a_name)}`), `/fighters/${fight.a}`);
  assert.equal(pageRedirect(`/fights/${slug(fight.b_name)}-vs-${slug(fight.a_name)}`), `/fights/${fight.id}`);
  assert.equal(pageRedirect(`/fights/${fight.id}&gsessionid=abc`), `/fights/${fight.id}`);
  const seo = pageSeo(`/fighters/${slug(fight.a_name)}`);
  assert.equal(seo.status, 301);
  assert.equal(seo.redirect, `/fighters/${fight.a}`);
  assert.equal(pageRedirect("/events"), "/");
  assert.equal(pageRedirect("/contact"), "/info");
  for (const path of ["/fighters/no-one-by-this-name", "/fights/no-one-vs-nobody", "/fights/0000000000000000&x", "/nope"]) {
    assert.equal(pageRedirect(path), null, path);
  }
});
