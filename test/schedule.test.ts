import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeCycleDelayMs,
  computeStaggerMs,
  isActiveHours,
  msUntilNextActiveWindow,
} from "../src/schedule.ts";
import type { ScheduleConfig } from "../src/types.ts";

const sched: ScheduleConfig = {
  baseSec: 180,
  jitterSec: 60,
  staggerMinSec: 1.5,
  staggerMaxSec: 3,
  activeStartHour: 7,
  activeEndHour: 15,
  activeDays: [1, 2, 3, 4, 5],
  timezone: "Europe/Madrid",
};

test("cycle delay = baseSec + uniform(0, jitterSec)", () => {
  // rng=0 → exactly baseSec; rng=1 → baseSec+jitterSec.
  assert.equal(computeCycleDelayMs(sched, () => 0), 180_000);
  assert.equal(computeCycleDelayMs(sched, () => 1), 240_000);
  assert.equal(computeCycleDelayMs(sched, () => 0.5), 210_000);
});

test("stagger gap stays within [staggerMinSec, staggerMaxSec]", () => {
  assert.equal(computeStaggerMs(sched, () => 0), 1_500);
  assert.equal(computeStaggerMs(sched, () => 1), 3_000);
});

test("isActiveHours: true on a weekday inside the window (Europe/Madrid)", () => {
  // 2026-06-24 is a Wednesday. 10:43 UTC = 12:43 CEST → inside 07:00–15:00.
  assert.equal(
    isActiveHours(new Date("2026-06-24T10:43:00.000Z"), sched),
    true,
  );
});

test("isActiveHours: false before the window opens", () => {
  // 04:30 UTC = 06:30 CEST → before 07:00.
  assert.equal(
    isActiveHours(new Date("2026-06-24T04:30:00.000Z"), sched),
    false,
  );
});

test("isActiveHours: false after the window closes", () => {
  // 13:30 UTC = 15:30 CEST → past 15:00.
  assert.equal(
    isActiveHours(new Date("2026-06-24T13:30:00.000Z"), sched),
    false,
  );
});

test("isActiveHours: false on weekends", () => {
  // 2026-06-27 is a Saturday, mid-window local time.
  assert.equal(
    isActiveHours(new Date("2026-06-27T10:00:00.000Z"), sched),
    false,
  );
});

test("msUntilNextActiveWindow: before window → waits until it opens today", () => {
  // 06:30 CEST → 30 min until 07:00.
  const ms = msUntilNextActiveWindow(
    new Date("2026-06-24T04:30:00.000Z"),
    sched,
  );
  assert.equal(ms, 30 * 60_000);
});

test("msUntilNextActiveWindow: friday after close → waits until monday", () => {
  // 2026-06-26 is a Friday. 13:30 UTC = 15:30 CEST (past close).
  // Next active day is Monday 2026-06-29 07:00 CEST.
  const ms = msUntilNextActiveWindow(
    new Date("2026-06-26T13:30:00.000Z"),
    sched,
  );
  // From Fri 15:30 to Mon 07:00 = 2 days + 15.5h = 63.5h.
  assert.equal(ms, 63.5 * 60 * 60_000);
});
