import { CookieJar } from "./cookies.ts";
import { detectHit } from "./detect.ts";
import {
  bootstrapSession,
  pollFirstAvailable,
  enrichNames,
  type EnrichedNames,
} from "./session.ts";
import { sendTelegramAlert } from "./telegram.ts";
import type { Config, Hit } from "./types.ts";

export type RunDeps = {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  log?: (message: string) => void;
};

export type RunResult = { hit: boolean; detectedAt?: string };

// PRD §2 tracer bullet: one session bootstrap + one poll + conditional alert.
export async function runOnce(
  config: Config,
  deps: RunDeps = {},
): Promise<RunResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});

  const { target, telegram } = config;
  const label = target.label ?? `servicio ${target.servicio}/centro ${target.centro}`;

  // 1. Session bootstrap (§7/FR5).
  const jar = new CookieJar();
  await bootstrapSession(jar, fetchImpl);
  log(`session bootstrapped (cookies: ${jar.isEmpty() ? "none" : "ok"})`);

  // 2. Poll §3.2 once.
  const payload = await pollFirstAvailable(target, jar, fetchImpl);

  // 3. Detection rule (§3.2/FR1).
  if (!detectHit(payload)) {
    log(`no slot for ${label}`);
    return { hit: false };
  }

  // 4. HIT — enrich names (§3.3) and notify (§6/FR2).
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
