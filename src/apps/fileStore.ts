export interface WorkspaceFile {
  id: string;
  name: string;
  type: string;
  size: number;
  addedAt: number;
  blob: Blob;
}

let databasePromise: Promise<IDBDatabase> | undefined;

function database(): Promise<IDBDatabase> {
  if (!databasePromise) {
    databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('File storage is unavailable.')); return; }
      const request = indexedDB.open('depth-workspace-files', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'id' });
      request.onsuccess = () => {
        const result = request.result;
        result.onversionchange = () => { result.close(); databasePromise = undefined; };
        resolve(result);
      };
      request.onerror = () => reject(request.error ?? new Error('Could not open file storage.'));
    request.onblocked = () => reject(new Error('Close other 3D Desktop windows to open file storage.'));
    }).catch((error) => { databasePromise = undefined; throw error; });
  }
  return databasePromise;
}

export async function loadFiles(): Promise<WorkspaceFile[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('files', 'readonly');
    const request = transaction.objectStore('files').getAll();
    request.onsuccess = () => resolve((request.result as WorkspaceFile[]).sort((a, b) => b.addedAt - a.addedAt));
    request.onerror = () => reject(request.error);
  });
}

export async function saveFiles(files: WorkspaceFile[]): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('files', 'readwrite');
    const store = transaction.objectStore('files');
    files.forEach((file) => store.put(file));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Files could not be saved.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('File storage is full or unavailable.'));
  });
}

export async function deleteFile(id: string): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('files', 'readwrite');
    transaction.objectStore('files').delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('File could not be removed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('File could not be removed.'));
  });
}
