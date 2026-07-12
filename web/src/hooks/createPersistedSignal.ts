import { createSignal, type Accessor, type Setter } from 'solid-js';

// A createSignal that survives reloads via localStorage. For view preferences
// (sort orders, view modes, toggles) — not data. Keys live under
// `flexdeck.pref.*` so they're greppable and clearable as a family.
//
// Persistence happens synchronously in the setter (not an effect), so nothing
// is written until the user actually changes the preference — defaults never
// pollute storage. A `validate` guard is required so a stale or hand-edited
// stored value can never smuggle an out-of-domain state into the app.
export function createPersistedSignal<T>(
  key: string,
  initial: T,
  validate: (value: unknown) => value is T,
): [Accessor<T>, Setter<T>] {
  const storageKey = `flexdeck.pref.${key}`;

  const read = (): T => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw == null) return initial;
      const parsed: unknown = JSON.parse(raw);
      return validate(parsed) ? parsed : initial;
    } catch {
      return initial;
    }
  };

  const [value, setValue] = createSignal<T>(read());

  const setAndPersist = ((next?: unknown) => {
    const result = (setValue as (v: unknown) => T)(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(result));
    } catch {
      // Private mode / quota: the preference just doesn't persist.
    }
    return result;
  }) as Setter<T>;

  return [value, setAndPersist];
}

/** Guard builder for string-literal unions: `oneOf(['2d', '3d'])`. */
export function oneOf<T extends string>(values: readonly T[]): (value: unknown) => value is T {
  return (value): value is T => typeof value === 'string' && (values as readonly string[]).includes(value);
}
