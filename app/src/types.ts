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


export interface SavedVisit {
  at: string;
  source: 'search' | 'saved' | 'gps' | 'map' | 'legacy' | 'lookup' | string;
}

export interface SavedWellSelection {
  surfaceDls: string;
  uwi: string;
  licence: string;
  licensee: string;
  lat: number | null;
  lng: number | null;
  boreIndex: number;
}

export interface SavedLsdRecord {
  key: string;
  ats: string;
  lat: number;
  lng: number;
  geometry: { rings: number[][][] } | null;
  notes: string;
  notesUpdatedAt: string;
  favorite: boolean;
  tags: string[];
  hazards: string[];
  offlineAvailable: boolean;
  locationRecordVersion: number;
  selectedDisposal: number | null;
  selectedWell: SavedWellSelection | null;
  firstVisitedAt: string;
  lastVisitedAt: string;
  visitCount: number;
  visits: SavedVisit[];
  createdAt: string;
  updatedAt: string;
}

export interface SavedLocationStore {
  getAll(): Promise<SavedLsdRecord[]>;
  get(key: string): Promise<SavedLsdRecord | null>;
  put(record: SavedLsdRecord): Promise<SavedLsdRecord>;
  putMany(records: SavedLsdRecord[]): Promise<SavedLsdRecord[]>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  count(): Promise<number>;
}


export type UniversalSearchKind = 'legal' | 'saved' | 'well' | 'company' | 'facility' | 'recent';

export interface UniversalSearchResult {
  type: UniversalSearchKind;
  key: string;
  label: string;
  value: string;
  subtitle: string;
  score: number;
  payload?: Record<string, unknown> | null;
}

export interface FieldStatus {
  online: boolean;
  dataSource: 'aer-live' | 'st37-cache';
  gpsPermission: 'granted' | 'prompt' | 'denied' | 'unavailable' | 'unknown';
}
