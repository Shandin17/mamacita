import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Target } from "./types.ts";

// PRD §8.4 / §11 capture-on-hit: on the first real HIT, dump the full raw §3.2
// (first-available) and §3.3 (calendar) payloads to disk. That is the only way
// to learn the populated `dias` shape and the future booking POST contract.
export function captureToDir(
  dir: string,
  target: Target,
  firstAvailable: unknown,
  calendar: unknown,
  now: Date,
): string {
  mkdirSync(dir, { recursive: true });
  // Filesystem-safe timestamp; servicio/centro make the file self-describing.
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const path = join(dir, `hit-${target.servicio}-${target.centro}-${stamp}.json`);
  const dump = {
    target,
    detectedAt: now.toISOString(),
    firstAvailable, // §3.2 — primary availability payload
    calendar, // §3.3 — calendar window / id_periodo
  };
  writeFileSync(path, JSON.stringify(dump, null, 2));
  return path;
}
