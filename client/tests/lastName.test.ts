import test from "node:test";
import assert from "node:assert/strict";
import { lastName } from "../src/format.ts";

test("a surname drops generational suffixes", () => {
  assert.equal(lastName("Raul Rosas Jr."), "Rosas");
  assert.equal(lastName("Khalil Rountree Jr"), "Rountree");
  assert.equal(lastName("Julio Cesar Neves Jr."), "Neves");
  assert.equal(lastName("Kai Kamaka III"), "Kamaka");
  assert.equal(lastName("Sean King III"), "King");
});

test("a surname keeps the particles that lead it", () => {
  assert.equal(lastName("Rafael dos Anjos"), "dos Anjos");
  assert.equal(lastName("Jack Della Maddalena"), "Della Maddalena");
  assert.equal(lastName("Chris de la Rocha"), "de la Rocha");
  assert.equal(lastName("Alain Van der Merckt"), "Van der Merckt");
  assert.equal(lastName("Benoit Saint Denis"), "Saint Denis");
  assert.equal(lastName("Dricus Du Plessis"), "Du Plessis");
  assert.equal(lastName("Germaine de Randamie"), "de Randamie");
});

test("ordinary, one-word and particle-looking first names are left alone", () => {
  assert.equal(lastName("Alexandre Pantoja"), "Pantoja");
  assert.equal(lastName("Joshua Van"), "Van");
  assert.equal(lastName("Dos Caras Jr."), "Caras");
  assert.equal(lastName("Marc-Andre Barriault"), "Barriault");
  assert.equal(lastName("Alatengheili"), "Alatengheili");
  assert.equal(lastName("  Israel   Adesanya "), "Adesanya");
});
