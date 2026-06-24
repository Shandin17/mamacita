import { CookieJar } from "./cookies.ts";
import type { FirstAvailableResponse, Target } from "./types.ts";

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
  if (!contentType.includes("application/json")) {
    // HTML / 403 challenge page => session is dead (§7/FR5).
    throw new Error(
      `session dead: expected JSON from ${url} but got "${contentType}" (status ${res.status})`,
    );
  }
  return res.json();
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
