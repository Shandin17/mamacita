import { test } from "node:test";
import assert from "node:assert/strict";
import { Backoff } from "../src/backoff.ts";

test("first delay is the base, then doubles each call", () => {
  const b = new Backoff({ baseMs: 1000, factor: 2, capMs: 60_000 });
  assert.equal(b.next(), 1000);
  assert.equal(b.next(), 2000);
  assert.equal(b.next(), 4000);
});

test("delay is clamped to the cap", () => {
  const b = new Backoff({ baseMs: 1000, factor: 10, capMs: 5000 });
  assert.equal(b.next(), 1000);
  assert.equal(b.next(), 5000); // 10_000 clamped to cap
  assert.equal(b.next(), 5000); // stays at cap
});

test("reset returns the delay to the base and clears the backed-off flag", () => {
  const b = new Backoff({ baseMs: 1000, factor: 2, capMs: 60_000 });
  assert.equal(b.isBackedOff, false);
  b.next();
  assert.equal(b.isBackedOff, true);
  b.reset();
  assert.equal(b.isBackedOff, false);
  assert.equal(b.next(), 1000);
});
