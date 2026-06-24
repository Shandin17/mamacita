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
