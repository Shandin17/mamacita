import { test } from "node:test";
import assert from "node:assert/strict";
import { CookieJar } from "../src/cookies.ts";
import { buildTargetMatrix, STATIC_TARGETS } from "../src/targets.ts";

const jsonResp = (obj: unknown) =>
  new Response(JSON.stringify(obj), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

test("static targets cover servicio 16 (7 juntas centers) + servicio 99", () => {
  const s16 = STATIC_TARGETS.filter((t) => t.servicio === 16);
  const s99 = STATIC_TARGETS.filter((t) => t.servicio === 99);
  assert.equal(s16.length, 7);
  assert.deepEqual(
    s16.map((t) => t.centro).sort((a, b) => a - b),
    [1, 2, 4, 5, 6, 7, 14],
  );
  assert.equal(s99.length, 1);
  assert.equal(s99[0].centro, 10);
});

test("buildTargetMatrix resolves Tabacalera (servicio 33) centers via §3.1", async () => {
  const jar = new CookieJar();
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL) => {
    calls.push(String(url));
    // §3.1 response shape: [{ centros: [{ id_centro, nombre, direccion }] }]
    return jsonResp([
      {
        centros: [
          { id_centro: 20, nombre: "OAC Tabacalera", direccion: "VALENCIA" },
          { id_centro: 21, nombre: "OAC Tabacalera 2" },
        ],
      },
    ]);
  }) as unknown as typeof fetch;

  const matrix = await buildTargetMatrix(jar, fetchImpl);

  assert.ok(
    calls.some((u) =>
      u.includes("/citaPrevia/centros/servicio/disponible/33"),
    ),
    "should call the §3.1 centers endpoint for servicio 33",
  );
  const tabacalera = matrix.filter((t) => t.servicio === 33);
  assert.deepEqual(
    tabacalera.map((t) => t.centro),
    [20, 21],
  );
  // Full matrix = 7 + 1 + 2.
  assert.equal(matrix.length, 10);
});

test("buildTargetMatrix continues without Tabacalera when §3.1 fails", async () => {
  const jar = new CookieJar();
  const fetchImpl = (async () =>
    new Response("<html></html>", {
      status: 403,
      headers: { "content-type": "text/html" },
    })) as unknown as typeof fetch;

  const matrix = await buildTargetMatrix(jar, fetchImpl);

  assert.equal(matrix.filter((t) => t.servicio === 33).length, 0);
  assert.equal(matrix.length, STATIC_TARGETS.length);
});
