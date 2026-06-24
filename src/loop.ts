import { captureToDir } from "./capture.ts";
import { CookieJar } from "./cookies.ts";
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
import { MonitorState } from "./state.ts";
import { buildTargetMatrix } from "./targets.ts";
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

  // Session bootstrap (§7/FR5) + full target matrix (§3.4 + §3.1), once.
  const jar = new CookieJar();
  await bootstrapSession(jar, fetchImpl);
  log(`session bootstrapped (cookies: ${jar.isEmpty() ? "none" : "ok"})`);

  const targets = await buildMatrix(jar, fetchImpl, log);
  log(`target matrix built: ${targets.length} targets`);

  while (shouldContinue()) {
    // Active-hours + weekday gating (§FR4): off-hours, sleep until it reopens.
    if (!isActiveHours(now(), sched)) {
      const ms = msUntilNextActiveWindow(now(), sched);
      log(`outside active hours — sleeping ${Math.round(ms / 1000)}s`);
      await sleep(ms);
      continue;
    }

    // Poll every target this cycle, staggered so they don't fire at once.
    for (let i = 0; i < targets.length; i++) {
      if (!shouldContinue()) break;
      if (i > 0) await sleep(computeStaggerMs(sched, rng));

      const target = targets[i];
      const label = targetLabel(target);
      try {
        await pollAndNotify(
          target,
          config.telegram,
          jar,
          { fetchImpl, now, log },
          policy,
        );
      } catch (err) {
        // Survive a single target's failure and continue (§FR7/resilience).
        log(`target ${label} failed: ${(err as Error).message}`);
      }
    }

    if (!shouldContinue()) break;

    // Inter-cycle jittered delay (§FR4): baseSec + uniform(0, jitterSec).
    const delay = computeCycleDelayMs(sched, rng);
    log(`cycle complete — sleeping ${Math.round(delay / 1000)}s`);
    await sleep(delay);
  }
}
