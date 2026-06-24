import { test } from "node:test";
import assert from "node:assert/strict";
import { CookieJar } from "../src/cookies.ts";
import {
  bootstrapSession,
  pollFirstAvailable,
  enrichNames,
  listCenters,
  SessionDeadError,
  INDEX_URL,
} from "../src/session.ts";

function jsonResponse(obj: unknown, setCookie: string[] = []): Response {
  const headers = new Headers({ "content-type": "application/json" });
  for (const c of setCookie) headers.append("set-cookie", c);
  return new Response(JSON.stringify(obj), { status: 200, headers });
}

function htmlResponse(setCookie: string[] = []): Response {
  const headers = new Headers({ "content-type": "text/html" });
  for (const c of setCookie) headers.append("set-cookie", c);
  return new Response("<!doctype html><html></html>", { status: 200, headers });
}

test("bootstrap GETs the SPA index and stores cookies", async () => {
  const calls: string[] = [];
  const jar = new CookieJar();
  const fakeFetch = (async (url: string | URL) => {
    calls.push(String(url));
    return htmlResponse(["JSESSIONID=sess1; Path=/", "TS01dc4fc6=anti; Path=/"]);
  }) as unknown as typeof fetch;

  await bootstrapSession(jar, fakeFetch);

  assert.equal(calls[0], INDEX_URL);
  assert.equal(jar.isEmpty(), false);
  assert.match(jar.header(), /JSESSIONID=sess1/);
});

test("poll reuses cookies from the jar and hits the §3.2 endpoint", async () => {
  const jar = new CookieJar();
  jar.setFromResponse(["JSESSIONID=sess1; Path=/"]);
  const seen: { url: string; cookie: string | null }[] = [];
  const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    seen.push({ url: String(url), cookie: headers.get("cookie") });
    return jsonResponse({ dias: [], dias_calendario: [], periodos: [] });
  }) as unknown as typeof fetch;

  const payload = await pollFirstAvailable(
    { servicio: 16, centro: 5 },
    jar,
    fakeFetch,
  );

  assert.equal(
    seen[0].url,
    "https://www.valencia.es/qsige.localizador/citaPrevia/primera/disponible/centro/5/servicio/16",
  );
  assert.equal(seen[0].cookie, "JSESSIONID=sess1");
  assert.deepEqual(payload.dias, []);
});

test("poll throws a SessionDeadError when JSON endpoint returns HTML", async () => {
  const jar = new CookieJar();
  jar.setFromResponse(["JSESSIONID=sess1; Path=/"]);
  const fakeFetch = (async () => htmlResponse()) as unknown as typeof fetch;

  await assert.rejects(
    pollFirstAvailable({ servicio: 16, centro: 5 }, jar, fakeFetch),
    (err: unknown) =>
      err instanceof SessionDeadError && /session/i.test((err as Error).message),
  );
});

test("poll throws a SessionDeadError on a 403 block even with JSON headers", async () => {
  const jar = new CookieJar();
  const fakeFetch = (async () =>
    new Response('{"blocked":true}', {
      status: 403,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

  await assert.rejects(
    pollFirstAvailable({ servicio: 16, centro: 5 }, jar, fakeFetch),
    (err: unknown) => err instanceof SessionDeadError,
  );
});

test("poll throws a SessionDeadError on malformed JSON", async () => {
  const jar = new CookieJar();
  const fakeFetch = (async () =>
    new Response("{not json", {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

  await assert.rejects(
    pollFirstAvailable({ servicio: 16, centro: 5 }, jar, fakeFetch),
    (err: unknown) => err instanceof SessionDeadError,
  );
});

test("enrichNames pulls service/center names and id_periodo from §3.3", async () => {
  const jar = new CookieJar();
  const fakeFetch = (async (url: string | URL) => {
    assert.match(String(url), /\/calendario$/);
    return jsonResponse({
      dias_calendario: [],
      periodos: [
        {
          id_periodo: 6,
          nombre_centro: "GESTIÓN TRIBUTARIA INTEGRAL",
          nombre_servicio: "PADRON CP - Arzobispo Mayoral",
        },
      ],
    });
  }) as unknown as typeof fetch;

  const info = await enrichNames({ servicio: 99, centro: 10 }, jar, fakeFetch);
  assert.equal(info.servicioName, "PADRON CP - Arzobispo Mayoral");
  assert.equal(info.centroName, "GESTIÓN TRIBUTARIA INTEGRAL");
  assert.equal(info.idPeriodo, 6);
});

test("listCenters hits §3.1 and flattens centros across groups", async () => {
  const jar = new CookieJar();
  const seen: string[] = [];
  const fakeFetch = (async (url: string | URL) => {
    seen.push(String(url));
    return jsonResponse([
      { centros: [{ id_centro: 10, nombre: "GTI", direccion: "VALENCIA" }] },
      { centros: [{ id_centro: 33 }, { nombre: "no id — dropped" }] },
    ]);
  }) as unknown as typeof fetch;

  const centers = await listCenters(33, jar, fakeFetch);

  assert.equal(
    seen[0],
    "https://www.valencia.es/qsige.localizador/citaPrevia/centros/servicio/disponible/33",
  );
  assert.deepEqual(
    centers.map((c) => c.id_centro),
    [10, 33],
  );
});
