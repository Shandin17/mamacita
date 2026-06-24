import { z } from "zod";
import type { Config, CustomerProfile } from "./types.ts";

// PRD §7/FR7: config via object (config.json) + env overrides, no secrets in code.

const profileSchema = z.object({
  nombre: z.string().min(1),
  apellidos: z.string().min(1),
  tipoDocumento: z.enum(["NIF/NIE", "Pasaporte"]),
  documento: z.string().min(1),
  telefono: z.string().min(1),
  email: z.email(),
  observaciones: z.string().optional(),
});

const targetSchema = z.object({
  servicio: z.number().int().positive(),
  centro: z.number().int().positive(),
  label: z.string().optional(),
});

const telegramSchema = z.object({
  botToken: z.string().min(1, "telegram.botToken is required"),
  chatId: z.string().min(1, "telegram.chatId is required"),
});

// PRD §FR4/§FR7 — jittered, time-gated scheduling; every threshold configurable.
const scheduleSchema = z
  .object({
    baseSec: z.number().positive().default(180),
    jitterSec: z.number().nonnegative().default(60),
    staggerMinSec: z.number().nonnegative().default(1.5),
    staggerMaxSec: z.number().nonnegative().default(3),
    activeStartHour: z.number().int().min(0).max(23).default(7),
    activeEndHour: z.number().int().min(1).max(24).default(15),
    activeDays: z
      .array(z.number().int().min(0).max(6))
      .default([1, 2, 3, 4, 5]), // Mon–Fri
    timezone: z.string().default("Europe/Madrid"),
  })
  // prefault: treat a missing schedule as `{}` *before* parsing, so each
  // field's own default fills in (a plain .default() wants the output type).
  .prefault({});

const configSchema = z.object({
  target: targetSchema,
  telegram: telegramSchema,
  profile: profileSchema,
  schedule: scheduleSchema,
});

type Env = Record<string, string | undefined>;

// Coerce arbitrary parsed JSON into a plain object we can read keys from.
function asRecord(raw: unknown): Record<string, unknown> {
  return (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
}

function applyEnvOverrides(raw: unknown, env: Env): unknown {
  const base = asRecord(raw);
  const target = { ...((base.target as object) ?? {}) } as Record<
    string,
    unknown
  >;
  const telegram = { ...((base.telegram as object) ?? {}) } as Record<
    string,
    unknown
  >;
  const schedule = { ...((base.schedule as object) ?? {}) } as Record<
    string,
    unknown
  >;

  if (env.TARGET_SERVICIO !== undefined)
    target.servicio = Number(env.TARGET_SERVICIO);
  if (env.TARGET_CENTRO !== undefined)
    target.centro = Number(env.TARGET_CENTRO);
  if (env.TELEGRAM_BOT_TOKEN !== undefined)
    telegram.botToken = env.TELEGRAM_BOT_TOKEN;
  if (env.TELEGRAM_CHAT_ID !== undefined)
    telegram.chatId = env.TELEGRAM_CHAT_ID;

  // §FR4 scheduling overrides.
  if (env.POLL_BASE_SEC !== undefined)
    schedule.baseSec = Number(env.POLL_BASE_SEC);
  if (env.POLL_JITTER_SEC !== undefined)
    schedule.jitterSec = Number(env.POLL_JITTER_SEC);
  if (env.POLL_TIMEZONE !== undefined) schedule.timezone = env.POLL_TIMEZONE;

  return { ...base, target, telegram, schedule };
}

export function loadConfig(raw: unknown, env: Env = process.env): Config {
  const merged = applyEnvOverrides(raw, env);
  return configSchema.parse(merged);
}

// Validate just the CustomerProfile (§5). The autofill generator (FR3) needs
// the profile only — it must not require Telegram credentials to run.
export function loadProfile(raw: unknown): CustomerProfile {
  return profileSchema.parse(asRecord(raw).profile);
}
