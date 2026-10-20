// where.js: when the network's guess counts.   node --test tests/test_where.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { trustedGuess, cityOf } from "../publish/where.js";
import { readerPin } from "../publish/fleetsearch.js";

test("a guess inside a covered city counts; Thoeng, 150 km out, does not (Nan 2026-10-20)", () => {
  assert.equal(trustedGuess({ latitude: "19.68508", longitude: "100.19456", city: "Thoeng" }), null);
  assert.equal(trustedGuess({ latitude: "18.790", longitude: "98.985", city: "Chiang Mai" }).place, "cm");
  assert.equal(cityOf({ lat: 18.58, lon: 99.01 }), "cm");          // Lamphun, ~23 km
  assert.equal(cityOf({ lat: 19.9, lon: 99.83 }), "cr");
  assert.equal(cityOf({ lat: 13.75, lon: 100.5 }), "");            // Bangkok
  assert.equal(trustedGuess({}), null);
  assert.equal(trustedGuess({ latitude: 0, longitude: 0 }), null);
});

test("/find takes no pin from a guess outside the cities, and keeps near= whatever it is", () => {
  const sp = new URLSearchParams("");
  assert.equal(readerPin(sp, { cf: { latitude: "19.68508", longitude: "100.19456" } }), null);
  assert.equal(readerPin(sp, { cf: { latitude: "18.79", longitude: "98.98", city: "Chiang Mai" } }).exact, false);
  assert.deepEqual(readerPin(new URLSearchParams("near=19.685,100.195"), {}), { lat: 19.685, lon: 100.195, exact: true });
});
