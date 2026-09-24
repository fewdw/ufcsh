import test from "node:test";
import assert from "node:assert/strict";
import { injectPageSeo, pageSeo } from "./seo.ts";
import { db } from "./db.ts";

test("unknown routes and unknown records answer 404 and ask not to be indexed", () => {
  for (const path of ["/nope", "/fighters/0000000000000000", "/fights/zzz", "/judges/no-one", "/venues/nowhere", "/events/a/b"]) {
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
