import test from "node:test";
import assert from "node:assert/strict";
import { developmentsFor } from "./fight-context.ts";

const background = "A flyweight bout between Joshua Van and Alexandre Pantoja headlined the event. Pantoja was expected to face Kai Kara-France earlier in the year. A lightweight bout between Mateusz Gamrot and Rafael Fiziev was scheduled. Van weighed in at 125 pounds.";

test("only sentences naming one of the two fighters are kept, in order", () => {
  assert.deepEqual(developmentsFor(background, ["Joshua Van", "Alexandre Pantoja"], ["Joshua Van", "Alexandre Pantoja", "Mateusz Gamrot", "Rafael Fiziev"]), [
    "A flyweight bout between Joshua Van and Alexandre Pantoja headlined the event.",
    "Pantoja was expected to face Kai Kara-France earlier in the year.",
    "Van weighed in at 125 pounds.",
  ]);
});

test("a surname shared with someone else on the card is not enough", () => {
  const text = "Silva missed weight. Natalia Silva will defend her title.";
  assert.deepEqual(developmentsFor(text, ["Natalia Silva", "Wang Cong"], ["Natalia Silva", "Wang Cong", "Bruno Silva", "Someone Else"]), [
    "Natalia Silva will defend her title.",
  ]);
});
