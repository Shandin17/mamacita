import { CookieJar } from "./cookies.ts";
import type { CenterInfo, FirstAvailableResponse, Target } from "./types.ts";

// Raised when a JSON endpoint returns HTML / a non-JSON content-type / a 403
// challenge / unparseable JSON — the F5 anti-bot session has rotated or we've
// been blocked (§7/FR5). The loop treats this as the signal to re-bootstrap.
export class SessionDeadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionDeadError";
  }
}

// PRD §3 / §7 — QSIGE backend + SPA session bootstrap.
const API_BASE = "https://www.valencia.es/qsige.localizador";
export const INDEX_URL =
  "https://www.valencia.es/QSIGE/apps/citaprevia/index.html?idioma=VA";

// Standard browser-ish headers; Referer is required by the backend (§3).
const COMMON_HEADERS: Record<string, string> = {
  Referer: INDEX_URL,
  Accept: "application/json, text/plain, */*",
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
};

function readSetCookies(res: Response): string[] {
  // undici's Headers exposes getSetCookie(); fall back to a single header.
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

function withCookies(jar: CookieJar): Record<string, string> {
  const header = jar.header();
  return header ? { ...COMMON_HEADERS, Cookie: header } : { ...COMMON_HEADERS };
}

// PRD §7/FR5: GET the SPA index to obtain fresh session + F5 anti-bot cookies.
export async function bootstrapSession(
  jar: CookieJar,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(INDEX_URL, { headers: { ...COMMON_HEADERS } });
  jar.setFromResponse(readSetCookies(res));
}

async function getJson(
  url: string,
  jar: CookieJar,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const res = await fetchImpl(url, { headers: withCookies(jar) });
  // Refresh any rotated cookies.
  jar.setFromResponse(readSetCookies(res));

  const contentType = res.headers.get("content-type") ?? "";
  if (res.status === 403 || !contentType.includes("application/json")) {
    // HTML / non-JSON / 403 challenge page => session is dead/blocked (§7/FR5).
    throw new SessionDeadError(
      `session dead: expected JSON from ${url} but got "${contentType}" (status ${res.status})`,
    );
  }
  try {
    return await res.json();
  } catch (err) {
    // A JSON content-type with an unparseable body is also a dead/challenge
    // response in practice (§7) — surface it the same way so the loop refreshes.
    throw new SessionDeadError(
      `session dead: malformed JSON from ${url} (status ${res.status}): ${(err as Error).message}`,
    );
  }
}

// PRD §3.2 — first-available endpoint, the primary availability signal.
export async function pollFirstAvailable(
  target: Target,
  jar: CookieJar,
  fetchImpl: typeof fetch = fetch,
): Promise<FirstAvailableResponse> {
  const url = `${API_BASE}/citaPrevia/primera/disponible/centro/${target.centro}/servicio/${target.servicio}`;
  return (await getJson(url, jar, fetchImpl)) as FirstAvailableResponse;
}

// PRD §3.1 — list the centers configured for a service. Used at startup to
// resolve center IDs we don't hardcode (e.g. servicio 33 / Tabacalera).
export async function listCenters(
  servicio: number,
  jar: CookieJar,
  fetchImpl: typeof fetch = fetch,
): Promise<CenterInfo[]> {
  const url = `${API_BASE}/citaPrevia/centros/servicio/disponible/${servicio}`;
  const data = (await getJson(url, jar, fetchImpl)) as Array<{
    centros?: Array<{ id_centro?: number; nombre?: string; direccion?: string }>;
  }>;
  return (Array.isArray(data) ? data : [])
    .flatMap((group) => group.centros ?? [])
    .filter((c): c is CenterInfo => typeof c.id_centro === "number");
}

export type EnrichedNames = {
  servicioName?: string;
  centroName?: string;
  idPeriodo?: number;
};

// PRD §3.3 — calendar window, used only to enrich names / id_periodo.
export async function enrichNames(
  target: Target,
  jar: CookieJar,
  fetchImpl: typeof fetch = fetch,
): Promise<EnrichedNames> {
  const url = `${API_BASE}/citaPrevia/disponible/centro/${target.centro}/servicio/${target.servicio}/calendario`;
  const data = (await getJson(url, jar, fetchImpl)) as {
    periodos?: Array<{
      id_periodo?: number;
      nombre_centro?: string;
      nombre_servicio?: string;
    }>;
  };
  const periodo = data.periodos?.[0];
  return {
    servicioName: periodo?.nombre_servicio,
    centroName: periodo?.nombre_centro,
    idPeriodo: periodo?.id_periodo,
  };
}
