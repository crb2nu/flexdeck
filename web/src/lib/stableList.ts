import { createMemo } from 'solid-js';

// Returns a memo whose output reuses the previous reference for any item whose
// JSON signature is unchanged, so SolidJS <For> can skip tearing down DOM on
// polling refreshes. Without this, new JSON.parse'd objects break hover and
// focus state mid-interaction.
export function stableListByKey<T>(
  source: () => readonly T[],
  getKey: (item: T) => string,
): () => T[] {
  const cache = new Map<string, { item: T; sig: string }>();
  return createMemo(() => {
    const items = source();
    const seen = new Set<string>();
    const result: T[] = [];
    for (const item of items) {
      const key = getKey(item);
      seen.add(key);
      const sig = JSON.stringify(item);
      const prev = cache.get(key);
      if (prev && prev.sig === sig) {
        result.push(prev.item);
      } else {
        cache.set(key, { item, sig });
        result.push(item);
      }
    }
    for (const key of [...cache.keys()]) {
      if (!seen.has(key)) cache.delete(key);
    }
    return result;
  });
}
