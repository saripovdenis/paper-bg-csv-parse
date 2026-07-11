import type { ResearchRunLog, ResearchState } from './types';

const DATABASE_NAME = 'paper-bg-csv-research-v2';
const DATABASE_VERSION = 1;
const STATE_STORE = 'state';
const LOG_STORE = 'logs';
const STATE_KEY = 'current';
const PROBE_KEY = '__persistence_probe__';

let databasePromise: Promise<IDBDatabase | null> | null = null;
let memoryState: ResearchState | null = null;
const memoryLogs = new Map<string, ResearchRunLog>();

function clone<T>(value: T): T {
  return structuredClone(value);
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed'));
  });
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (databasePromise) return databasePromise;
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);

  databasePromise = new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    } catch {
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STATE_STORE)) {
        database.createObjectStore(STATE_STORE);
      }
      if (!database.objectStoreNames.contains(LOG_STORE)) {
        const logs = database.createObjectStore(LOG_STORE, { keyPath: 'id' });
        logs.createIndex('taskId', 'task.id', { unique: false });
        logs.createIndex('fileId', 'task.file.id', { unique: false });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return databasePromise;
}

export async function loadResearchState(): Promise<ResearchState | null> {
  const database = await openDatabase();
  if (!database) return memoryState ? clone(memoryState) : null;

  const transaction = database.transaction(STATE_STORE, 'readonly');
  const result = await requestResult(
    transaction.objectStore(STATE_STORE).get(STATE_KEY),
  );
  return result ? (result as ResearchState) : null;
}

export async function saveResearchState(state: ResearchState): Promise<void> {
  const database = await openDatabase();
  if (!database) {
    memoryState = clone(state);
    return;
  }

  const transaction = database.transaction(STATE_STORE, 'readwrite');
  const done = transactionDone(transaction);
  transaction.objectStore(STATE_STORE).put(state, STATE_KEY);
  await done;
}

export async function loadResearchLogs(): Promise<ResearchRunLog[]> {
  const database = await openDatabase();
  if (!database) return [...memoryLogs.values()].map(clone);

  const transaction = database.transaction(LOG_STORE, 'readonly');
  const result = await requestResult(
    transaction.objectStore(LOG_STORE).getAll(),
  );
  return result as ResearchRunLog[];
}

export async function saveResearchLog(log: ResearchRunLog): Promise<void> {
  const database = await openDatabase();
  if (!database) {
    memoryLogs.set(log.id, clone(log));
    return;
  }

  const transaction = database.transaction(LOG_STORE, 'readwrite');
  const done = transactionDone(transaction);
  transaction.objectStore(LOG_STORE).put(log);
  await done;
}

export async function commitMeasuredLogAndState(
  log: ResearchRunLog,
  state: ResearchState,
): Promise<void> {
  const database = await openDatabase();
  if (!database) {
    memoryLogs.set(log.id, clone(log));
    memoryState = clone(state);
    return;
  }

  const transaction = database.transaction(
    [LOG_STORE, STATE_STORE],
    'readwrite',
  );
  const done = transactionDone(transaction);
  const stateStore = transaction.objectStore(STATE_STORE);
  const persistedState = (await requestResult(stateStore.get(STATE_KEY))) as
    | ResearchState
    | undefined;
  const cursorMatches =
    persistedState?.status === 'running' &&
    persistedState.sessionId === log.sessionId &&
    persistedState.phase === 'measured' &&
    persistedState.taskIndex === log.task.taskIndex &&
    persistedState.runIndex === log.runIndex;

  if (!cursorMatches) {
    transaction.abort();
    await done.catch(() => undefined);
    throw new Error('Research cursor changed before the run was saved');
  }

  transaction.objectStore(LOG_STORE).put(log);
  stateStore.put(state, STATE_KEY);
  await done;
}

export async function clearResearchState(): Promise<void> {
  const database = await openDatabase();
  if (!database) {
    memoryState = null;
    return;
  }

  const transaction = database.transaction(STATE_STORE, 'readwrite');
  const done = transactionDone(transaction);
  transaction.objectStore(STATE_STORE).delete(STATE_KEY);
  await done;
}

export async function clearResearchLogs(): Promise<void> {
  const database = await openDatabase();
  if (!database) {
    memoryLogs.clear();
    return;
  }

  const transaction = database.transaction(LOG_STORE, 'readwrite');
  const done = transactionDone(transaction);
  transaction.objectStore(LOG_STORE).clear();
  await done;
}

export async function clearResearchData(): Promise<void> {
  const database = await openDatabase();
  if (!database) {
    memoryState = null;
    memoryLogs.clear();
    return;
  }

  const transaction = database.transaction(
    [STATE_STORE, LOG_STORE],
    'readwrite',
  );
  const done = transactionDone(transaction);
  transaction.objectStore(STATE_STORE).clear();
  transaction.objectStore(LOG_STORE).clear();
  await done;
}

export async function probeResearchPersistence(): Promise<boolean> {
  const database = await openDatabase();
  if (!database) return false;

  try {
    const transaction = database.transaction(STATE_STORE, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STATE_STORE);
    store.put(true, PROBE_KEY);
    const persisted = await requestResult(store.get(PROBE_KEY));
    store.delete(PROBE_KEY);
    await done;
    return persisted === true;
  } catch {
    return false;
  }
}
