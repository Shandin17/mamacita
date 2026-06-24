import { test } from "node:test";
import assert from "node:assert/strict";
import { runLoop, type LoopDeps } from "../src/loop.ts";
import type { Config, Target } from "../src/types.ts";

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
};

const matrix: Target[] = [
  { servicio: 16, centro: 5, label: "A" },
  { servicio: 16, centro: 6, label: "B" },
  { servicio: 99, centro: 10, label: "C" },
];

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

// An active weekday, mid-window (12:43 CEST).
const activeNow = () => new Date("2026-06-24T10:43:07.000Z");

// Build deps that stop the loop after N cycles and record sleeps.
function harness(opts: {
  routes: (url: string) => Response;
  cycles: number;
  now?: () => Date;
}): { deps: LoopDeps; calls: string[]; sleeps: number[]; logs: string[] } {
  const calls: string[] = [];
  const sleeps: number[] = [];
  const logs: string[] = [];
  let cycleSleeps = 0;
  const fetchImpl = (async (url: string | URL) => {
    calls.push(String(url));
    return opts.routes(String(url));
  }) as unknown as typeof fetch;

  const deps: LoopDeps = {
    fetchImpl,
    now: opts.now ?? activeNow,
    rng: () => 0.5,
    log: (m) => logs.push(m),
    buildMatrix: async () => matrix,
    sleep: async (ms) => {
      sleeps.push(ms);
      // The big inter-cycle delay is the cycle boundary; count those.
      if (ms >= config.schedule.baseSec * 1000) cycleSleeps++;
    },
    shouldContinue: () => cycleSleeps < opts.cycles,
  };
  return { deps, calls, sleeps, logs };
}

test("each cycle polls every target and staggers requests", async () => {
  const { deps, calls, sleeps } = harness({
    cycles: 1,
    routes: (url) => {
      if (url.includes("index.html")) return indexResp();
      if (url.includes("primera/disponible"))
        return jsonResp({ dias: [], dias_calendario: [] });
      throw new Error(`unexpected url ${url}`);
    },
  });

  await runLoop(config, deps);

  // One §3.2 poll per target this cycle.
  const polls = calls.filter((u) => u.includes("primera/disponible"));
  assert.equal(polls.length, 3);
  // Stagger sleeps between the 3 targets = 2 small sleeps of (1.5+3)/2 = 2.25s.
  const staggers = sleeps.filter((ms) => ms === 2250);
  assert.equal(staggers.length, 2);
  // Inter-cycle jittered delay (rng=0.5 → 180+30 = 210s).
  assert.ok(sleeps.includes(210_000));
});

test("notifies via Telegram on a HIT and continues", async () => {
  const { deps, calls } = harness({
    cycles: 1,
    routes: (url) => {
      if (url.includes("index.html")) return indexResp();
      if (url.includes("primera/disponible"))
        // Only center 6 has a slot.
        return url.includes("/centro/6/")
          ? jsonResp({ dias: ["2026-06-27"], dias_calendario: [] })
          : jsonResp({ dias: [], dias_calendario: [] });
      if (url.includes("/calendario"))
        return jsonResp({
          periodos: [{ nombre_centro: "B", nombre_servicio: "Padron" }],
        });
      if (url.includes("api.telegram.org")) return jsonResp({ ok: true });
      throw new Error(`unexpected url ${url}`);
    },
  });

  await runLoop(config, deps);

  const tg = calls.filter((u) => u.includes("api.telegram.org"));
  assert.equal(tg.length, 1);
});

test("a single target's failure does not kill the loop", async () => {
  const { deps, calls, logs } = harness({
    cycles: 1,
    routes: (url) => {
      if (url.includes("index.html")) return indexResp();
      if (url.includes("primera/disponible")) {
        // Center 6 returns a session-dead HTML page → pollAndNotify throws.
        if (url.includes("/centro/6/"))
          return new Response("<html></html>", {
            status: 403,
            headers: { "content-type": "text/html" },
          });
        return jsonResp({ dias: [], dias_calendario: [] });
      }
      throw new Error(`unexpected url ${url}`);
    },
  });

  await runLoop(config, deps);

  // All three targets were still polled despite B failing.
  const polls = calls.filter((u) => u.includes("primera/disponible"));
  assert.equal(polls.length, 3);
  assert.ok(logs.some((l) => /target B failed/i.test(l)));
});

test("off-hours: sleeps until the window reopens instead of polling", async () => {
  // Saturday — entirely outside the active-days window.
  const saturday = () => new Date("2026-06-27T10:00:00.000Z");
  let slept = false;
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL) => {
    calls.push(String(url));
    return indexResp();
  }) as unknown as typeof fetch;

  const deps: LoopDeps = {
    fetchImpl,
    now: saturday,
    rng: () => 0.5,
    buildMatrix: async () => matrix,
    sleep: async () => {
      slept = true;
    },
    // Stop after the first off-hours sleep.
    shouldContinue: () => !slept,
  };

  await runLoop(config, deps);

  // Bootstrap happened, but no availability polls were made off-hours.
  assert.equal(calls.filter((u) => u.includes("primera/disponible")).length, 0);
  assert.equal(slept, true);
});
