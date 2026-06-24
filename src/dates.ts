import type { FirstAvailableResponse } from "./types.ts";

// PRD §FR1 / §11.1 — the populated `dias` / `dias_calendario` shape is unknown
// until a real slot appears, so date extraction is deliberately structure-
// agnostic: deep-walk the two availability arrays and collect anything that
// looks like an ISO date (YYYY-MM-DD). `periodos` is *not* scanned — it carries
// the configured window range (§3.3), not bookable days.

const ISO_DATE = /\b(\d{4}-\d{2}-\d{2})\b/g;

function collect(value: unknown, out: Set<string>): void {
  if (typeof value === "string") {
    for (const m of value.matchAll(ISO_DATE)) out.add(m[1]);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collect(item, out);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) collect(v, out);
  }
}

// All ISO dates found in `dias` ∪ `dias_calendario`, deduped and sorted.
export function extractDates(payload: FirstAvailableResponse): string[] {
  const out = new Set<string>();
  collect(payload.dias, out);
  collect(payload.dias_calendario, out);
  return [...out].sort();
}

export type EligibleDates = {
  // True when no dates could be parsed from the structure. Per §FR1 we then
  // alert anyway and let the human judge.
  opaque: boolean;
  // Parsed dates on/after `minDateISO` (empty when opaque, or all too early).
  dates: string[];
};

// PRD §FR1 — drop dates earlier than `minDateISO` when the structure exposes
// them; report opacity so the caller can still alert on unparseable shapes.
// ISO `YYYY-MM-DD` strings compare correctly lexicographically.
export function parseEligibleDates(
  payload: FirstAvailableResponse,
  minDateISO: string,
): EligibleDates {
  const found = extractDates(payload);
  if (found.length === 0) return { opaque: true, dates: [] };
  return { opaque: false, dates: found.filter((d) => d >= minDateISO) };
}
