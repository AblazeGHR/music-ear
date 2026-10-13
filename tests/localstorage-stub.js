// A minimal in-memory localStorage so state.js can run under Node. Import this
// before importing state.js (ESM import order guarantees the stub is in place).

const store = new Map();

globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
  get length() { return store.size; },
  key: i => [...store.keys()][i] ?? null,
};

export const __store = () => store;
