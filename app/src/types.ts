export type LegalLandKind = 'lsd' | 'quarter';

export interface LegalLandPoint {
  status: 'ok';
  kind: LegalLandKind;
  normalized: string;
  latitude: number;
  longitude: number;
  coordinateSource: string;
  estimated: false;
}

export interface LegalLandFailure {
  status: string;
  message: string;
  estimated?: false;
}

export type LegalLandResult = LegalLandPoint | LegalLandFailure;

export interface JsonProvider {
  get<T>(url: string, timeoutMs?: number): Promise<T>;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
