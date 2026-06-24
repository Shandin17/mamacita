import { test } from "node:test";
import assert from "node:assert/strict";
import { runLoop, type LoopDeps } from "../src/loop.ts";
import { MonitorState } from "../src/state.ts";
import type { Config, Target } from "../src/types.ts";

const config: Config = {
  target: { servicio: 16, centro: 5, label: "Transits" },
  telegram: { botToken: "BOT", chatId: "CHAT" },
  profile: {
    nombre: "Test",
    apellidos: "User",
    tipoDocumento: "NIF/NIE",
    documento: "X0000000T",
    telefono: "600000000",
    email: "test@example.com",
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
  // Liveness off by default in these fixtures; individual tests opt in.
  liveness: { heartbeatHour: -1, degradedThreshold: 1000, statusCommand: false },
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
  state?: MonitorState;
}): {
  deps: LoopDeps;
  calls: string[];
  sleeps: number[];
  logs: string[];
  captures: Array<{ target: Target; firstAvailable: unknown }>;
} {
  const calls: string[] = [];
  const sleeps: number[] = [];
  const logs: string[] = [];
  const captures: Array<{ target: Target; firstAvailable: unknown }> = [];
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
    // Record capture-on-hit instead of touching disk (§8.4).
    capture: (target, firstAvailable) => captures.push({ target, firstAvailable }),
    state: opts.state,
    sleep: async (ms) => {
      sleeps.push(ms);
      // The big inter-cycle delay is the cycle boundary; count those.
      if (ms >= config.schedule.baseSec * 1000) cycleSleeps++;
    },
    shouldContinue: () => cycleSleeps < opts.cycles,
  };
  return { deps, calls, sleeps, logs, captures };
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

// A slot that lingers unchanged for many cycles must alert only once (§FR6).
test("de-dup: a lingering slot is alerted once across cycles, not every cycle", async () => {
  const { deps, calls } = harness({
    cycles: 3,
    routes: (url) => {
      if (url.includes("index.html")) return indexResp();
      if (url.includes("primera/disponible"))
        return url.includes("/centro/6/")
          ? jsonResp({ dias: ["2026-06-27"], dias_calendario: [] })
          : jsonResp({ dias: [], dias_calendario: [] });
      if (url.includes("/calendario"))
        return jsonResp({ periodos: [{ nombre_centro: "B" }] });
      if (url.includes("api.telegram.org")) return jsonResp({ ok: true });
      throw new Error(`unexpected url ${url}`);
    },
  });

  await runLoop(config, deps);

  // Three cycles polled the slot, but only the first sent an alert.
  const polls = calls.filter(
    (u) => u.includes("primera/disponible") && u.includes("/centro/6/"),
  );
  assert.equal(polls.length, 3);
  const tg = calls.filter((u) => u.includes("api.telegram.org"));
  assert.equal(tg.length, 1);
});

// PRD §8.4 — the first real HIT dumps the raw §3.2 + §3.3 payloads exactly once.
test("capture-on-hit fires once with both raw payloads", async () => {
  const { deps, captures } = harness({
    cycles: 3,
    routes: (url) => {
      if (url.includes("index.html")) return indexResp();
      if (url.includes("primera/disponible"))
        return url.includes("/centro/6/")
          ? jsonResp({ dias: ["2026-06-27"], dias_calendario: [] })
          : jsonResp({ dias: [], dias_calendario: [] });
      if (url.includes("/calendario"))
        return jsonResp({ periodos: [{ id_periodo: 6 }] });
      if (url.includes("api.telegram.org")) return jsonResp({ ok: true });
      throw new Error(`unexpected url ${url}`);
    },
  });

  await runLoop(config, deps);

  assert.equal(captures.length, 1);
  assert.equal(captures[0].target.centro, 6);
  assert.deepEqual(captures[0].firstAvailable, {
    dias: ["2026-06-27"],
    dias_calendario: [],
  });
});

// PRD §FR1 — availability whose dates all precede minDateISO is not actionable.
test("date filter: a slot entirely before minDateISO does not alert", async () => {
  const { deps, calls } = harness({
    cycles: 1,
    routes: (url) => {
      if (url.includes("index.html")) return indexResp();
      if (url.includes("primera/disponible"))
        return url.includes("/centro/6/")
          ? jsonResp({ dias: ["2026-06-01"], dias_calendario: [] }) // too early
          : jsonResp({ dias: [], dias_calendario: [] });
      if (url.includes("api.telegram.org"))
        throw new Error("must not alert on a too-early slot");
      throw new Error(`unexpected url ${url}`);
    },
  });

  await runLoop(config, deps);

  assert.equal(calls.filter((u) => u.includes("api.telegram.org")).length, 0);
});

// PRD §FR6 — a slot that disappears and later reappears re-alerts.
test("disappear→reappear re-alerts even with the same signature", async () => {
  // Shared state across two separate single-cycle runs simulates: HIT, gone, HIT.
  const state = new MonitorState();
  const slot = (present: boolean) =>
    harness({
      cycles: 1,
      state,
      routes: (url) => {
        if (url.includes("index.html")) return indexResp();
        if (url.includes("primera/disponible"))
          return url.includes("/centro/6/") && present
            ? jsonResp({ dias: ["2026-06-27"], dias_calendario: [] })
            : jsonResp({ dias: [], dias_calendario: [] });
        if (url.includes("/calendario"))
          return jsonResp({ periodos: [{ nombre_centro: "B" }] });
        if (url.includes("api.telegram.org")) return jsonResp({ ok: true });
        throw new Error(`unexpected url ${url}`);
      },
    });

  const present1 = slot(true);
  await runLoop(config, present1.deps); // HIT → alert
  const absent = slot(false);
  await runLoop(config, absent.deps); // gone → clears state
  const present2 = slot(true);
  await runLoop(config, present2.deps); // reappears → alert again

  assert.equal(
    present1.calls.filter((u) => u.includes("api.telegram.org")).length,
    1,
  );
  assert.equal(
    present2.calls.filter((u) => u.includes("api.telegram.org")).length,
    1,
  );
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

test("a fully-failed cycle re-bootstraps the session and backs off exponentially", async () => {
  const calls: string[] = [];
  const sleeps: number[] = [];
  const logs: string[] = [];
  let blocks = 0;
  const fetchImpl = (async (url: string | URL) => {
    const u = String(url);
    calls.push(u);
    if (u.includes("index.html")) return indexResp();
    if (u.includes("primera/disponible"))
      // Every target is blocked → SessionDeadError on each.
      return new Response("<html>blocked</html>", {
        status: 403,
        headers: { "content-type": "text/html" },
      });
    throw new Error(`unexpected url ${u}`);
  }) as unknown as typeof fetch;

  const deps: LoopDeps = {
    fetchImpl,
    now: activeNow,
    rng: () => 0.5,
    log: (m) => {
      logs.push(m);
      if (/backing off/i.test(m)) blocks++;
    },
    buildMatrix: async () => matrix,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    // Stop after the second block so we observe the exponential step.
    shouldContinue: () => blocks < 2,
  };

  await runLoop(config, deps);

  // Initial bootstrap + one re-bootstrap per blocked cycle.
  const indexGets = calls.filter((u) => u.includes("index.html"));
  assert.equal(indexGets.length, 3); // initial + 2 re-bootstraps
  // Backoff sleeps were applied and doubled: 30s then 60s.
  assert.ok(sleeps.includes(30_000));
  assert.ok(sleeps.includes(60_000));
  // No normal inter-cycle jittered delay (210s) — every cycle was blocked.
  assert.ok(!sleeps.includes(210_000));
  assert.ok(logs.some((l) => /re-bootstrap/i.test(l)));
});

test("backoff resets after the session recovers", async () => {
  const sleeps: number[] = [];
  const logs: string[] = [];
  let indexGets = 0;
  let recovered = false;
  const fetchImpl = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes("index.html")) {
      indexGets++;
      return indexResp();
    }
    if (u.includes("primera/disponible")) {
      // Blocked until the session has been re-bootstrapped once.
      if (indexGets < 2)
        return new Response("<html></html>", {
          status: 403,
          headers: { "content-type": "text/html" },
        });
      return jsonResp({ dias: [], dias_calendario: [] });
    }
    throw new Error(`unexpected url ${u}`);
  }) as unknown as typeof fetch;

  const deps: LoopDeps = {
    fetchImpl,
    now: activeNow,
    rng: () => 0.5,
    log: (m) => {
      logs.push(m);
      if (/cycle complete/i.test(m)) recovered = true;
    },
    buildMatrix: async () => matrix,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    // Stop once a healthy cycle has completed.
    shouldContinue: () => !recovered,
  };

  await runLoop(config, deps);

  assert.ok(sleeps.includes(30_000)); // backoff on the blocked cycle
  assert.ok(sleeps.includes(210_000)); // normal jittered delay once recovered
  assert.ok(logs.some((l) => /backoff reset/i.test(l)));
});

test("a manual cookie override is sent on every request (§FR5)", async () => {
  const cookieHeaders: (string | null)[] = [];
  let cycle = 0;
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    // Bootstrap returns no set-cookie, so only the manual override is present.
    if (u.includes("index.html"))
      return new Response("<html></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    if (u.includes("primera/disponible")) {
      cookieHeaders.push(new Headers(init?.headers).get("cookie"));
      return jsonResp({ dias: [], dias_calendario: [] });
    }
    throw new Error(`unexpected url ${u}`);
  }) as unknown as typeof fetch;

  const deps: LoopDeps = {
    fetchImpl,
    now: activeNow,
    rng: () => 0.5,
    log: (m) => {
      if (/cycle complete/i.test(m)) cycle++;
    },
    buildMatrix: async () => matrix,
    sleep: async () => {},
    shouldContinue: () => cycle < 1,
  };

  await runLoop({ ...config, manualCookie: "JSESSIONID=manual123" }, deps);

  assert.equal(cookieHeaders.length, 3);
  assert.ok(cookieHeaders.every((c) => c?.includes("JSESSIONID=manual123")));
});

// PRD §8.2 — the /status command replies with a status snapshot on demand.
test("answers a /status command with last poll time and per-target results", async () => {
  const sent: string[] = [];
  let cycle = 0;
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("index.html")) return indexResp();
    if (u.includes("primera/disponible"))
      return jsonResp({ dias: [], dias_calendario: [] });
    if (u.includes("getUpdates"))
      return jsonResp({
        ok: true,
        result: [{ update_id: 5, message: { text: "/status" } }],
      });
    if (u.includes("sendMessage")) {
      sent.push(JSON.parse(String(init?.body)).text);
      return jsonResp({ ok: true });
    }
    throw new Error(`unexpected url ${u}`);
  }) as unknown as typeof fetch;

  const deps: LoopDeps = {
    fetchImpl,
    now: activeNow,
    rng: () => 0.5,
    buildMatrix: async () => matrix,
    sleep: async (ms) => {
      if (ms >= config.schedule.baseSec * 1000) cycle++;
    },
    shouldContinue: () => cycle < 1,
  };

  await runLoop(
    { ...config, liveness: { heartbeatHour: -1, degradedThreshold: 1000, statusCommand: true } },
    deps,
  );

  assert.equal(sent.length, 1);
  assert.match(sent[0], /Estado del monitor/);
  assert.match(sent[0], /no-slot/);
});

// PRD §FR2 — a daily heartbeat is sent once per day on a configurable schedule.
test("sends one daily heartbeat once the heartbeat hour has passed", async () => {
  const sent: string[] = [];
  let cycle = 0;
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("index.html")) return indexResp();
    if (u.includes("primera/disponible"))
      return jsonResp({ dias: [], dias_calendario: [] });
    if (u.includes("sendMessage")) {
      sent.push(JSON.parse(String(init?.body)).text);
      return jsonResp({ ok: true });
    }
    throw new Error(`unexpected url ${u}`);
  }) as unknown as typeof fetch;

  const deps: LoopDeps = {
    fetchImpl,
    now: activeNow, // 10:43 CEST — past a 09:00 heartbeat
    rng: () => 0.5,
    buildMatrix: async () => matrix,
    sleep: async (ms) => {
      if (ms >= config.schedule.baseSec * 1000) cycle++;
    },
    // Two cycles — the heartbeat must still fire only once for the day.
    shouldContinue: () => cycle < 2,
  };

  await runLoop(
    { ...config, liveness: { heartbeatHour: 9, degradedThreshold: 1000, statusCommand: false } },
    deps,
  );

  const heartbeats = sent.filter((t) => /Monitor activo/.test(t));
  assert.equal(heartbeats.length, 1);
});

// PRD §FR2 — degraded-state alert after N consecutive fully-failed cycles.
test("fires a degraded-state alert after N consecutive failed cycles", async () => {
  const sent: string[] = [];
  let blocks = 0;
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("index.html")) return indexResp();
    if (u.includes("primera/disponible"))
      return new Response("<html>blocked</html>", {
        status: 403,
        headers: { "content-type": "text/html" },
      });
    if (u.includes("sendMessage")) {
      sent.push(JSON.parse(String(init?.body)).text);
      return jsonResp({ ok: true });
    }
    throw new Error(`unexpected url ${u}`);
  }) as unknown as typeof fetch;

  const deps: LoopDeps = {
    fetchImpl,
    now: activeNow,
    rng: () => 0.5,
    log: (m) => {
      if (/backing off/i.test(m)) blocks++;
    },
    buildMatrix: async () => matrix,
    sleep: async () => {},
    // Stop after the 3rd blocked cycle so the threshold (2) has tripped.
    shouldContinue: () => blocks < 3,
  };

  await runLoop(
    { ...config, liveness: { heartbeatHour: -1, degradedThreshold: 2, statusCommand: false } },
    deps,
  );

  const degraded = sent.filter((t) => /degradado/i.test(t));
  assert.equal(degraded.length, 1); // exactly once, not every blocked cycle
});

// Acceptance: heartbeat/degraded liveness traffic must not suppress HIT alerts.
test("a HIT alert still fires while the heartbeat is also due", async () => {
  const alerts: string[] = [];
  let cycle = 0;
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("index.html")) return indexResp();
    if (u.includes("primera/disponible"))
      return u.includes("/centro/6/")
        ? jsonResp({ dias: ["2026-06-27"], dias_calendario: [] })
        : jsonResp({ dias: [], dias_calendario: [] });
    if (u.includes("/calendario"))
      return jsonResp({ periodos: [{ nombre_centro: "B" }] });
    if (u.includes("sendMessage")) {
      alerts.push(JSON.parse(String(init?.body)).text);
      return jsonResp({ ok: true });
    }
    throw new Error(`unexpected url ${u}`);
  }) as unknown as typeof fetch;

  const deps: LoopDeps = {
    fetchImpl,
    now: activeNow,
    rng: () => 0.5,
    buildMatrix: async () => matrix,
    sleep: async (ms) => {
      if (ms >= config.schedule.baseSec * 1000) cycle++;
    },
    shouldContinue: () => cycle < 1,
  };

  await runLoop(
    { ...config, liveness: { heartbeatHour: 9, degradedThreshold: 1000, statusCommand: false } },
    deps,
  );

  assert.ok(alerts.some((t) => /SLOT/.test(t))); // HIT alert present
  assert.ok(alerts.some((t) => /Monitor activo/.test(t))); // heartbeat present too
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
