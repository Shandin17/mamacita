import { Backoff } from "./backoff.ts";
import { captureToDir } from "./capture.ts";
import { CookieJar } from "./cookies.ts";
import {
  buildDegradedText,
  buildHeartbeatText,
  buildRecoveredText,
  buildStatusText,
  LivenessTracker,
} from "./liveness.ts";
import {
  pollAndNotify,
  targetLabel,
  type CaptureFn,
  type PollPolicy,
} from "./run.ts";
import {
  computeCycleDelayMs,
  computeStaggerMs,
  isActiveHours,
  msUntilNextActiveWindow,
} from "./schedule.ts";
import { bootstrapSession } from "./session.ts";
import { MonitorState, targetKey } from "./state.ts";
import { buildTargetMatrix } from "./targets.ts";
import { fetchUpdates, sendTelegramMessage } from "./telegram.ts";
import type { Config, Target } from "./types.ts";

export type LoopDeps = {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  rng?: () => number; // uniform [0, 1)
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
  // Stop predicate, checked each cycle/target — lets tests bound the loop.
  shouldContinue?: () => boolean;
  // Injectable matrix builder (defaults to §3.4 + §3.1 resolution).
  buildMatrix?: (
    jar: CookieJar,
    fetchImpl: typeof fetch,
    log: (m: string) => void,
  ) => Promise<Target[]>;
  // §FR6 de-dup state (defaults to config.state.file, in-memory if unset).
  state?: MonitorState;
  // §8.4 capture-on-hit sink (defaults to a disk dump under captureDir).
  capture?: CaptureFn;
  // §FR2/§8.2 liveness tracker (defaults to a fresh in-memory tracker).
  liveness?: LivenessTracker;
};

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// PRD §FR1/§FR4: the production monitor. Bootstrap once, build the full target
// matrix, then loop forever — each cycle polls every target (staggered) and
// alerts on HIT, sleeping a jittered delay between cycles and skipping
// off-hours. Never lets one target's failure kill the loop.
export async function runLoop(
  config: Config,
  deps: LoopDeps = {},
): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => new Date());
  const rng = deps.rng ?? Math.random;
  const sleep = deps.sleep ?? realSleep;
  const log = deps.log ?? (() => {});
  const shouldContinue = deps.shouldContinue ?? (() => true);
  const buildMatrix = deps.buildMatrix ?? buildTargetMatrix;
  const sched = config.schedule;

  // §FR6 de-dup state (persisted to disk when configured) + §8.4 capture sink.
  const state = deps.state ?? new MonitorState(config.state.file).load();
  const capture: CaptureFn =
    deps.capture ??
    ((target, firstAvailable, calendar, when) =>
      captureToDir(config.state.captureDir, target, firstAvailable, calendar, when));
  const policy: PollPolicy = {
    state,
    minDateISO: config.minDateISO,
    cooldownMs: config.state.cooldownSec * 1000,
    capture,
  };

  // §FR5: seed any manual cookie override, then bootstrap. A re-bootstrap
  // re-seeds the manual cookie too, so it survives cookie rotation as a
  // fallback when the fresh GET returns no usable session.
  const jar = new CookieJar();
  const refreshSession = async (reason: string): Promise<void> => {
    if (config.manualCookie) jar.setFromHeader(config.manualCookie);
    await bootstrapSession(jar, fetchImpl);
    log(`session ${reason} (cookies: ${jar.isEmpty() ? "none" : "ok"})`);
  };

  if (config.manualCookie) log("manual cookie override loaded from config");
  await refreshSession("bootstrapped");

  const targets = await buildMatrix(jar, fetchImpl, log);
  log(`target matrix built: ${targets.length} targets`);

  // §FR4/§FR5: exponential backoff applied when a whole cycle is blocked.
  const backoff = new Backoff({
    baseMs: config.backoff.baseSec * 1000,
    factor: config.backoff.factor,
    capMs: config.backoff.capSec * 1000,
  });

  // §FR2/§8.2 liveness: heartbeat / degraded alert / /status. The tracker is
  // updated as targets are polled; the getUpdates offset confirms seen updates.
  const liveness = deps.liveness ?? new LivenessTracker();
  const live = config.liveness;
  let updateOffset = 0;

  // Best-effort liveness send: log on success, swallow + log on failure so a
  // transient Telegram error never stops the poll loop. Returns whether it sent.
  const notify = async (
    text: string,
    okLog: string,
    errLabel: string,
  ): Promise<boolean> => {
    try {
      await sendTelegramMessage(config.telegram, text, fetchImpl);
      log(okLog);
      return true;
    } catch (err) {
      log(`${errLabel} failed: ${(err as Error).message}`);
      return false;
    }
  };

  // Service the on-demand /status command and the daily heartbeat. Runs every
  // cycle — including blocked ones — so the user can always query a degraded
  // monitor. All Telegram I/O is best-effort: a failure here never stops polling.
  const serviceLiveness = async (): Promise<void> => {
    if (live.statusCommand) {
      try {
        const updates = await fetchUpdates(config.telegram, updateOffset, fetchImpl);
        for (const u of updates) {
          updateOffset = Math.max(updateOffset, u.update_id + 1);
          const text = (u.message?.text ?? "").trim();
          if (text === "/status" || text.startsWith("/status@")) {
            await sendTelegramMessage(
              config.telegram,
              buildStatusText(liveness.snapshot(backoff.isBackedOff)),
              fetchImpl,
            );
            log("replied to /status");
          }
        }
      } catch (err) {
        log(`status poll failed: ${(err as Error).message}`);
      }
    }

    if (liveness.dueForHeartbeat(now(), live.heartbeatHour, sched.timezone)) {
      const sent = await notify(
        buildHeartbeatText(liveness.snapshot(backoff.isBackedOff), now()),
        "daily heartbeat sent",
        "heartbeat",
      );
      if (sent) liveness.markHeartbeatSent(now(), sched.timezone);
    }
  };

  while (shouldContinue()) {
    // Active-hours + weekday gating (§FR4): off-hours, sleep until it reopens.
    if (!isActiveHours(now(), sched)) {
      const ms = msUntilNextActiveWindow(now(), sched);
      log(`outside active hours — sleeping ${Math.round(ms / 1000)}s`);
      await sleep(ms);
      continue;
    }

    // Poll every target this cycle, staggered so they don't fire at once.
    let polled = 0;
    let failures = 0;
    for (let i = 0; i < targets.length; i++) {
      if (!shouldContinue()) break;
      if (i > 0) await sleep(computeStaggerMs(sched, rng));

      const target = targets[i];
      const label = targetLabel(target);
      const key = targetKey(target);
      polled++;
      try {
        const result = await pollAndNotify(
          target,
          config.telegram,
          jar,
          { fetchImpl, now, log },
          policy,
        );
        liveness.recordTargetResult(
          key,
          label,
          result.hit ? "hit" : "no-slot",
          now(),
        );
      } catch (err) {
        // Survive a single target's failure and continue (§FR7/resilience).
        failures++;
        liveness.recordTargetResult(key, label, "failed", now());
        log(`target ${label} failed: ${(err as Error).message}`);
      }
    }

    if (!shouldContinue()) break;

    // §8.2/§FR2: answer /status and send the daily heartbeat (every cycle, even
    // when blocked, so a degraded monitor can still be queried).
    await serviceLiveness();

    // §FR2: degraded-state bookkeeping — a fully-failed cycle counts toward the
    // threshold; alert once when it trips and once again on recovery.
    const allFailed = polled > 0 && failures === polled;
    const cycle = liveness.recordCycle(allFailed, live.degradedThreshold);
    if (cycle.degradedTripped) {
      await notify(
        buildDegradedText(liveness.snapshot(backoff.isBackedOff)),
        `degraded-state alert sent after ${live.degradedThreshold} failed cycles`,
        "degraded alert",
      );
    } else if (cycle.recovered) {
      await notify(
        buildRecoveredText(liveness.snapshot(backoff.isBackedOff)),
        "recovery alert sent",
        "recovery alert",
      );
    }

    // §FR4/§FR5: every target failing means the session is dead or we're
    // blocked — re-bootstrap and back off exponentially before resuming.
    if (allFailed) {
      const wait = backoff.next();
      log(
        `all ${polled} targets failed — session likely dead; backing off ${Math.round(
          wait / 1000,
        )}s and refreshing`,
      );
      try {
        await refreshSession("re-bootstrapped");
      } catch (err) {
        log(
          `re-bootstrap failed (will retry next cycle): ${(err as Error).message}`,
        );
      }
      await sleep(wait);
      continue;
    }

    // Healthy cycle — clear any prior backoff and resume the normal cadence.
    if (backoff.isBackedOff) {
      backoff.reset();
      log("session recovered — backoff reset");
    }

    // Inter-cycle jittered delay (§FR4): baseSec + uniform(0, jitterSec).
    const delay = computeCycleDelayMs(sched, rng);
    log(`cycle complete — sleeping ${Math.round(delay / 1000)}s`);
    await sleep(delay);
  }
}
