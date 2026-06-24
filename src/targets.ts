import { CookieJar } from "./cookies.ts";
import { listCenters } from "./session.ts";
import type { Target } from "./types.ts";

// PRD v2 §3.4 — known padrón services. Centers are NOT hardcoded: every center
// is auto-discovered per service via §3.1 at startup (FR1), so new offices are
// picked up automatically.
export const SERVICIO_JUNTAS = 16;
export const SERVICIO_GTI = 99;

// PRD v2 §FR1 — auto-discover every center for one service via §3.1, mapping
// each to a (servicio, centro) target carrying the §3.1 name/address so
// notifications can show them. A failure is non-fatal: log and skip the service
// so the others still run.
export async function discoverCenters(
  servicio: number,
  jar: CookieJar,
  fetchImpl: typeof fetch = fetch,
  log: (message: string) => void = () => {},
): Promise<Target[]> {
  try {
    const centers = await listCenters(servicio, jar, fetchImpl);
    return centers.map((c) => ({
      servicio,
      centro: c.id_centro,
      label: `servicio ${servicio} — ${c.nombre ?? c.id_centro}`,
      centroName: c.nombre,
      direccion: c.direccion,
    }));
  } catch (err) {
    log(
      `center discovery for servicio ${servicio} failed (skipping it this run): ${(err as Error).message}`,
    );
    return [];
  }
}

// PRD v2 §FR1 — the full target matrix = every auto-discovered (servicio,
// centro) pair across the configured services. Discovered fresh at startup (and
// on each restart) so new offices appear without code changes.
export async function buildTargetMatrix(
  services: number[],
  jar: CookieJar,
  fetchImpl: typeof fetch = fetch,
  log: (message: string) => void = () => {},
): Promise<Target[]> {
  const matrix: Target[] = [];
  for (const servicio of services) {
    matrix.push(...(await discoverCenters(servicio, jar, fetchImpl, log)));
  }
  return matrix;
}
