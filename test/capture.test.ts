import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureToDir } from "../src/capture.ts";

test("dumps raw §3.2 + §3.3 payloads to a JSON file in the dir", () => {
  const dir = mkdtempSync(join(tmpdir(), "mamacita-cap-"));
  try {
    const firstAvailable = { dias: ["2026-06-27"], dias_calendario: [] };
    const calendar = { periodos: [{ id_periodo: 6 }] };
    const path = captureToDir(
      dir,
      { servicio: 16, centro: 5, label: "Transits" },
      firstAvailable,
      calendar,
      new Date("2026-06-24T10:43:07.000Z"),
    );

    const files = readdirSync(dir);
    assert.equal(files.length, 1);
    assert.match(files[0], /16-5/); // servicio/centro in the filename

    const dump = JSON.parse(readFileSync(path, "utf8"));
    assert.deepEqual(dump.firstAvailable, firstAvailable); // §3.2
    assert.deepEqual(dump.calendar, calendar); // §3.3
    assert.equal(dump.target.servicio, 16);
    assert.equal(dump.detectedAt, "2026-06-24T10:43:07.000Z");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("creates the capture directory if it does not exist", () => {
  const base = mkdtempSync(join(tmpdir(), "mamacita-cap-"));
  const dir = join(base, "nested", "captures");
  try {
    const path = captureToDir(
      dir,
      { servicio: 99, centro: 10 },
      { dias: [] },
      {},
      new Date("2026-06-24T10:43:07.000Z"),
    );
    assert.ok(readFileSync(path, "utf8").length > 0);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
