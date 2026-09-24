import test from "node:test";
import assert from "node:assert/strict";
import { eventInfobox } from "./wikipedia.ts";

const article = `{{Infobox MMA event
|name= UFC 331: Van vs. Pantoja 2
|venue= [[Crypto.com Arena]]
|city= [[Los Angeles]], California, United States
|attendance= 19,357<ref name="gate&att">{{Cite web|url=https://example.test|title=x}}</ref>
|gate= $8,228,105<ref name="gate&att"/>
}}

'''UFC 331''' was an event.

==Background==
The event marked the promotion's sixth visit to [[Los Angeles]].<ref>{{Cite web|url=https://example.test|title=y}}</ref>
A flyweight bout between [[Joshua Van]] and [[Alexandre Pantoja]] headlined.

==Results==
{{MMAevent bout|x}}`;

test("the infobox names the venue, city, attendance and gate as plain text", () => {
  assert.deepEqual(eventInfobox(article), {
    venue: "Crypto.com Arena",
    city: "Los Angeles, California, United States",
    attendance: 19357,
    gate: "$8,228,105",
  });
});

test("an absent or malformed field is null rather than guessed", () => {
  assert.deepEqual(eventInfobox("{{Infobox MMA event\n|venue=\n|attendance= TBA\n}}"), { venue: null, city: null, attendance: null, gate: null });
});
