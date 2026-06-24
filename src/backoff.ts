// PRD §FR4 — exponential backoff with a cap. On error/block/non-JSON the loop
// backs off (≈2× each time, up to ~15 min) before refreshing the session and
// resuming; a healthy cycle resets it back to the base.
export type BackoffOptions = {
  baseMs: number; // first/backed-off-from delay
  factor: number; // multiplier applied after each step (≈2)
  capMs: number; // hard ceiling on the delay (~15 min)
};

export class Backoff {
  private readonly opts: BackoffOptions;
  private current: number;

  constructor(opts: BackoffOptions) {
    this.opts = opts;
    this.current = opts.baseMs;
  }

  // Return the delay to wait now, then advance toward the cap for next time.
  next(): number {
    const delay = this.current;
    this.current = Math.min(this.current * this.opts.factor, this.opts.capMs);
    return delay;
  }

  // Back to square one after a healthy cycle.
  reset(): void {
    this.current = this.opts.baseMs;
  }

  // True once we've stepped past the base delay — i.e. we're degraded.
  get isBackedOff(): boolean {
    return this.current > this.opts.baseMs;
  }
}
