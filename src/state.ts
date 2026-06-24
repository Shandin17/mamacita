import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// PRD §FR6 — per-target de-dup / cooldown state, kept in memory and optionally
// mirrored to a JSON file so it survives a restart.

export type AlertReason = "new" | "changed" | "cooldown" | "suppressed";
export type AlertDecision = { alert: boolean; reason: AlertReason };

type TargetState = {
  signature: string;
  lastAlertAt: string; // ISO
};

type PersistedState = {
  captured: boolean;
  targets: Record<string, TargetState>;
};

// Stable key for a target — its servicio/centro pair.
export function targetKey(target: { servicio: number; centro: number }): string {
  return `${target.servicio}/${target.centro}`;
}

export class MonitorState {
  private captured = false;
  private readonly targets = new Map<string, TargetState>();
  private readonly file?: string;

  constructor(file?: string) {
    this.file = file;
  }

  // Hydrate from the JSON file if it exists. Missing/corrupt files are treated
  // as a fresh start (resilience §7) rather than a fatal error.
  load(): this {
    if (!this.file || !existsSync(this.file)) return this;
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as PersistedState;
      this.captured = parsed.captured === true;
      for (const [key, value] of Object.entries(parsed.targets ?? {})) {
        if (value && typeof value.signature === "string") {
          this.targets.set(key, {
            signature: value.signature,
            lastAlertAt: value.lastAlertAt,
          });
        }
      }
    } catch {
      // Ignore an unreadable file and start clean.
    }
    return this;
  }

  private persist(): void {
    if (!this.file) return;
    const data: PersistedState = {
      captured: this.captured,
      targets: Object.fromEntries(this.targets),
    };
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(data, null, 2));
  }

  // PRD §FR6 — alert once per distinct signature; re-alert only after the
  // cooldown elapses or on disappear→reappear (handled via clear()).
  decide(
    key: string,
    signature: string,
    now: Date,
    cooldownMs: number,
  ): AlertDecision {
    const prev = this.targets.get(key);
    if (!prev) return { alert: true, reason: "new" };
    if (prev.signature !== signature) return { alert: true, reason: "changed" };
    const elapsed = now.getTime() - new Date(prev.lastAlertAt).getTime();
    if (elapsed >= cooldownMs) return { alert: true, reason: "cooldown" };
    return { alert: false, reason: "suppressed" };
  }

  // Record an alert that was actually sent, so future cycles de-dup against it.
  recordAlert(key: string, signature: string, now: Date): void {
    this.targets.set(key, { signature, lastAlertAt: now.toISOString() });
    this.persist();
  }

  // Forget a target when its availability vanishes, so a later reappearance of
  // the same signature alerts again (§FR6 disappear→reappear).
  clear(key: string): void {
    if (this.targets.delete(key)) this.persist();
  }

  hasCaptured(): boolean {
    return this.captured;
  }

  // PRD §FR6 / §8.4 capture-on-hit: mark that the first raw payload dump has
  // been taken, so we never re-dump.
  markCaptured(): void {
    if (this.captured) return;
    this.captured = true;
    this.persist();
  }
}
