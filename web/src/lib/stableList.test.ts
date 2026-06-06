import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { stableListByKey } from './stableList';

interface Row {
  id: string;
  phase: string;
  queue: number; // volatile metric — must not force a new ref
}

describe('stableListByKey', () => {
  it('reuses the previous reference when the full JSON signature is unchanged', () => {
    createRoot((dispose) => {
      const [src, setSrc] = createSignal<Row[]>([{ id: 'a', phase: 'Ready', queue: 0 }]);
      const stable = stableListByKey(src, (r) => r.id);
      const first = stable()[0];
      setSrc([{ id: 'a', phase: 'Ready', queue: 0 }]); // new object, identical content
      expect(stable()[0]).toBe(first); // same reference reused
      dispose();
    });
  });

  it('replaces the reference when any field changes (default signature)', () => {
    createRoot((dispose) => {
      const [src, setSrc] = createSignal<Row[]>([{ id: 'a', phase: 'Ready', queue: 0 }]);
      const stable = stableListByKey(src, (r) => r.id);
      const first = stable()[0];
      setSrc([{ id: 'a', phase: 'Ready', queue: 7 }]); // only volatile metric changed
      expect(stable()[0]).not.toBe(first); // default signature includes everything
      dispose();
    });
  });

  it('with a structural signature, reuses the ref when only excluded metrics change', () => {
    createRoot((dispose) => {
      const [src, setSrc] = createSignal<Row[]>([{ id: 'a', phase: 'Ready', queue: 0 }]);
      const stable = stableListByKey(src, (r) => r.id, (r) => `${r.id}|${r.phase}`);
      const first = stable()[0];
      // queue jitters every poll, phase stable -> ref must persist (no flicker).
      setSrc([{ id: 'a', phase: 'Ready', queue: 42 }]);
      expect(stable()[0]).toBe(first);
      setSrc([{ id: 'a', phase: 'Ready', queue: 99 }]);
      expect(stable()[0]).toBe(first);
      dispose();
    });
  });

  it('with a structural signature, replaces the ref when a structural field changes', () => {
    createRoot((dispose) => {
      const [src, setSrc] = createSignal<Row[]>([{ id: 'a', phase: 'Ready', queue: 0 }]);
      const stable = stableListByKey(src, (r) => r.id, (r) => `${r.id}|${r.phase}`);
      const first = stable()[0];
      setSrc([{ id: 'a', phase: 'Failed', queue: 0 }]); // phase changed
      expect(stable()[0]).not.toBe(first);
      dispose();
    });
  });

  it('preserves source order and drops removed keys from the cache', () => {
    createRoot((dispose) => {
      const [src, setSrc] = createSignal<Row[]>([
        { id: 'a', phase: 'Ready', queue: 0 },
        { id: 'b', phase: 'Ready', queue: 0 },
      ]);
      const stable = stableListByKey(src, (r) => r.id, (r) => `${r.id}|${r.phase}`);
      const aRef = stable().find((r) => r.id === 'a')!;
      // Reorder + drop 'b'; 'a' must keep its ref, order follows the source.
      setSrc([{ id: 'a', phase: 'Ready', queue: 5 }]);
      expect(stable().map((r) => r.id)).toEqual(['a']);
      expect(stable()[0]).toBe(aRef);
      dispose();
    });
  });
});
