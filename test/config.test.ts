import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";

const base = {
  target: { servicio: 16, centro: 5, label: "Transits" },
  telegram: { botToken: "FILE_TOKEN", chatId: "FILE_CHAT" },
  profile: {
    nombre: "Valerii",
    apellidos: "Shandin",
    tipoDocumento: "NIF/NIE",
    documento: "Z4610343K",
    telefono: "600000000",
    email: "valerii@example.com",
  },
};

test("loads a valid config object unchanged", () => {
  const cfg = loadConfig(base, {});
  assert.equal(cfg.target.servicio, 16);
  assert.equal(cfg.telegram.botToken, "FILE_TOKEN");
  assert.equal(cfg.profile.nombre, "Valerii");
});

test("env overrides telegram credentials and target", () => {
  const cfg = loadConfig(base, {
    TELEGRAM_BOT_TOKEN: "ENV_TOKEN",
    TELEGRAM_CHAT_ID: "ENV_CHAT",
    TARGET_SERVICIO: "99",
    TARGET_CENTRO: "10",
  });
  assert.equal(cfg.telegram.botToken, "ENV_TOKEN");
  assert.equal(cfg.telegram.chatId, "ENV_CHAT");
  assert.equal(cfg.target.servicio, 99);
  assert.equal(cfg.target.centro, 10);
});

test("env can supply credentials missing from the file (no secrets in code)", () => {
  const noSecrets = {
    ...base,
    telegram: { botToken: "", chatId: "" },
  };
  const cfg = loadConfig(noSecrets, {
    TELEGRAM_BOT_TOKEN: "ENV_TOKEN",
    TELEGRAM_CHAT_ID: "ENV_CHAT",
  });
  assert.equal(cfg.telegram.botToken, "ENV_TOKEN");
  assert.equal(cfg.telegram.chatId, "ENV_CHAT");
});

test("schedule defaults are applied when absent (§FR4)", () => {
  const cfg = loadConfig(base, {});
  assert.equal(cfg.schedule.baseSec, 180);
  assert.equal(cfg.schedule.jitterSec, 60);
  assert.equal(cfg.schedule.activeStartHour, 7);
  assert.equal(cfg.schedule.activeEndHour, 15);
  assert.deepEqual(cfg.schedule.activeDays, [1, 2, 3, 4, 5]);
  assert.equal(cfg.schedule.timezone, "Europe/Madrid");
});

test("schedule thresholds are configurable via file and env", () => {
  const withFile = loadConfig({ ...base, schedule: { baseSec: 300 } }, {});
  assert.equal(withFile.schedule.baseSec, 300);
  assert.equal(withFile.schedule.jitterSec, 60); // untouched default

  const withEnv = loadConfig(base, {
    POLL_BASE_SEC: "120",
    POLL_JITTER_SEC: "30",
    POLL_TIMEZONE: "Atlantic/Canary",
  });
  assert.equal(withEnv.schedule.baseSec, 120);
  assert.equal(withEnv.schedule.jitterSec, 30);
  assert.equal(withEnv.schedule.timezone, "Atlantic/Canary");
});

test("backoff defaults are applied when absent (§FR4/§FR5)", () => {
  const cfg = loadConfig(base, {});
  assert.equal(cfg.backoff.baseSec, 30);
  assert.equal(cfg.backoff.factor, 2);
  assert.equal(cfg.backoff.capSec, 900);
});

test("backoff thresholds are configurable via file and env", () => {
  const withFile = loadConfig({ ...base, backoff: { capSec: 600 } }, {});
  assert.equal(withFile.backoff.capSec, 600);
  assert.equal(withFile.backoff.baseSec, 30); // untouched default

  const withEnv = loadConfig(base, {
    BACKOFF_BASE_SEC: "10",
    BACKOFF_FACTOR: "3",
    BACKOFF_CAP_SEC: "1200",
  });
  assert.equal(withEnv.backoff.baseSec, 10);
  assert.equal(withEnv.backoff.factor, 3);
  assert.equal(withEnv.backoff.capSec, 1200);
});

test("manual cookie override is read from file and env (§FR5)", () => {
  assert.equal(loadConfig(base, {}).manualCookie, undefined);

  const withFile = loadConfig({ ...base, manualCookie: "JSESSIONID=file" }, {});
  assert.equal(withFile.manualCookie, "JSESSIONID=file");

  const withEnv = loadConfig(base, { MANUAL_COOKIE: "JSESSIONID=env" });
  assert.equal(withEnv.manualCookie, "JSESSIONID=env");
});

test("state + minDateISO defaults are applied when absent (§FR6/§FR1)", () => {
  const cfg = loadConfig(base, {});
  assert.equal(cfg.minDateISO, "2026-06-27");
  assert.equal(cfg.state.file, undefined);
  assert.equal(cfg.state.captureDir, "captures");
  assert.ok(cfg.state.cooldownSec > 0);
});

test("state + minDateISO are configurable via file and env", () => {
  const withFile = loadConfig(
    { ...base, minDateISO: "2026-07-01", state: { file: "s.json", cooldownSec: 60 } },
    {},
  );
  assert.equal(withFile.minDateISO, "2026-07-01");
  assert.equal(withFile.state.file, "s.json");
  assert.equal(withFile.state.cooldownSec, 60);
  assert.equal(withFile.state.captureDir, "captures"); // untouched default

  const withEnv = loadConfig(base, {
    MIN_DATE_ISO: "2026-08-15",
    STATE_FILE: "/tmp/state.json",
  });
  assert.equal(withEnv.minDateISO, "2026-08-15");
  assert.equal(withEnv.state.file, "/tmp/state.json");
});

test("throws on invalid target servicio", () => {
  assert.throws(() =>
    loadConfig({ ...base, target: { servicio: -1, centro: 5 } }, {}),
  );
});

test("throws when telegram credentials are missing entirely", () => {
  assert.throws(() =>
    loadConfig({ ...base, telegram: { botToken: "", chatId: "" } }, {}),
  );
});

test("throws on invalid profile email", () => {
  assert.throws(() =>
    loadConfig({ ...base, profile: { ...base.profile, email: "not-an-email" } }, {}),
  );
});
