import test from "node:test";
import assert from "node:assert/strict";
import { cardQualities, fighterQuality, scoreCard, type FinishKind, type QualityFight, type QualityFighter } from "./card-quality.ts";
import { db } from "./db.ts";

const fighter = (strength = 0.5, patch: Partial<QualityFighter> = {}): QualityFighter =>
  ({ strength, momentum: 0.5, pace: 0.5, finishing: 0.5, readiness: 1, champion: false, ranked: 0.1, ...patch });
const bout = (patch: Partial<QualityFight> = {}): QualityFight =>
  ({ title: false, interim: false, women: false, sides: [fighter(), fighter()], probabilities: [0.5, 0.5], actual: null, ...patch });
const card = (patch: Partial<QualityFight> = {}) => Array.from({ length: 12 }, () => bout(patch));
const result = (finish: FinishKind | null, patch: Partial<NonNullable<QualityFight["actual"]>> = {}) =>
  ({ pace: 0.5, finish, upset: false, fotn: false, nc: false, ...patch });
/** A card of twelve bouts, `count` of them ending the given way — from the
 * bottom of the card up, so the main event is the last one to change. */
const ended = (count: number, finish: FinishKind) =>
  Array.from({ length: 12 }, (_, i) => bout({ actual: result(i >= 12 - count ? finish : "decision") }));
/** The same, filled from the main event down. */
const endedFromTop = (count: number, finish: FinishKind) =>
  Array.from({ length: 12 }, (_, i) => bout({ actual: result(i < count ? finish : "decision") }));

test("card scores are deterministic and bounded, and read the card in order", () => {
  const fights = [...card(), bout({ title: true, sides: [fighter(1), fighter(0.9)] })];
  assert.deepEqual(scoreCard(fights, false), scoreCard([...fights], false));
  for (const complete of [false, true]) {
    const score = scoreCard(fights, complete);
    assert.ok(score.score >= 1 && score.score <= 100);
    assert.equal(score.factors.reduce((sum, factor) => sum + factor.weight, 0), 100);
    assert.equal(score.version, 4);
  }
  // The order is the card, not an implementation detail: the same bouts with
  // the title fight headlining is a different evening from one closing it.
  assert.ok(scoreCard([...fights].reverse(), false).score > scoreCard(fights, false).score);
  assert.equal(scoreCard([], false).score, 0);
});

test("the top of the card is worth more than the bottom of it", () => {
  const dull = card({ actual: result("decision") });
  const atTop = dull.map((fight, i) => i === 0 ? bout({ actual: result("ko", { pace: 0.9 }) }) : fight);
  const atBottom = dull.map((fight, i) => i === 11 ? bout({ actual: result("ko", { pace: 0.9 }) }) : fight);
  const base = scoreCard(dull, true).score;
  assert.ok(scoreCard(atBottom, true).score > base, "a prelim knockout should still count");
  assert.ok(scoreCard(atTop, true).score > scoreCard(atBottom, true).score + 8, "a main-event knockout should count for much more");
  // The same holds for who is on the card, not only for what they did.
  const strong = (index: number) => card().map((fight, i) => i === index ? bout({ sides: [fighter(1, { ranked: 1 }), fighter(1, { ranked: 1 })] }) : fight);
  assert.ok(scoreCard(strong(0), false).score > scoreCard(strong(11), false).score);
});

test("the main event is a factor in its own right", () => {
  for (const complete of [false, true]) {
    assert.ok(scoreCard(card(), complete).factors.some((factor) => factor.label === "Main event"));
  }
  // A title fight closing the show beats the same fight buried on the card.
  const headlined = card().map((fight, i) => i === 0 ? bout({ title: true, actual: result("ko", { pace: 0.8 }) }) : fight);
  const buried = card().map((fight, i) => i === 6 ? bout({ title: true, actual: result("ko", { pace: 0.8 }) }) : fight);
  assert.ok(scoreCard(headlined, true).score > scoreCard(buried, true).score);
  const main = (fights: QualityFight[]) => scoreCard(fights, true).factors.find((f) => f.label === "Main event")!.value;
  assert.ok(main(headlined) > main(buried));
});

test("an announced card is not rated until it is a card", () => {
  const filling = (n: number) => Array.from({ length: n }, () => bout());
  for (const n of [1, 2, 5]) {
    const score = scoreCard(filling(n), false);
    assert.equal(score.score, 0, `${n} announced bouts should carry no rating`);
    assert.deepEqual(score.factors, [], "an unrated card explains nothing, because it judges nothing");
  }
  assert.ok(scoreCard(filling(6), false).score > 0, "six announced bouts is a card");
  // A finished card is rated whatever its size: a short card in 2002 really
  // was a short card, which card depth already reflects.
  assert.ok(scoreCard(filling(5), true).score > 0);
  assert.ok(scoreCard(filling(5), true).expected! > 0);
});

test("stronger lineups and championship stakes increase the preview score", () => {
  const base = scoreCard(card(), false).score;
  assert.ok(scoreCard(card({ sides: [fighter(0.9), fighter(0.9)] }), false).score > base);
  assert.ok(scoreCard(card({ title: true }), false).score > base);
});

test("competitive odds beat mismatches, and equal vig does not change parity", () => {
  assert.ok(scoreCard(card({ probabilities: [0.5, 0.5] }), false).score > scoreCard(card({ probabilities: [0.9, 0.1] }), false).score);
  assert.equal(scoreCard(card({ probabilities: [0.6, 0.6] }), false).score, scoreCard(card({ probabilities: [0.5, 0.5] }), false).score);
});

test("completed-card outcomes affect reviews but cannot leak into previews", () => {
  const exciting = card({ actual: result("ko", { pace: 0.9, upset: true, fotn: true }) });
  const quiet = card({ actual: result("decision", { pace: 0.1 }) });
  assert.equal(scoreCard(exciting, false).score, scoreCard(quiet, false).score);
  assert.ok(scoreCard(exciting, true).score > scoreCard(quiet, true).score);
});

test("every extra finish raises the review score", () => {
  // Added from the bottom of the card up: a prelim knockout is worth little,
  // so the step can be smaller than a whole point, but it is never negative.
  const fromBottom = Array.from({ length: 13 }, (_, count) => scoreCard(ended(count, "ko"), true).score);
  for (let i = 1; i < fromBottom.length; i++) assert.ok(fromBottom[i] >= fromBottom[i - 1], `${i} finishes scored below ${i - 1}`);
  // Added from the top down, each of the weighted places on the card has to
  // show on its own; below those, a rounded score may take two to move.
  const fromTop = Array.from({ length: 13 }, (_, count) => scoreCard(endedFromTop(count, "ko"), true).score);
  for (let i = 1; i < fromTop.length; i++) {
    if (i <= 6) assert.ok(fromTop[i] > fromTop[i - 1], `${i} finishes did not beat ${i - 1}`);
    else assert.ok(fromTop[i] >= fromTop[i - 1], `${i} finishes scored below ${i - 1}`);
  }
  assert.ok(fromTop.at(-1)! - fromTop[0] > 20, "an all-finish card should clear an all-decision card by a wide margin");
  assert.ok(fromTop[1] > fromBottom[1], "the same knockout is worth more in the main event than on the prelims");
});

test("a knockout outranks a submission, which outranks a decision", () => {
  for (const count of [1, 4, 8, 12]) {
    const ko = scoreCard(endedFromTop(count, "ko"), true).score;
    const sub = scoreCard(endedFromTop(count, "sub"), true).score;
    assert.ok(ko > sub, `${count} KOs did not beat ${count} submissions`);
    assert.ok(sub > scoreCard(endedFromTop(0, "ko"), true).score, `${count} submissions did not beat all decisions`);
  }
  // Knockouts also lead the preview, through each fighter's prior finishes.
  const striker = fighterQuality({ wins: 10, finishes: 8, koWins: 8, losses: 2, draws: 0, daysSince: 120, winStreak: 3, lossStreak: 0, reigningChampion: false, formerChampion: false } as never, null, null, null);
  const grappler = fighterQuality({ wins: 10, finishes: 8, koWins: 0, losses: 2, draws: 0, daysSince: 120, winStreak: 3, lossStreak: 0, reigningChampion: false, formerChampion: false } as never, null, null, null);
  assert.ok(striker.finishing! > grappler.finishing!);
});

test("a Fight of the Night decision is not a dull decision", () => {
  const war = (fotn: boolean) => card().map((fight, i) => i === 0 ? bout({ actual: result("decision", { fotn }) }) : fight);
  const dull = scoreCard(war(false), true).score;
  const fought = scoreCard(war(true), true).score;
  assert.ok(fought > dull + 5, `a five-round war scored ${fought} against ${dull} for a quiet decision`);
  // It still reads below a finish, and the bonus alone does not make one.
  const finished = card().map((fight, i) => i === 0 ? bout({ actual: result("ko") }) : fight);
  assert.ok(scoreCard(finished, true).score > fought);
  const mainEvent = (fights: QualityFight[]) => scoreCard(fights, true).factors.find((f) => f.label === "Main event")!.value;
  assert.ok(mainEvent(war(true)) > mainEvent(war(false)));
});

test("a reigning champion competing is part of what is at stake", () => {
  const champion = fighter(0.9, { champion: true });
  const withChampion = card().map((fight, i) => i === 0 ? bout({ title: true, sides: [champion, fighter(0.9)] }) : fight);
  const without = card().map((fight, i) => i === 0 ? bout({ title: true, sides: [fighter(0.9), fighter(0.9)] }) : fight);
  const stakes = (fights: QualityFight[]) => scoreCard(fights, true).factors.find((f) => f.label === "Championship stakes")!.value;
  assert.ok(stakes(withChampion) > stakes(without));
  assert.ok(scoreCard(withChampion, true).score > scoreCard(without, true).score);
  // And a champion headlining counts for more than one on the prelims.
  const buried = card().map((fight, i) => i === 11 ? bout({ title: true, sides: [champion, fighter(0.9)] }) : fight);
  assert.ok(stakes(withChampion) > stakes(buried));
});

test("the rating states its preference for the men's divisions", () => {
  // An editorial weighting of the card's make-up, not a measurement: the same
  // card of women's bouts is rated below the same card of men's bouts.
  const men = card({ actual: result("decision") });
  const women = men.map((fight) => ({ ...fight, women: true }));
  assert.ok(scoreCard(men, true).score > scoreCard(women, true).score);
  // It is proportional, and weighted by place on the card like everything else.
  const headlined = men.map((fight, i) => i === 0 ? { ...fight, women: true } : fight);
  const opener = men.map((fight, i) => i === 11 ? { ...fight, women: true } : fight);
  assert.ok(scoreCard(opener, true).score >= scoreCard(headlined, true).score);
  assert.ok(scoreCard(headlined, true).score > scoreCard(women, true).score);
});

test("disqualifications and overturned results are unknown, not decisions", () => {
  const decisions = card({ actual: result("decision") });
  const unknown = card({ actual: result(null) });
  assert.ok(scoreCard(unknown, true).score > scoreCard(decisions, true).score);
  assert.ok(scoreCard(unknown, true).coverage < scoreCard(decisions, true).coverage);
});

test("more ranked fighters raise the announced-card score", () => {
  const ranks = [0.1, 0.4, 0.7, 1];
  const scores = ranks.map((rank) => scoreCard(card({ sides: [fighter(0.5, { ranked: rank }), fighter(0.5, { ranked: rank })] }), false).score);
  for (let i = 1; i < scores.length; i++) assert.ok(scores[i] > scores[i - 1], `rank credential ${ranks[i]} did not beat ${ranks[i - 1]}`);
  // Counting matters, not only the best name on the card.
  const one = card().map((fight, i) => i === 0 ? bout({ sides: [fighter(0.5, { ranked: 1 }), fighter(0.5, { ranked: 1 })] }) : fight);
  const four = card().map((fight, i) => i < 4 ? bout({ sides: [fighter(0.5, { ranked: 1 }), fighter(0.5, { ranked: 1 })] }) : fight);
  assert.ok(scoreCard(four, false).score > scoreCard(one, false).score);
});

test("reviews carry no ranked factor, so current rankings cannot rate old cards", () => {
  const labels = scoreCard(card(), true).factors.map((factor) => factor.label);
  assert.ok(!labels.includes("Ranked fighters"));
  assert.ok(scoreCard(card(), false).factors.some((factor) => factor.label === "Ranked fighters"));
  const ranked = card({ sides: [fighter(0.5, { ranked: 1 }), fighter(0.5, { ranked: 1 })] });
  assert.equal(scoreCard(ranked, true).score, scoreCard(card(), true).score);
});

test("a half-announced card is rated tentatively until it fills out", () => {
  const good = (n: number) => Array.from({ length: n }, () => bout({ sides: [fighter(0.8, { ranked: 0.8 }), fighter(0.8, { ranked: 0.8 })] }));
  const scores = [6, 7, 8].map((n) => scoreCard(good(n), false).score);
  for (let i = 1; i < scores.length; i++) assert.ok(scores[i] > scores[i - 1], "a filling card should climb toward its own strength");
  assert.ok(scores[0] < scoreCard(good(6), false, false).score, "a six-bout card is not read as a finished lineup");
  // Shrinking is about announced bouts, never about a small finished card.
  assert.equal(scoreCard(good(8), false).score, scoreCard(good(8), false, false).score);
});

test("reviews keep the pre-fight rating beside the delivered one", () => {
  const fights = card({ actual: result("ko", { pace: 0.9, fotn: true }) });
  const review = scoreCard(fights, true);
  assert.equal(review.expected, scoreCard(fights, false, false).score);
  assert.ok(review.score > review.expected!, "a card of knockouts should beat its own expectation");
  // The expectation is a property of the lineup, not of what happened in it.
  const flat = card({ actual: result("decision", { pace: 0.1 }) });
  assert.equal(scoreCard(flat, true).expected, review.expected);
  assert.equal(scoreCard(card(), false).expected, undefined);
});

test("a prelim moves a twelve-bout card a little, the main event a lot", () => {
  const flat = scoreCard(ended(0, "ko"), true).score;
  // One knockout in the opener is worth less than a point of the rating, and
  // four of them are worth a few: that is what "the prelims count least" means.
  const onePrelim = scoreCard(ended(1, "ko"), true).score;
  const fourPrelims = scoreCard(ended(4, "ko"), true).score;
  assert.ok(onePrelim >= flat && onePrelim - flat <= 2, `one prelim knockout moved the card ${onePrelim - flat} points`);
  assert.ok(fourPrelims > flat, "four prelim knockouts have to show");
  // The same knockout in the main event is a different evening.
  const headline = scoreCard(endedFromTop(1, "ko"), true).score;
  assert.ok(headline - flat > 5, `a main-event knockout moved the card ${headline - flat} points`);
});

test("unknown inputs remain neutral and reduce reported coverage", () => {
  const unknown: QualityFighter = { strength: null, momentum: null, pace: null, finishing: null, readiness: null, champion: false, ranked: null };
  const missing = scoreCard(card({ sides: [unknown, unknown], probabilities: [null, null] }), false);
  assert.equal(missing.coverage, 0);
  assert.equal(missing.factors.find((f) => f.label === "Expected action")!.value, 50);
  assert.equal(missing.factors.find((f) => f.label === "Ranked fighters")!.value, 50);
  assert.ok(missing.score > 0);
  assert.ok(scoreCard(card(), false).coverage > missing.coverage);
});

test("adding/removing fights and changing odds recalculate the score", () => {
  const initial = Array.from({ length: 6 }, () => bout());
  const added = [...initial, ...card({ sides: [fighter(1), fighter(1)] })];
  assert.notEqual(scoreCard(initial, false).score, scoreCard(added, false).score);
  assert.equal(scoreCard(added.slice(0, 6), false).score, scoreCard(initial, false).score);
  const priced = initial.map((fight, i) => i === 0 ? bout({ probabilities: [0.99, 0.01] }) : fight);
  assert.notEqual(scoreCard(initial, false).score, scoreCard(priced, false).score);
});

test("every stored event has a score and the basis agrees with event completion", () => {
  const scores = cardQualities();
  const events = db.prepare("SELECT id, complete FROM events").all() as { id: string; complete: number }[];
  assert.equal(scores.size, events.length);
  for (const event of events) {
    const score = scores.get(event.id)!;
    assert.equal(score.basis, event.complete ? "review" : "preview");
    assert.equal(score.version, 4);
    assert.ok(Number.isInteger(score.score) && score.score >= 0 && score.score <= 100);
    assert.ok(score.coverage >= 0 && score.coverage <= 100);
    if (event.complete && score.score) assert.ok(Number.isInteger(score.expected) && score.expected! >= 1);
    else assert.equal(score.expected, undefined);
  }
  assert.equal(cardQualities(), scores, "unchanged input shares the cached score map");
});

test("the archive stays spread across the rating scale", () => {
  const complete = new Map((db.prepare("SELECT id, complete FROM events").all() as { id: string; complete: number }[]).map((e) => [e.id, Boolean(e.complete)]));
  const reviews = [...cardQualities()].filter(([id, score]) => complete.get(id) && score.score > 0).map(([, score]) => score.score).sort((a, b) => a - b);
  const at = (p: number) => reviews[Math.floor((reviews.length - 1) * p)];
  assert.ok(reviews.length > 500);
  assert.ok(at(0) <= 25, `worst reviewed card scored ${at(0)}`);
  assert.ok(at(1) >= 85, `best reviewed card scored ${at(1)}`);
  assert.ok(at(0.5) > 30 && at(0.5) < 60, `median reviewed card scored ${at(0.5)}`);
  assert.ok(at(0.95) - at(0.05) > 25, "the middle 90% of cards should not sit on one rating");
});

test("a card the sources barely measured is not rated as confidently as one they did", () => {
  const unknown = (patch: Partial<QualityFighter> = {}) =>
    ({ strength: null, momentum: null, pace: null, finishing: null, readiness: null, champion: false, ranked: null, ...patch });
  // The same dull evening, once fully measured and once barely measured at all.
  const measured = card({ actual: result("decision") });
  const sparse = Array.from({ length: 12 }, () => bout({
    sides: [unknown(), unknown()],
    probabilities: [null, null],
    actual: { pace: null, finish: "decision", upset: null, fotn: null, nc: false },
  }));
  const full = scoreCard(measured, true);
  const thin = scoreCard(sparse, true);
  assert.ok(thin.coverage < full.coverage, "the thin card reports the gap");
  assert.ok(Math.abs(thin.score - 50) < Math.abs(full.score - 50), "and its rating sits closer to the middle for it");
  // Shrinking toward neutral is not the same as refusing to rate: what was
  // measured still moves the score in the direction it points.
  const sparseFinishes = sparse.map((fight) => ({ ...fight, actual: { ...fight.actual!, finish: "ko" as const } }));
  assert.ok(scoreCard(sparseFinishes, true).score > thin.score);
});
