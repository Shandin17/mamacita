import type { ScheduleConfig } from "./types.ts";

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

// Project a UTC instant into wall-clock parts in the given IANA timezone.
// Used so active-hours gating tracks Europe/Madrid (incl. DST) without deps.
export function zonedParts(
  date: Date,
  timezone: string,
): { weekday: number; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return {
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

// Calendar day (YYYY-MM-DD) of an instant in the given timezone. Used to fire
// the daily heartbeat at most once per local day (§FR2).
export function zonedDayKey(date: Date, timezone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

// PRD §FR4: poll only on active weekdays within [activeStartHour, activeEndHour).
export function isActiveHours(now: Date, cfg: ScheduleConfig): boolean {
  const { weekday, hour, minute } = zonedParts(now, cfg.timezone);
  if (!cfg.activeDays.includes(weekday)) return false;
  const minutesNow = hour * 60 + minute;
  return (
    minutesNow >= cfg.activeStartHour * 60 &&
    minutesNow < cfg.activeEndHour * 60
  );
}

// PRD §FR4: inter-cycle delay = baseSec + uniform(0, jitterSec), in ms.
export function computeCycleDelayMs(
  cfg: ScheduleConfig,
  rng: () => number = Math.random,
): number {
  return Math.round((cfg.baseSec + rng() * cfg.jitterSec) * 1000);
}

// PRD §FR4: per-request stagger = uniform(staggerMinSec, staggerMaxSec), in ms.
export function computeStaggerMs(
  cfg: ScheduleConfig,
  rng: () => number = Math.random,
): number {
  const span = Math.max(0, cfg.staggerMaxSec - cfg.staggerMinSec);
  return Math.round((cfg.staggerMinSec + rng() * span) * 1000);
}

// Approximate ms until the active window next opens. Day-granular and DST-naive
// on purpose: the loop re-checks isActiveHours() after sleeping, so a small
// under/overshoot self-corrects rather than causing a missed window.
export function msUntilNextActiveWindow(
  now: Date,
  cfg: ScheduleConfig,
): number {
  const { weekday, hour, minute } = zonedParts(now, cfg.timezone);
  const minutesNow = hour * 60 + minute;
  const startMin = cfg.activeStartHour * 60;

  // Active day, but the window hasn't opened yet today → wait until it opens.
  if (cfg.activeDays.includes(weekday) && minutesNow < startMin) {
    return (startMin - minutesNow) * 60_000;
  }

  // Otherwise advance to the start of the next active day.
  let daysAhead = 1;
  let wd = (weekday + 1) % 7;
  while (!cfg.activeDays.includes(wd) && daysAhead < 8) {
    daysAhead++;
    wd = (wd + 1) % 7;
  }
  const minutesUntilMidnight = 24 * 60 - minutesNow;
  const minutesToTarget =
    minutesUntilMidnight + (daysAhead - 1) * 24 * 60 + startMin;
  return minutesToTarget * 60_000;
}
