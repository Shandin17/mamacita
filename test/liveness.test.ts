import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LivenessTracker,
  buildDegradedText,
  buildHeartbeatText,
  buildStatusText,
} from "../src/liveness.ts";

const TZ = "Europe/Madrid";

test("snapshot reflects the last result recorded per target", () => {
  const t = new LivenessTracker();
  const now = new Date("2026-06-24T10:00:00.000Z");
  t.recordTargetResult("16/5", "A", "no-slot", now);
  t.recordTargetResult("16/6", "B", "hit", now);
  t.recordTargetResult("16/5", "A", "failed", now); // overwrites A

  const snap = t.snapshot(false);
  assert.equal(snap.lastPollAt, now.toISOString());
  assert.equal(snap.targets.length, 2);
  const a = snap.targets.find((x) => x.label === "A");
  assert.equal(a?.result, "failed");
});

test("degraded alert trips once at the threshold and recovers once", () => {
  const t = new LivenessTracker();
  // Two failed cycles, threshold 3 → not yet degraded.
  assert.deepEqual(t.recordCycle(true, 3), { degradedTripped: false, recovered: false });
  assert.deepEqual(t.recordCycle(true, 3), { degradedTripped: false, recovered: false });
  // Third failed cycle → trips.
  assert.deepEqual(t.recordCycle(true, 3), { degradedTripped: true, recovered: false });
  // Still failing → does not re-trip.
  assert.deepEqual(t.recordCycle(true, 3), { degradedTripped: false, recovered: false });
  // Healthy cycle → recovers once.
  assert.deepEqual(t.recordCycle(false, 3), { degradedTripped: false, recovered: true });
  // Next healthy cycle → nothing.
  assert.deepEqual(t.recordCycle(false, 3), { degradedTripped: false, recovered: false });
});

test("a healthy cycle resets the consecutive failure count", () => {
  const t = new LivenessTracker();
  t.recordCycle(true, 3);
  t.recordCycle(true, 3);
  t.recordCycle(false, 3); // reset
  assert.equal(t.snapshot(false).consecutiveFailedCycles, 0);
});

test("heartbeat is due once per local day after the heartbeat hour", () => {
  const t = new LivenessTracker();
  // 06:00 UTC = 08:00 CEST — before a 09:00 heartbeat hour.
  const early = new Date("2026-06-24T06:00:00.000Z");
  assert.equal(t.dueForHeartbeat(early, 9, TZ), false);

  // 08:00 UTC = 10:00 CEST — past 09:00 → due.
  const due = new Date("2026-06-24T08:00:00.000Z");
  assert.equal(t.dueForHeartbeat(due, 9, TZ), true);

  // Once sent, not due again the same local day.
  t.markHeartbeatSent(due, TZ);
  const later = new Date("2026-06-24T12:00:00.000Z");
  assert.equal(t.dueForHeartbeat(later, 9, TZ), false);

  // Next day → due again.
  const tomorrow = new Date("2026-06-25T08:00:00.000Z");
  assert.equal(t.dueForHeartbeat(tomorrow, 9, TZ), true);
});

test("heartbeatHour < 0 disables the heartbeat", () => {
  const t = new LivenessTracker();
  const noon = new Date("2026-06-24T12:00:00.000Z");
  assert.equal(t.dueForHeartbeat(noon, -1, TZ), false);
});

test("status text shows last poll time, per-target result and backoff state", () => {
  const t = new LivenessTracker();
  const now = new Date("2026-06-24T10:43:07.000Z");
  t.recordTargetResult("16/5", "Transits", "no-slot", now);
  const text = buildStatusText(t.snapshot(true));
  assert.match(text, /2026-06-24T10:43:07.000Z/);
  assert.match(text, /Transits: no-slot/);
  assert.match(text, /Backoff: activo/);
});

test("heartbeat text marks the monitor alive; degraded text reports the count", () => {
  const t = new LivenessTracker();
  const now = new Date("2026-06-24T10:00:00.000Z");
  assert.match(buildHeartbeatText(t.snapshot(false), now), /activo/i);
  t.recordCycle(true, 1); // trips degraded
  assert.match(buildDegradedText(t.snapshot(true)), /degradado/i);
  assert.match(buildDegradedText(t.snapshot(true)), /1 ciclos/);
});
