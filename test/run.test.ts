import { test } from "node:test";
import assert from "node:assert/strict";
import { runOnce } from "../src/run.ts";
import type { Config } from "../src/types.ts";

const config: Config = {
  target: { servicio: 16, centro: 5, label: "Transits" },
  telegram: { botToken: "BOT", chatId: "CHAT" },
  profile: {
    nombre: "Valerii",
    apellidos: "Shandin",
    tipoDocumento: "NIF/NIE",
    documento: "Z4610343K",
    telefono: "600000000",
    email: "valerii@example.com",
  },
  schedule: {
    baseSec: 180,
    jitterSec: 60,
    staggerMinSec: 1.5,
    staggerMaxSec: 3,
    activeStartHour: 7,
    activeEndHour: 15,
    activeDays: [1, 2, 3, 4, 5],
    timezone: "Europe/Madrid",
  },
  backoff: { baseSec: 30, factor: 2, capSec: 900 },
  state: { cooldownSec: 21600, captureDir: "captures" },
  minDateISO: "2026-06-27",
  liveness: { heartbeatHour: -1, degradedThreshold: 3, statusCommand: false },
};

const indexResp = () =>
  new Response("<html></html>", {
    status: 200,
    headers: new Headers({
      "content-type": "text/html",
      "set-cookie": "JSESSIONID=sess1; Path=/",
    }),
  });

const jsonResp = (obj: unknown) =>
  new Response(JSON.stringify(obj), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

function fetchRouter(routes: (url: string) => Response) {
  const calls: string[] = [];
  const fn = (async (url: string | URL) => {
    calls.push(String(url));
    return routes(String(url));
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const now = () => new Date("2026-06-24T10:43:07.000Z");

test("empty response logs 'no slot' and does not notify", async () => {
  const logs: string[] = [];
  const { fn, calls } = fetchRouter((url) => {
    if (url.includes("index.html")) return indexResp();
    if (url.includes("primera/disponible"))
      return jsonResp({ dias: [], dias_calendario: [], periodos: [] });
    if (url.includes("api.telegram.org"))
      throw new Error("must not notify on empty response");
    throw new Error(`unexpected url ${url}`);
  });

  const result = await runOnce(config, {
    fetchImpl: fn,
    now,
    log: (m) => logs.push(m),
  });

  assert.equal(result.hit, false);
  assert.ok(logs.some((l) => /no slot/i.test(l)));
  assert.ok(!calls.some((u) => u.includes("api.telegram.org")));
});

test("non-empty dias is detected as a HIT and notifies via Telegram", async () => {
  const logs: string[] = [];
  let telegramBody: any = null;
  const { fn, calls } = fetchRouter((url) => {
    if (url.includes("index.html")) return indexResp();
    if (url.includes("primera/disponible"))
      return jsonResp({ dias: ["2026-06-27"], dias_calendario: [] });
    if (url.includes("/calendario"))
      return jsonResp({
        periodos: [
          {
            id_periodo: 6,
            nombre_centro: "Junta de Distrito Transits",
            nombre_servicio: "PADRON CP - Juntas Municipales",
          },
        ],
      });
    if (url.includes("api.telegram.org"))
      return jsonResp({ ok: true });
    throw new Error(`unexpected url ${url}`);
  });

  const result = await runOnce(config, {
    fetchImpl: fn,
    now,
    log: (m) => logs.push(m),
  });

  assert.equal(result.hit, true);
  assert.equal(result.detectedAt, "2026-06-24T10:43:07.000Z");
  assert.ok(calls.some((u) => u.includes("api.telegram.org")));

  // Capture the Telegram POST body for assertions.
  const tgCallIndex = calls.findIndex((u) => u.includes("api.telegram.org"));
  assert.ok(tgCallIndex >= 0);
});

test("telegram message carries enriched names, timestamp and deep-link button", async () => {
  let body: any = null;
  const fn = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("index.html")) return indexResp();
    if (u.includes("primera/disponible"))
      return jsonResp({ dias: ["2026-06-27"], dias_calendario: [] });
    if (u.includes("/calendario"))
      return jsonResp({
        periodos: [
          {
            id_periodo: 6,
            nombre_centro: "Junta de Distrito Transits",
            nombre_servicio: "PADRON CP - Juntas Municipales",
          },
        ],
      });
    if (u.includes("api.telegram.org")) {
      body = JSON.parse(String(init?.body));
      return jsonResp({ ok: true });
    }
    throw new Error(`unexpected url ${u}`);
  }) as unknown as typeof fetch;

  await runOnce(config, { fetchImpl: fn, now, log: () => {} });

  assert.equal(body.chat_id, "CHAT");
  assert.match(body.text, /PADRON CP - Juntas Municipales/);
  assert.match(body.text, /Junta de Distrito Transits/);
  assert.match(body.text, /2026-06-24T10:43:07.000Z/);
  assert.equal(body.disable_web_page_preview, true);
  assert.equal(
    body.reply_markup.inline_keyboard[0][0].url,
    "https://www.valencia.es/QSIGE/apps/citaprevia/index.html?idioma=VA#!/newAppointment/16",
  );
});
