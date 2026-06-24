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

const configSchema = z.object({
  target: targetSchema,
  telegram: telegramSchema,
  profile: profileSchema,
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

  if (env.TARGET_SERVICIO !== undefined)
    target.servicio = Number(env.TARGET_SERVICIO);
  if (env.TARGET_CENTRO !== undefined)
    target.centro = Number(env.TARGET_CENTRO);
  if (env.TELEGRAM_BOT_TOKEN !== undefined)
    telegram.botToken = env.TELEGRAM_BOT_TOKEN;
  if (env.TELEGRAM_CHAT_ID !== undefined)
    telegram.chatId = env.TELEGRAM_CHAT_ID;

  return { ...base, target, telegram };
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
