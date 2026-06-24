import { zonedDayKey, zonedParts } from "./schedule.ts";

// PRD §FR2/§8.2 — liveness signals. The tracker is pure bookkeeping over the
// poll loop; the loop owns the Telegram I/O (heartbeat, degraded alert,
// /status reply). The text builders below format each signal's message.

export type TargetResult = "hit" | "no-slot" | "failed";

export type TargetStatus = {
  label: string;
  result: TargetResult;
  at: string; // ISO of the last result for this target
};

export type StatusSnapshot = {
  lastPollAt: string | null; // ISO of the most recent poll (any target)
  targets: TargetStatus[];
  backedOff: boolean; // current backoff state (§FR5)
  consecutiveFailedCycles: number;
  degraded: boolean;
};

// What recordCycle reports back so the loop can fire one-shot alerts.
export type CycleOutcome = { degradedTripped: boolean; recovered: boolean };

export class LivenessTracker {
  private lastPollAt: Date | null = null;
  private readonly targets = new Map<string, TargetStatus>();
  private consecutiveFailedCycles = 0;
  private degraded = false;
  private lastHeartbeatDay: string | null = null;

  // Record one target's poll outcome (drives /status + heartbeat snapshots).
  recordTargetResult(
    key: string,
    label: string,
    result: TargetResult,
    now: Date,
  ): void {
    this.lastPollAt = now;
    this.targets.set(key, { label, result, at: now.toISOString() });
  }

  // PRD §FR2 — end-of-cycle bookkeeping. A fully-failed cycle counts toward the
  // degraded threshold; the alert trips exactly once when the count first
  // reaches N, and clears on the next healthy cycle (reported via `recovered`).
  recordCycle(allFailed: boolean, threshold: number): CycleOutcome {
    if (allFailed) {
      this.consecutiveFailedCycles++;
      if (!this.degraded && this.consecutiveFailedCycles >= threshold) {
        this.degraded = true;
        return { degradedTripped: true, recovered: false };
      }
      return { degradedTripped: false, recovered: false };
    }
    const recovered = this.degraded;
    this.consecutiveFailedCycles = 0;
    this.degraded = false;
    return { degradedTripped: false, recovered };
  }

  // PRD §FR2 — true at most once per local day, once the heartbeat hour has
  // passed. heartbeatHour < 0 disables the heartbeat entirely.
  dueForHeartbeat(now: Date, heartbeatHour: number, timezone: string): boolean {
    if (heartbeatHour < 0) return false;
    const { hour } = zonedParts(now, timezone);
    if (hour < heartbeatHour) return false;
    return this.lastHeartbeatDay !== zonedDayKey(now, timezone);
  }

  markHeartbeatSent(now: Date, timezone: string): void {
    this.lastHeartbeatDay = zonedDayKey(now, timezone);
  }

  snapshot(backedOff: boolean): StatusSnapshot {
    return {
      lastPollAt: this.lastPollAt ? this.lastPollAt.toISOString() : null,
      targets: [...this.targets.values()],
      backedOff,
      consecutiveFailedCycles: this.consecutiveFailedCycles,
      degraded: this.degraded,
    };
  }
}

const RESULT_ICON: Record<TargetResult, string> = {
  hit: "🟢",
  "no-slot": "⚪",
  failed: "🔴",
};

function targetLines(snap: StatusSnapshot): string[] {
  if (snap.targets.length === 0) return ["(sin sondeos todavía)"];
  return snap.targets.map(
    (t) => `${RESULT_ICON[t.result]} ${t.label}: ${t.result} (${t.at})`,
  );
}

// PRD §8.2 — /status reply: last poll time, per-target last result, backoff.
export function buildStatusText(snap: StatusSnapshot): string {
  return [
    "📋 Estado del monitor — Padrón Valencia",
    `Última consulta: ${snap.lastPollAt ?? "nunca"}`,
    `Backoff: ${snap.backedOff ? "activo (degradado)" : "inactivo"}`,
    `Ciclos fallidos consecutivos: ${snap.consecutiveFailedCycles}`,
    "",
    "Por objetivo:",
    ...targetLines(snap),
  ].join("\n");
}

// PRD §FR2 — daily "still alive" heartbeat.
export function buildHeartbeatText(snap: StatusSnapshot, now: Date): string {
  return [
    "💓 Monitor activo — Padrón Valencia",
    `Hora: ${now.toISOString()}`,
    `Última consulta: ${snap.lastPollAt ?? "nunca"}`,
    `Backoff: ${snap.backedOff ? "activo" : "inactivo"}`,
    "",
    "Por objetivo:",
    ...targetLines(snap),
  ].join("\n");
}

// PRD §FR2 — degraded-state alert after N consecutive fully-failed cycles.
export function buildDegradedText(snap: StatusSnapshot): string {
  return [
    "⚠️ Monitor degradado — Padrón Valencia",
    `${snap.consecutiveFailedCycles} ciclos consecutivos han fallado (sesión muerta o bloqueado).`,
    `Última consulta: ${snap.lastPollAt ?? "nunca"}`,
    "Reintentando con backoff y re-bootstrap de sesión.",
  ].join("\n");
}

// PRD §FR2 — sent once when a degraded monitor recovers.
export function buildRecoveredText(snap: StatusSnapshot): string {
  return [
    "✅ Monitor recuperado — Padrón Valencia",
    `Sesión restablecida. Última consulta: ${snap.lastPollAt ?? "nunca"}`,
  ].join("\n");
}
