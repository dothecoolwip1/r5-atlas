import type { JsonProvider } from '../types';

export class FetchJsonProvider implements JsonProvider {
  async get<T>(url: string, timeoutMs = 18_000): Promise<T> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as T & { error?: { message?: string } };
      if (data?.error) throw new Error(data.error.message || 'Service error');
      return data;
    } finally {
      window.clearTimeout(timeout);
    }
  }
}
