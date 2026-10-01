/**
 * Speicher im Browser (IndexedDB): Mediendateien als Blobs, Projekte als JSON.
 * Videos bleiben auf dem Gerät – es wird nichts hochgeladen.
 */
import type { MediaAsset, Project } from './types';

const DB_NAME = 'vysn-video';
const VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  }));
}

export const db = {
  listProjects: () => run<Project[]>('projects', 'readonly', (s) => s.getAll())
    .then((list) => list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))),
  getProject: (id: string) => run<Project | undefined>('projects', 'readonly', (s) => s.get(id)),
  saveProject: (p: Project) => run('projects', 'readwrite', (s) => s.put(p)),
  deleteProject: (id: string) => run('projects', 'readwrite', (s) => s.delete(id)),

  listAssets: () => run<MediaAsset[]>('assets', 'readonly', (s) => s.getAll()),
  getAsset: (id: string) => run<MediaAsset | undefined>('assets', 'readonly', (s) => s.get(id)),
  saveAsset: (a: MediaAsset, blob?: Blob) => Promise.all([
    run('assets', 'readwrite', (s) => s.put(a)),
    blob ? run('blobs', 'readwrite', (s) => s.put(blob, a.id)) : Promise.resolve(),
  ]),
  getBlob: (id: string) => run<Blob | undefined>('blobs', 'readonly', (s) => s.get(id)),
  deleteAsset: (id: string) => Promise.all([
    run('assets', 'readwrite', (s) => s.delete(id)),
    run('blobs', 'readwrite', (s) => s.delete(id)),
  ]),
};

/** Object-URLs je Asset nur einmal erzeugen. */
const urls = new Map<string, string>();
export async function assetUrl(id: string): Promise<string | null> {
  const cached = urls.get(id);
  if (cached) return cached;
  const blob = await db.getBlob(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urls.set(id, url);
  return url;
}
export function registerUrl(id: string, blob: Blob) {
  if (!urls.has(id)) urls.set(id, URL.createObjectURL(blob));
  return urls.get(id)!;
}

/** Löscht Medien, die von keinem Projekt mehr benutzt werden. */
export async function collectGarbage() {
  const [projects, assets] = await Promise.all([db.listProjects(), db.listAssets()]);
  const used = new Set<string>();
  for (const p of projects) {
    p.clips.forEach((c) => used.add(c.assetId));
    if (p.music) used.add(p.music.assetId);
    (p.library || []).forEach((id) => used.add(id));
  }
  await Promise.all(assets.filter((a) => !used.has(a.id)).map((a) => db.deleteAsset(a.id)));
}
