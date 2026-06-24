import { test } from "node:test";
import assert from "node:assert/strict";
import { extractDates, parseEligibleDates } from "../src/dates.ts";

test("extracts ISO dates from a plain dias string array", () => {
  assert.deepEqual(
    extractDates({ dias: ["2026-06-28", "2026-06-27"], dias_calendario: [] }),
    ["2026-06-27", "2026-06-28"], // deduped + sorted
  );
});

test("extracts ISO dates from nested dias_calendario objects", () => {
  assert.deepEqual(
    extractDates({
      dias: [],
      dias_calendario: [{ fecha: "2026-07-01" }, { fecha: "2026-06-30" }],
    }),
    ["2026-06-30", "2026-07-01"],
  );
});

test("ignores periodos (window context, not real availability)", () => {
  // §3.3-style window dates must NOT be treated as bookable days.
  assert.deepEqual(
    extractDates({
      dias: [],
      dias_calendario: [],
      periodos: [{ fecha_inicial: "2026-03-23", fecha_final: "2026-07-03" }],
    }),
    [],
  );
});

test("returns no dates for an opaque (non-date) structure", () => {
  assert.deepEqual(
    extractDates({ dias: [{ huecos: [{ hora: "09:00" }] }], dias_calendario: [] }),
    [],
  );
});

test("parseEligibleDates flags opaque structures (alert anyway)", () => {
  const { opaque, dates } = parseEligibleDates(
    { dias: [{ id: 1 }], dias_calendario: [] },
    "2026-06-27",
  );
  assert.equal(opaque, true);
  assert.deepEqual(dates, []);
});

test("parseEligibleDates drops dates earlier than minDateISO", () => {
  const { opaque, dates } = parseEligibleDates(
    { dias: ["2026-06-20", "2026-06-27", "2026-06-30"], dias_calendario: [] },
    "2026-06-27",
  );
  assert.equal(opaque, false);
  assert.deepEqual(dates, ["2026-06-27", "2026-06-30"]); // 06-20 dropped
});

test("parseEligibleDates returns no eligible dates when all are too early", () => {
  const { opaque, dates } = parseEligibleDates(
    { dias: ["2026-06-01", "2026-06-10"], dias_calendario: [] },
    "2026-06-27",
  );
  assert.equal(opaque, false);
  assert.deepEqual(dates, []);
});
