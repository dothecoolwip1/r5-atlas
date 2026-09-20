import type { KeyValueStorage } from '../types';

export class BrowserStorage implements KeyValueStorage {
  constructor(private readonly storage: Storage = window.localStorage) {}

  getItem(key: string): string | null {
    return this.storage.getItem(key);
  }

  setItem(key: string, value: string): void {
    this.storage.setItem(key, value);
  }

  removeItem(key: string): void {
    this.storage.removeItem(key);
  }

  getJson<T>(key: string, fallback: T): T {
    const value = this.getItem(key);
    if (value === null) return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  setJson<T>(key: string, value: T): void {
    this.setItem(key, JSON.stringify(value));
  }
}
