import { test } from "node:test";
import assert from "node:assert/strict";
import { detectHit } from "../src/detect.ts";

test("empty response is not a hit", () => {
  assert.equal(
    detectHit({ dias_calendario: [], dias: [], periodos: [] }),
    false,
  );
});

test("non-empty dias is a hit", () => {
  assert.equal(detectHit({ dias: ["2026-06-27"], dias_calendario: [] }), true);
});

test("non-empty dias_calendario is a hit", () => {
  assert.equal(
    detectHit({ dias: [], dias_calendario: [{ fecha: "2026-06-27" }] }),
    true,
  );
});

test("missing arrays are not a hit", () => {
  assert.equal(detectHit({}), false);
});

test("non-array dias is not a hit", () => {
  assert.equal(detectHit({ dias: "oops" as unknown as unknown[] }), false);
});
