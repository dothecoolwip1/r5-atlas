import type { SavedLocationStore, SavedLsdRecord } from '../types';

const DB_NAME = 'r5-atlas-device';
const DB_VERSION = 1;
const STORE = 'savedLocations';

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
  });
}

export class IndexedDbSavedLocationStore implements SavedLocationStore {
  private databasePromise: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;

    this.databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        const transaction = request.transaction;
        let store: IDBObjectStore;

        if (!database.objectStoreNames.contains(STORE)) {
          store = database.createObjectStore(STORE, { keyPath: 'key' });
        } else if (transaction) {
          store = transaction.objectStore(STORE);
        } else {
          throw new Error('IndexedDB upgrade transaction is unavailable.');
        }

        if (!store.indexNames.contains('favorite')) {
          store.createIndex('favorite', 'favorite', { unique: false });
        }
        if (!store.indexNames.contains('lastVisitedAt')) {
          store.createIndex('lastVisitedAt', 'lastVisitedAt', { unique: false });
        }
        if (!store.indexNames.contains('visitCount')) {
          store.createIndex('visitCount', 'visitCount', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.databasePromise = null;
        reject(request.error ?? new Error('Could not open the R5 Atlas device database.'));
      };
      request.onblocked = () => {
        this.databasePromise = null;
        reject(new Error('The R5 Atlas device database is blocked by another tab.'));
      };
    });

    return this.databasePromise;
  }

  async getAll(): Promise<SavedLsdRecord[]> {
    const database = await this.open();
    const transaction = database.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).getAll() as IDBRequest<SavedLsdRecord[]>;
    const records = await requestResult(request);
    await transactionDone(transaction);
    return records;
  }

  async get(key: string): Promise<SavedLsdRecord | null> {
    const database = await this.open();
    const transaction = database.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).get(key) as IDBRequest<SavedLsdRecord | undefined>;
    const record = await requestResult(request);
    await transactionDone(transaction);
    return record ?? null;
  }

  async put(record: SavedLsdRecord): Promise<SavedLsdRecord> {
    const database = await this.open();
    const transaction = database.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(record);
    await transactionDone(transaction);
    return record;
  }

  async putMany(records: SavedLsdRecord[]): Promise<SavedLsdRecord[]> {
    if (!records.length) return [];
    const database = await this.open();
    const transaction = database.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    records.forEach(record => store.put(record));
    await transactionDone(transaction);
    return records;
  }

  async delete(key: string): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).delete(key);
    await transactionDone(transaction);
  }

  async clear(): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).clear();
    await transactionDone(transaction);
  }

  async count(): Promise<number> {
    const database = await this.open();
    const transaction = database.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).count();
    const count = await requestResult(request);
    await transactionDone(transaction);
    return count;
  }
}
