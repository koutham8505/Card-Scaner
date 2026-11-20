const DATABASE_NAME = "eventconnect-offline";
const STORE_NAME = "pending-captures";
const DATABASE_VERSION = 1;
const MAX_QUEUED_CAPTURES = 100;
export const offlineCaptureEnabled = process.env.NEXT_PUBLIC_ENABLE_OFFLINE_CAPTURE === "true";

export type QueuedCapture = {
  captureId: string;
  eventCode: string;
  captureMethod: string;
  front: Blob;
  frontName: string;
  frontType: string;
  back?: Blob;
  backName?: string;
  backType?: string;
  queuedAt: string;
};

function openQueue(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "captureId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Offline storage could not be opened."));
    request.onblocked = () => reject(new Error("Offline storage is blocked by another browser tab."));
  });
}

async function transact<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openQueue();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    let result: T;
    request.onsuccess = () => {
      result = request.result;
    };
    request.onerror = () => reject(request.error ?? new Error("Offline storage operation failed."));
    transaction.oncomplete = () => {
      database.close();
      resolve(result);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Offline storage transaction failed."));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error("Offline storage transaction was aborted."));
    };
  });
}

export async function listQueuedCaptures(): Promise<QueuedCapture[]> {
  return transact("readonly", (store) => store.getAll());
}

export async function enqueueCapture(capture: QueuedCapture): Promise<void> {
  if (!offlineCaptureEnabled) {
    throw new Error("Offline capture is disabled by deployment policy.");
  }
  const queued = await listQueuedCaptures();
  if (!queued.some((item) => item.captureId === capture.captureId) && queued.length >= MAX_QUEUED_CAPTURES) {
    throw new Error(`Offline queue is full (${MAX_QUEUED_CAPTURES} captures). Sync it before adding more.`);
  }
  await transact("readwrite", (store) => store.put(capture));
}

export async function removeQueuedCapture(captureId: string): Promise<void> {
  await transact("readwrite", (store) => store.delete(captureId));
}
