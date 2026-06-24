import { CookieJar } from "./cookies.ts";
import { listCenters } from "./session.ts";
import type { Target } from "./types.ts";

// PRD §3.4 — known padrón services and their centers.
export const SERVICIO_JUNTAS = 16;
export const SERVICIO_GTI = 99;
export const SERVICIO_TABACALERA = 33;

// servicio 16 (Juntas Municipales) — 7 hardcoded centers (§3.4).
export const JUNTAS_CENTERS: Array<{ centro: number; label: string }> = [
  { centro: 7, label: "Abastos" },
  { centro: 6, label: "Exposición" },
  { centro: 1, label: "Marítimo" },
  { centro: 2, label: "Patraix" },
  { centro: 4, label: "Ruzafa" },
  { centro: 5, label: "Transits" },
  { centro: 14, label: "Pobles del Sud" },
];

// The portion of the target matrix that is known statically (§3.4).
export const STATIC_TARGETS: Target[] = [
  ...JUNTAS_CENTERS.map((c) => ({
    servicio: SERVICIO_JUNTAS,
    centro: c.centro,
    label: `Juntas — ${c.label}`,
  })),
  { servicio: SERVICIO_GTI, centro: 10, label: "Arzobispo Mayoral — G.T.I." },
];

// PRD §3.4: servicio 33 (Tabacalera) centers are TBD — resolve via §3.1 at
// startup. A failure here is non-fatal: we just skip Tabacalera this run.
export async function resolveTabacaleraTargets(
  jar: CookieJar,
  fetchImpl: typeof fetch = fetch,
  log: (message: string) => void = () => {},
): Promise<Target[]> {
  try {
    const centers = await listCenters(SERVICIO_TABACALERA, jar, fetchImpl);
    return centers.map((c) => ({
      servicio: SERVICIO_TABACALERA,
      centro: c.id_centro,
      label: `Tabacalera — ${c.nombre ?? c.id_centro}`,
    }));
  } catch (err) {
    log(
      `tabacalera center resolution failed (continuing without it): ${(err as Error).message}`,
    );
    return [];
  }
}

// Full target matrix = static §3.4 targets ∪ resolved Tabacalera centers.
export async function buildTargetMatrix(
  jar: CookieJar,
  fetchImpl: typeof fetch = fetch,
  log: (message: string) => void = () => {},
): Promise<Target[]> {
  const tabacalera = await resolveTabacaleraTargets(jar, fetchImpl, log);
  return [...STATIC_TARGETS, ...tabacalera];
}
