import type { FirstAvailableResponse } from "./types.ts";

// PRD §3.2 / FR1: a HIT when `dias` OR `dias_calendario` is a non-empty array.
export function detectHit(payload: FirstAvailableResponse): boolean {
  return (
    (Array.isArray(payload.dias) && payload.dias.length > 0) ||
    (Array.isArray(payload.dias_calendario) &&
      payload.dias_calendario.length > 0)
  );
}
