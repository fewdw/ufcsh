import test from "node:test";
import assert from "node:assert/strict";
import { db } from "./db.ts";
import { bugReport } from "./bugs.ts";
import { cardChanges } from "./scrape/wikipedia.ts";

test("an overweight bout moved up a division retains its real miss without a false alarm", () => {
  const row = db.prepare("SELECT f1_weight_miss, f2_weight_miss FROM fights WHERE id = '6708f3a32861038a'").get();
  assert.ok(row && Object.values(row).includes("218"));
  assert.equal(bugReport().checks.find(check => check.id === "weight-miss-under-limit")?.items
    .some(item => item.key.startsWith("6708f3a32861038a:")), false);
  db.exec("SAVEPOINT weight_check");
  try {
    db.prepare("UPDATE fights SET f2_weight_miss = '190' WHERE id = '6708f3a32861038a'").run();
    assert.ok(bugReport().checks.find(check => check.id === "weight-miss-under-limit")?.items
      .some(item => item.key.startsWith("6708f3a32861038a:")));
  } finally { db.exec("ROLLBACK TO weight_check; RELEASE weight_check"); }
});

test("a retained report supplies an unnamed replacement without confusing announcement and acceptance", () => {
  const text = `{{Infobox MMA event\n|date=July 20, 2024\n}}
Dione Barbosa was added to the card to face Miranda Maverick.`;
  const change = cardChanges(text, [["Dione Barbosa", "Miranda Maverick"]]).changes[0];
  assert.equal(change?.replaced, "Tracy Cortez");
  assert.equal(change?.notice, "announced 23 days before");
  assert.equal(change?.shortNotice, false);
  assert.deepEqual(cardChanges(text.replace("July 20", "July 21"), [["Dione Barbosa", "Miranda Maverick"]]).changes, []);
});

test("a checked report corrects the immediate replacement in a chain of withdrawals", () => {
  const text = `{{Infobox MMA event\n|date=February 26, 2022\n}}
Josiane Nunes was expected to face Wu Yanan. However, Yanan withdrew and was replaced by Ramona Pascual.`;
  const change = cardChanges(text, [["Josiane Nunes", "Ramona Pascual"]]).changes.find(change => change.name === "Ramona Pascual");
  assert.equal(change?.replaced, "Jennifer Gonzalez");
  assert.equal(change?.notice, "announced 8 days before");
});
