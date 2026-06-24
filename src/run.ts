import { CookieJar } from "./cookies.ts";
import { detectHit } from "./detect.ts";
import {
  bootstrapSession,
  pollFirstAvailable,
  enrichNames,
  type EnrichedNames,
} from "./session.ts";
import { sendTelegramAlert } from "./telegram.ts";
import type { Config, Hit, Target, TelegramConfig } from "./types.ts";

export type RunDeps = {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  log?: (message: string) => void;
};

export type RunResult = { hit: boolean; detectedAt?: string };

// Human-readable label for a target — its configured label, or a
// servicio/centro fallback for matrix entries that don't carry one.
export function targetLabel(target: Target): string {
  return target.label ?? `servicio ${target.servicio}/centro ${target.centro}`;
}

// Poll a single target on an already-bootstrapped session: §3.2 poll →
// detection (§3.2/FR1) → enrich (§3.3) → Telegram alert (§6/FR2). Reused by
// both the tracer-bullet runOnce and the production loop.
export async function pollAndNotify(
  target: Target,
  telegram: TelegramConfig,
  jar: CookieJar,
  deps: RunDeps = {},
): Promise<RunResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});

  const label = targetLabel(target);

  // Poll §3.2 and apply the detection rule (§3.2/FR1).
  const payload = await pollFirstAvailable(target, jar, fetchImpl);
  if (!detectHit(payload)) {
    log(`no slot for ${label}`);
    return { hit: false };
  }

  // HIT — enrich names (§3.3) and notify (§6/FR2).
  const detectedAt = now().toISOString();
  let enriched: EnrichedNames = {};
  try {
    enriched = await enrichNames(target, jar, fetchImpl);
  } catch (err) {
    log(`enrich failed (continuing with ids): ${(err as Error).message}`);
  }

  const hit: Hit = {
    servicio: target.servicio,
    centro: target.centro,
    servicioName: enriched.servicioName,
    centroName: enriched.centroName,
    idPeriodo: enriched.idPeriodo,
    raw: payload,
    detectedAt,
  };

  log(`HIT for ${label} — notifying Telegram`);
  await sendTelegramAlert(telegram, hit, fetchImpl);
  log(`Telegram alert sent for ${label}`);

  return { hit: true, detectedAt };
}

// PRD §2 tracer bullet: one session bootstrap + one poll + conditional alert.
export async function runOnce(
  config: Config,
  deps: RunDeps = {},
): Promise<RunResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const log = deps.log ?? (() => {});

  // Session bootstrap (§7/FR5).
  const jar = new CookieJar();
  await bootstrapSession(jar, fetchImpl);
  log(`session bootstrapped (cookies: ${jar.isEmpty() ? "none" : "ok"})`);

  return pollAndNotify(config.target, config.telegram, jar, deps);
}
