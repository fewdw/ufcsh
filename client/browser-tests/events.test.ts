// Run after a production build: CHROME_BIN=/path/to/chrome npm run test:browser.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const eventId = "1111111111111111", nextId = "2222222222222222", fightId = "aaaaaaaaaaaaaaaa";
const side = (name: string) => ({ id: name.toLowerCase(), name, profile_eligible: false, nickname: "", record: "1-0-0", photo_url: null,
  ranking: null, outcome: null, stats: {}, height: "", weight: "", reach: "", stance: "", birth_date: null, age: null,
  career_before: null, complete_record_before: null, history: [], recent_history: [] });
const bout = { id: fightId, ord: 0, segment: null, weight_class: "Lightweight", title_fight: false, title_type: null,
  scheduled_rounds: 3, method: null, method_details: null, round: null, time: null, f1: side("Alice"), f2: side("Bob"),
  odds: null, bonuses: { perf: false, fotn: false } };
const event = { id: eventId, name: "UFC Test Card", date: "2099-01-01", status: "next", location: "Test City",
  card_stats: { total_fights: 1, completed_fights: 0, finishes: 0, underdog_wins: 0 }, fights: [bout] };
const next = { ...event, id: nextId, name: "UFC Next Card", date: "2099-02-01", status: "future", fights: [] };
const events = [next, event].map(e => ({ ...e, fight_count: e.fights.length }));
const fight = { ...bout, event, status: "upcoming", prediction_available: false, detail: null, common_opponents: [], head_to_head: [] };

const server = createServer(async (req, res) => {
  const path = new URL(req.url!, "http://localhost").pathname;
  try {
    const file = path.startsWith("/assets/") ? path : "/index.html";
    const body = await readFile(new URL(`../dist${file}`, import.meta.url));
    res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
test.after(async () => { await browser.close(); server.close(); });

for (const entry of ["events", "fights"]) for (const width of [390, 1440]) for (const theme of ["light", "dark"]) for (const list of ["slow", "failed"]) {
  test(`${entry} ${width}px ${theme}: ready details survive a ${list} event list`, async () => {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    try {
      await context.addInitScript(theme => localStorage.setItem("ufcsh:settings:v1", JSON.stringify({ theme })), theme);
      let release!: () => void;
      const held = new Promise<void>(resolve => { release = resolve; });
      await context.route("**/api/**", async route => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/events") {
          if (list === "slow") await held;
          else return route.fulfill({ status: 503, json: { error: "unavailable" } });
        }
        const json = path === "/api/events" ? events : path === `/api/events/${eventId}` ? event
          : path === `/api/events/${nextId}` ? next : path === `/api/fights/${fightId}` ? fight : null;
        await route.fulfill({ json });
      });
      context.setDefaultTimeout(2500);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      try {
        await page.goto(`${origin}/${entry}/${entry === "events" ? eventId : fightId}`, { waitUntil: "domcontentloaded" });
        if (entry === "fights") {
          await page.getByText("Tale of the tape", { exact: true }).waitFor();
          await page.keyboard.press("Escape");
        }
        await page.getByRole("heading", { name: event.name, exact: true }).waitFor({ timeout: 2000 });
        assert.match(await page.locator("main").innerText(), /Alice/);
        console.log(`${width}px ${theme} ${list}: card visible at ${await page.evaluate(() => Math.round(performance.now()))} ms while list unavailable`);
        await page.locator("main").getByRole("button").filter({ hasText: "Alice" }).first().click();
        await page.getByText("Tale of the tape", { exact: true }).waitFor({ timeout: 2000 });
        await page.keyboard.press("Escape");
        await page.getByRole("heading", { name: event.name, exact: true }).waitFor();
        if (width === 390) await page.getByRole("button", { name: "Events", exact: true }).last().click();
        await page.locator("#events-sidebar").getByRole("status").waitFor();
        assert.match(await page.locator("#events-sidebar").innerText(), list === "slow" ? /Loading events/ : /Could not load events/);
        if (list === "slow") {
          release();
          await page.locator(`#events-sidebar a[href="/events/${eventId}"][aria-current="page"]`).waitFor();
          await page.locator(`#events-sidebar a[href="/events/${nextId}"]`).click();
          await page.getByRole("heading", { name: next.name, exact: true }).waitFor();
          await page.goBack();
          await page.getByRole("heading", { name: event.name, exact: true }).waitFor();
        }
        assert.deepEqual(errors, []);
      } finally { release(); }
    } finally { await context.close(); }
  });
}
