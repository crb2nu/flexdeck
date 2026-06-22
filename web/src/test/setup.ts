const createMemoryStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, String(value));
    },
  };
};

const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const hasLocalStorage =
  localStorageDescriptor !== undefined &&
  'value' in localStorageDescriptor &&
  localStorageDescriptor.value !== undefined;

if (!hasLocalStorage) {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: createMemoryStorage(),
    writable: true,
  });
}
