export const storage = {
  get<T>(key: string): T | null {
    const value = window.localStorage.getItem(key);
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown) {
    window.localStorage.setItem(key, JSON.stringify(value));
  },
  remove(key: string) {
    window.localStorage.removeItem(key);
  },
};
