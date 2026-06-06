import { createMemo } from 'solid-js';

// Returns a memo whose output reuses the previous reference for any item whose
// signature is unchanged, so SolidJS <For> can skip tearing down DOM on
// polling refreshes. Without this, new JSON.parse'd objects break hover and
// focus state mid-interaction.
//
// By default the signature is the full JSON of the item. Pass `getSignature`
// to base reuse on STRUCTURAL fields only (phase, status, identity) and exclude
// high-frequency metric noise — otherwise a row whose object embeds live
// per-poll metrics gets a fresh signature every poll, defeating reuse and
// recreating the DOM on every tick (visible flicker). Cells that must stay live
// should read their volatile values from a reactive signal inside the row.
export function stableListByKey<T>(
  source: () => readonly T[],
  getKey: (item: T) => string,
  getSignature: (item: T) => string = (item) => JSON.stringify(item),
): () => T[] {
  const cache = new Map<string, { item: T; sig: string }>();
  return createMemo(() => {
    const items = source();
    const seen = new Set<string>();
    const result: T[] = [];
    for (const item of items) {
      const key = getKey(item);
      seen.add(key);
      const sig = getSignature(item);
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
