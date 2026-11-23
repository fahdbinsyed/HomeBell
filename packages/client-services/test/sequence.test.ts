import { describe, expect, it } from 'vitest';
import { SequenceTracker } from '../src/sequence';

describe('SequenceTracker (realtime catch-up semantics)', () => {
  it('needs a snapshot before applying events', () => {
    expect(new SequenceTracker().decide(1)).toBe('gap');
  });
  it('applies in-order events and ignores duplicates', () => {
    const t = new SequenceTracker(10);
    expect(t.decide(11)).toBe('apply');
    t.applied(11);
    expect(t.decide(11)).toBe('duplicate');
    expect(t.decide(5)).toBe('duplicate');
  });
  it('detects gaps that require HTTP catch-up', () => {
    const t = new SequenceTracker(10);
    expect(t.decide(13)).toBe('gap');
    t.applied(11);
    t.applied(12);
    expect(t.decide(13)).toBe('apply');
  });
  it('resets after a snapshot reload or queue.reset', () => {
    const t = new SequenceTracker(40);
    t.reset(3);
    expect(t.lastSeq).toBe(3);
    expect(t.decide(4)).toBe('apply');
  });
});
