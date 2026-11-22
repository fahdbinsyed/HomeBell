export type SequenceDecision = 'apply' | 'duplicate' | 'gap';

/**
 * Tracks the last applied `seq` for one (tenantId, queueDate) stream and implements the
 * catch-up semantics in realtime.asyncapi.yaml:
 * - seq <= last  → duplicate (ignore)
 * - seq == last+1 → apply
 * - seq >  last+1 → gap (call the catch-up endpoint, then reset)
 */
export class SequenceTracker {
  private last: number | null;

  constructor(initialSeq: number | null = null) {
    this.last = initialSeq;
  }

  get lastSeq(): number | null {
    return this.last;
  }

  decide(seq: number): SequenceDecision {
    if (this.last === null) return 'gap';
    if (seq <= this.last) return 'duplicate';
    if (seq === this.last + 1) return 'apply';
    return 'gap';
  }

  /** Record that `seq` was applied (after `decide` returned 'apply' or after catch-up). */
  applied(seq: number): void {
    if (this.last === null || seq > this.last) this.last = seq;
  }

  /** After loading a snapshot or a queue.reset. */
  reset(seq: number | null): void {
    this.last = seq;
  }
}
