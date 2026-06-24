import { test } from "node:test";
import assert from "node:assert/strict";
import { CookieJar } from "../src/cookies.ts";
import { buildTargetMatrix, discoverCenters } from "../src/targets.ts";

const jsonResp = (obj: unknown) =>
  new Response(JSON.stringify(obj), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

// PRD v2 §3.1 response shapes for servicio 16 / 99, used by auto-discovery.
const CENTROS: Record<number, unknown> = {
  16: [
    {
      centros: [
        { id_centro: 7, nombre: "JUNTA DE DISTRITO ABASTOS", direccion: "VALENCIA" },
        { id_centro: 6, nombre: "JUNTA DE DISTRITO EXPOSICION", direccion: "VALENCIA" },
        { id_centro: 1, nombre: "JUNTA DE DISTRITO MARITIMO", direccion: "VALENCIA" },
      ],
    },
  ],
  99: [
    {
      centros: [
        { id_centro: 10, nombre: "GESTIÓN TRIBUTARIA INTEGRAL", direccion: "VALENCIA" },
      ],
    },
  ],
};

function discoveryFetch() {
  const calls: string[] = [];
  const fn = (async (url: string | URL) => {
    const u = String(url);
    calls.push(u);
    const match = u.match(/\/centros\/servicio\/disponible\/(\d+)/);
    const servicio = match ? Number(match[1]) : NaN;
    return jsonResp(CENTROS[servicio] ?? []);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

test("discoverCenters auto-discovers all centers for a service (§3.1, no hardcoding)", async () => {
  const jar = new CookieJar();
  const { fn, calls } = discoveryFetch();

  const targets = await discoverCenters(16, jar, fn);

  assert.ok(
    calls.some((u) => u.includes("/citaPrevia/centros/servicio/disponible/16")),
    "should call the §3.1 centers endpoint for the service",
  );
  assert.deepEqual(
    targets.map((t) => t.centro),
    [7, 6, 1],
  );
  // §3.1 metadata flows onto the target so notifications can show name+address.
  assert.equal(targets[0].servicio, 16);
  assert.equal(targets[0].centroName, "JUNTA DE DISTRITO ABASTOS");
  assert.equal(targets[0].direccion, "VALENCIA");
});

test("buildTargetMatrix discovers every (servicio, centro) pair for configured services", async () => {
  const jar = new CookieJar();
  const { fn, calls } = discoveryFetch();

  const matrix = await buildTargetMatrix([16, 99], jar, fn);

  assert.ok(calls.some((u) => u.includes("disponible/16")));
  assert.ok(calls.some((u) => u.includes("disponible/99")));
  // 3 juntas centers (mocked) + 1 GTI center = 4 targets, no hardcoded IDs.
  assert.equal(matrix.length, 4);
  assert.equal(matrix.filter((t) => t.servicio === 16).length, 3);
  assert.equal(matrix.filter((t) => t.servicio === 99).length, 1);
});

test("buildTargetMatrix continues past a service whose discovery fails (§FR1)", async () => {
  const jar = new CookieJar();
  const fn = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes("disponible/16"))
      return new Response("<html></html>", {
        status: 403,
        headers: { "content-type": "text/html" },
      });
    return jsonResp(CENTROS[99]);
  }) as unknown as typeof fetch;

  const logs: string[] = [];
  const matrix = await buildTargetMatrix([16, 99], jar, fn, (m) => logs.push(m));

  // 16 failed, 99 still resolved → only the GTI center remains.
  assert.equal(matrix.filter((t) => t.servicio === 16).length, 0);
  assert.equal(matrix.filter((t) => t.servicio === 99).length, 1);
  assert.ok(logs.some((l) => /16/.test(l) && /fail/i.test(l)));
});
