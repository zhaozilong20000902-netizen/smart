export type LocalTextbook = {
  id: string;
  name: string;
  meta: string;
  size: number;
  type: string;
  addedAt: string;
  file: Blob;
};

const databaseName = "zhihe-textbook-library";
const storeName = "textbooks";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(databaseName, 1);
    request.onerror = () => reject(request.error || new Error("无法打开本机教材库"));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName)) {
        database.createObjectStore(storeName, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

export async function listLocalTextbooks(): Promise<LocalTextbook[]> {
  const database = await openDatabase();
  return new Promise<LocalTextbook[]>((resolve, reject) => {
    const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
    request.onerror = () => reject(request.error || new Error("无法读取本机教材库"));
    request.onsuccess = () => resolve(request.result as LocalTextbook[]);
  }).finally(() => database.close());
}

export async function saveLocalTextbook(textbook: LocalTextbook) {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const request = database.transaction(storeName, "readwrite").objectStore(storeName).put(textbook);
    request.onerror = () => reject(request.error || new Error("无法保存教材到本机浏览器"));
    request.onsuccess = () => resolve();
  }).finally(() => database.close());
}

export async function removeLocalTextbook(id: string) {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const request = database.transaction(storeName, "readwrite").objectStore(storeName).delete(id);
    request.onerror = () => reject(request.error || new Error("无法删除本机教材"));
    request.onsuccess = () => resolve();
  }).finally(() => database.close());
}
