import { CookieJar } from "./cookies.ts";
import { detectHit } from "./detect.ts";
import { parseEligibleDates } from "./dates.ts";
import { MonitorState, targetKey } from "./state.ts";
import {
  bootstrapSession,
  pollFirstAvailable,
  fetchCalendar,
  extractEnrichedNames,
  type EnrichedNames,
} from "./session.ts";
import { buildTargetMatrix } from "./targets.ts";
import { sendTelegramAlert } from "./telegram.ts";
import type { Config, Hit, Target, TelegramConfig } from "./types.ts";

export type RunDeps = {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  log?: (message: string) => void;
};

// PRD §8.4 capture-on-hit sink — dumps the raw §3.2 + §3.3 payloads somewhere.
export type CaptureFn = (
  target: Target,
  firstAvailable: unknown,
  calendar: unknown,
  now: Date,
) => void;

// PRD §FR6/§FR1 — de-dup state, date floor and optional capture sink that
// govern when a HIT actually produces an alert. Threaded into pollAndNotify by
// both the one-shot runOnce and the production loop.
export type PollPolicy = {
  state: MonitorState;
  minDateISO: string;
  cooldownMs: number;
  capture?: CaptureFn; // undefined → capture-on-hit disabled (one-shot runOnce)
};

export type RunResult = { hit: boolean; alerted?: boolean; detectedAt?: string };

// Human-readable label for a target — its configured label, or a
// servicio/centro fallback for matrix entries that don't carry one.
export function targetLabel(target: Target): string {
  return target.label ?? `servicio ${target.servicio}/centro ${target.centro}`;
}

// Poll a single target on an already-bootstrapped session: §3.2 poll →
// detection (§3.2/FR1) → date filter (§FR1) → de-dup (§FR6) → enrich (§3.3) →
// capture-on-hit (§8.4) → Telegram alert (§6/FR2). Reused by both the
// tracer-bullet runOnce and the production loop.
export async function pollAndNotify(
  target: Target,
  telegram: TelegramConfig,
  jar: CookieJar,
  deps: RunDeps,
  policy: PollPolicy,
): Promise<RunResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});

  const label = targetLabel(target);
  const key = targetKey(target);

  // Poll §3.2 and apply the detection rule (§3.2/FR1).
  const payload = await pollFirstAvailable(target, jar, fetchImpl);
  if (!detectHit(payload)) {
    // Forget any prior signature so a later reappearance re-alerts (§FR6).
    policy.state.clear(key);
    log(`no slot for ${label}`);
    return { hit: false };
  }

  // §FR1 — drop dates before minDateISO when the structure exposes them; an
  // opaque structure still alerts and lets the human judge.
  const { opaque, dates } = parseEligibleDates(payload, policy.minDateISO);
  if (!opaque && dates.length === 0) {
    // Availability exists but every date precedes minDateISO → not actionable.
    policy.state.clear(key);
    log(`slot for ${label} dropped — all dates before ${policy.minDateISO}`);
    return { hit: false };
  }

  // §FR6 — alert once per distinct signature. Parsed eligible dates make the
  // signature; an opaque payload hashes to itself so identical dumps de-dup.
  // One timestamp for the whole detection event keeps de-dup, capture and the
  // alert's detectedAt consistent.
  const signature = opaque ? `opaque:${JSON.stringify(payload)}` : dates.join(",");
  const detectedAtDate = now();
  const decision = policy.state.decide(
    key,
    signature,
    detectedAtDate,
    policy.cooldownMs,
  );
  if (!decision.alert) {
    log(`slot for ${label} already alerted (${decision.reason}) — skipping`);
    return { hit: true, alerted: false };
  }

  // We will alert. Enrich names (§3.3) and keep the raw calendar for capture.
  const detectedAt = detectedAtDate.toISOString();
  let calendarRaw: unknown;
  let enriched: EnrichedNames = {};
  try {
    calendarRaw = await fetchCalendar(target, jar, fetchImpl);
    enriched = extractEnrichedNames(calendarRaw);
  } catch (err) {
    log(`enrich failed (continuing with ids): ${(err as Error).message}`);
  }

  // §8.4 capture-on-hit: dump the raw §3.2 + §3.3 payloads on the first HIT.
  if (policy.capture && !policy.state.hasCaptured()) {
    try {
      policy.capture(target, payload, calendarRaw, detectedAtDate);
      policy.state.markCaptured();
      log(`captured first-HIT raw payloads for ${label}`);
    } catch (err) {
      log(`capture failed (continuing): ${(err as Error).message}`);
    }
  }

  const hit: Hit = {
    servicio: target.servicio,
    centro: target.centro,
    servicioName: enriched.servicioName,
    // §3.3 enrich wins; fall back to the §3.1 discovery metadata (FR1).
    centroName: enriched.centroName ?? target.centroName,
    direccion: target.direccion,
    idPeriodo: enriched.idPeriodo,
    raw: payload,
    detectedAt,
    dates: opaque ? undefined : dates,
  };

  log(`HIT for ${label} (${decision.reason}) — notifying Telegram`);
  await sendTelegramAlert(telegram, hit, fetchImpl);
  // Only record after a successful send so a failed alert retries next cycle.
  policy.state.recordAlert(key, signature, detectedAtDate);
  log(`Telegram alert sent for ${label}`);

  return { hit: true, alerted: true, detectedAt };
}

// PRD §2 tracer bullet: one session bootstrap + auto-discover the target matrix
// (§3.1/FR1) + one poll per discovered target + conditional alert. Uses
// ephemeral in-memory state (no persistence, no capture) — de-dup and
// capture-on-hit are production-loop concerns (FR6 / §8.4).
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

  // §FR1 — discover all (servicio, centro) targets for the configured services.
  const targets = await buildTargetMatrix(config.services, jar, fetchImpl, log);
  log(`target matrix built: ${targets.length} targets`);

  const policy: PollPolicy = {
    state: new MonitorState(),
    minDateISO: config.minDateISO,
    cooldownMs: config.state.cooldownSec * 1000,
  };

  // Poll every target once; a single target's failure must not stop the rest
  // (§FR1). Aggregate to "hit if any target hit / alerted".
  let aggregate: RunResult = { hit: false };
  for (const target of targets) {
    try {
      const result = await pollAndNotify(
        target,
        config.telegram,
        jar,
        deps,
        policy,
      );
      if (result.alerted)
        aggregate = {
          hit: true,
          alerted: true,
          detectedAt: result.detectedAt,
        };
      else if (result.hit && !aggregate.alerted) aggregate = { ...result };
    } catch (err) {
      log(`target ${targetLabel(target)} failed: ${(err as Error).message}`);
    }
  }
  return aggregate;
}
