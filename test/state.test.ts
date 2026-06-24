import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MonitorState, targetKey } from "../src/state.ts";

const t0 = new Date("2026-06-24T08:00:00.000Z");
const cooldownMs = 3_600_000; // 1h

test("targetKey is servicio/centro", () => {
  assert.equal(targetKey({ servicio: 16, centro: 5 }), "16/5");
});

test("a never-seen target alerts (reason new)", () => {
  const s = new MonitorState();
  const d = s.decide("16/5", "2026-06-27", t0, cooldownMs);
  assert.equal(d.alert, true);
  assert.equal(d.reason, "new");
});

test("same signature within cooldown is suppressed (no alert storm)", () => {
  const s = new MonitorState();
  s.recordAlert("16/5", "sig-a", t0);
  const within = new Date(t0.getTime() + 60_000); // +1 min
  const d = s.decide("16/5", "sig-a", within, cooldownMs);
  assert.equal(d.alert, false);
  assert.equal(d.reason, "suppressed");
});

test("same signature re-alerts after the cooldown elapses", () => {
  const s = new MonitorState();
  s.recordAlert("16/5", "sig-a", t0);
  const later = new Date(t0.getTime() + cooldownMs + 1000);
  const d = s.decide("16/5", "sig-a", later, cooldownMs);
  assert.equal(d.alert, true);
  assert.equal(d.reason, "cooldown");
});

test("a changed signature re-alerts immediately", () => {
  const s = new MonitorState();
  s.recordAlert("16/5", "sig-a", t0);
  const d = s.decide("16/5", "sig-b", new Date(t0.getTime() + 1000), cooldownMs);
  assert.equal(d.alert, true);
  assert.equal(d.reason, "changed");
});

test("disappear (clear) then reappear re-alerts even with the same signature", () => {
  const s = new MonitorState();
  s.recordAlert("16/5", "sig-a", t0);
  s.clear("16/5"); // availability gone this cycle
  const d = s.decide("16/5", "sig-a", new Date(t0.getTime() + 1000), cooldownMs);
  assert.equal(d.alert, true);
  assert.equal(d.reason, "new");
});

test("the capture flag is recorded once", () => {
  const s = new MonitorState();
  assert.equal(s.hasCaptured(), false);
  s.markCaptured();
  assert.equal(s.hasCaptured(), true);
});

test("state survives a restart when a JSON file is enabled", () => {
  const dir = mkdtempSync(join(tmpdir(), "mamacita-state-"));
  const file = join(dir, "state.json");
  try {
    const s1 = new MonitorState(file).load();
    s1.recordAlert("16/5", "sig-a", t0);
    s1.markCaptured();

    // Fresh instance (simulating a process restart) reads the persisted file.
    const s2 = new MonitorState(file).load();
    assert.equal(s2.hasCaptured(), true);
    const within = new Date(t0.getTime() + 60_000);
    assert.equal(s2.decide("16/5", "sig-a", within, cooldownMs).alert, false);
    assert.equal(s2.decide("16/5", "sig-b", within, cooldownMs).alert, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("load tolerates a missing file (fresh state)", () => {
  const s = new MonitorState(join(tmpdir(), "does-not-exist-xyz", "state.json"));
  assert.doesNotThrow(() => s.load());
  assert.equal(s.hasCaptured(), false);
});
