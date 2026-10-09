import test from "node:test";
import assert from "node:assert/strict";
import { resultDot } from "../src/resultDots.ts";
import { noContestUnexplained } from "../../server/src/no-contest.ts";

test("KO and submission results are solid dots in the outcome color", () => {
  for (const method of ["KO/TKO", "SUB", "TKO (Punches)", "KO (Knee and Punch)", "Submission (Armbar)"]) for (const outcome of ["win", "loss"] as const) {
    const dot = resultDot({ method, outcome });
    assert.equal(dot.kind, "finish");
    assert.ok(dot.className.includes(outcome === "win" ? "success" : "danger"));
    assert.ok(!dot.className.includes("transparent"));
  }
});
test("every decision type has a hollow outcome-colored dot", () => {
  for (const method of ["U-DEC", "S-DEC", "M-DEC", "Decision (Unanimous)", "Decision (Split)", "Technical Decision"]) for (const outcome of ["win", "loss"] as const) {
    assert.equal(resultDot({ method, outcome }).kind, "decision");
    assert.ok(resultDot({ method, outcome }).className.includes("!bg-transparent"));
  }
});
test("draws and no contests stay solid in their outcome color regardless of method or promotion", () => {
  for (const outcome of ["draw", "nc"] as const) {
    for (const method of ["M-DEC", "S-DEC", "U-DEC", "Technical Decision", "Decision (Majority)", "KO/TKO", "SUB", "No Contest (Accidental Eye Poke)", null]) {
      for (const ufc of [true, false]) {
        const dot = resultDot({ outcome, method, ufc });
        assert.doesNotMatch(dot.className, /transparent|opacity-/);
        assert.ok(dot.className.includes(outcome === "draw" ? "bg-warning" : "bg-muted"));
        assert.ok(dot.className.includes(ufc ? "rounded-full" : "rounded-[3px]"));
        assert.match(dot.label, outcome === "draw" ? /^Draw/ : /^No contest/);
      }
    }
  }
});
test("unknown methods and disqualifications are not labelled as finishes", () => {
  for (const method of [null, "DQ"]) assert.equal(resultDot({ method, outcome: "win" }).kind, "other");
});
test("a bout fought outside the UFC is a square, and says so in words", () => {
  const outside = resultDot({ method: "SUB", outcome: "win", ufc: false });
  assert.ok(outside.className.includes("rounded-[3px]"), "shape carries the promotion");
  assert.ok(!outside.className.includes("rotate"), "and does it without rotating the mark");
  assert.match(outside.label, /outside the UFC/, "shape is never the only thing saying it");
  assert.equal(outside.kind, "finish", "how it ended still reads the same way");

  const inside = resultDot({ method: "SUB", outcome: "win", ufc: true });
  assert.ok(inside.className.includes("rounded-full"));
  assert.doesNotMatch(inside.label, /outside/);
  assert.ok(resultDot({ method: "SUB", outcome: "win" }).className.includes("rounded-full"), "unstated means the UFC, as every older payload does");
});
test("a decision fought outside the UFC keeps both distinctions", () => {
  const dot = resultDot({ method: "DEC", outcome: "loss", ufc: false });
  assert.equal(dot.kind, "decision");
  assert.ok(dot.className.includes("!bg-transparent") && dot.className.includes("rounded-[3px]"));
});
test("a no contest's method shortens to a plain reason and keeps the full text in its label", () => {
  const nc = (method: string | null) => resultDot({ method, outcome: "nc", ufc: false });
  assert.equal(nc("No Contest (Accidental Knee to Groin)").shortMethod, "Groin strike");
  assert.equal(nc("NC (Yoshioka Cut by Accidental Headbutt)").shortMethod, "Clash of heads");
  assert.equal(nc("No Contest (Fitch Cut by Illegal Kick)").shortMethod, "Illegal strike");
  assert.equal(nc("NC (Rainfall)").shortMethod, "Stopped by rain", "rainfall is not a fall");
  assert.equal(nc("ND (Decision Overturned by NSAC)").shortMethod, "Result overturned");
  assert.equal(nc("No Contest").shortMethod, null, "the NC mark already says it");
  assert.equal(nc("No Contest (Nakao KO'd Prior to Bout)").shortMethod, "Pre-fight strike");
  assert.equal(nc("No Contest (Promoter Dispute)").shortMethod, null, "a cause no rule knows shows only the mark");
  assert.equal(resultDot({ method: "CNC", outcome: "nc" }).shortMethod, "CNC");
  assert.match(nc("No Contest (Accidental Knee to Groin)").label, /Accidental Knee to Groin/);
});

test("only a cause no rule knows is unexplained", () => {
  assert.equal(noContestUnexplained("No Contest (Promoter Dispute)"), true);
  assert.equal(noContestUnexplained("No Contest (Nakao KO'd Prior to Bout)"), false);
  assert.equal(noContestUnexplained("No Contest"), false, "no cause given, nothing to explain");
  assert.equal(noContestUnexplained("NC (Accidental Eye Poke)"), false);
  assert.equal(noContestUnexplained("CNC"), false);
});
