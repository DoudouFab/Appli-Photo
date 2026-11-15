import { CaptureSettings, LocalFolderRecord, QueuedPhoto, TargetFolder } from '../types';

const DB_NAME = 'chantiershot_db';
const DB_VERSION = 1;
const PHOTOS_STORE = 'photos';
const FOLDERS_STORE = 'local_folders';

const SETTINGS_KEY = 'chantiershot_settings_v1';
const RECENT_TARGETS_KEY = 'chantiershot_recent_targets_v1';
const ACTIVE_TARGET_KEY = 'chantiershot_active_target_v1';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PHOTOS_STORE)) {
        const photoStore = db.createObjectStore(PHOTOS_STORE, { keyPath: 'id' });
        photoStore.createIndex('capturedAt', 'capturedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(FOLDERS_STORE)) {
        const folderStore = db.createObjectStore(FOLDERS_STORE, { keyPath: 'id' });
        folderStore.createIndex('parentId', 'parentId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// --- Photos Queue in IndexedDB ---

export async function getAllPhotos(): Promise<QueuedPhoto[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTOS_STORE, 'readonly');
    const store = tx.objectStore(PHOTOS_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const list = (req.result as QueuedPhoto[]) || [];
      list.sort((a, b) => b.capturedAt - a.capturedAt);
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function savePhotoRecord(photo: QueuedPhoto): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTOS_STORE, 'readwrite');
    tx.objectStore(PHOTOS_STORE).put(photo);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deletePhotoRecord(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTOS_STORE, 'readwrite');
    tx.objectStore(PHOTOS_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearSyncedPhotos(): Promise<void> {
  const all = await getAllPhotos();
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTOS_STORE, 'readwrite');
    const store = tx.objectStore(PHOTOS_STORE);
    for (const item of all) {
      if (item.status === 'synced') {
        store.delete(item.id);
      }
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Local Offline Folders in IndexedDB ---

export async function seedDefaultLocalFoldersIfEmpty(): Promise<void> {
  const db = await openDB();
  const existing = await new Promise<LocalFolderRecord[]>((resolve, reject) => {
    const tx = db.transaction(FOLDERS_STORE, 'readonly');
    const req = tx.objectStore(FOLDERS_STORE).getAll();
    req.onsuccess = () => resolve((req.result as LocalFolderRecord[]) || []);
    req.onerror = () => reject(req.error);
  });

  if (existing.length > 0) return;

  const now = Date.now();
  const defaults: LocalFolderRecord[] = [
    { id: 'loc_chantier_1', parentId: 'root', name: 'Chantier Villa Belvédère', createdAt: now },
    { id: 'loc_sub_1_1', parentId: 'loc_chantier_1', name: '01 - Gros Oeuvre', createdAt: now + 1 },
    { id: 'loc_sub_1_2', parentId: 'loc_chantier_1', name: '02 - Électricité', createdAt: now + 2 },
    { id: 'loc_subsub_1_2_1', parentId: 'loc_sub_1_2', name: 'Tableau RDC', createdAt: now + 3 },
    { id: 'loc_subsub_1_2_2', parentId: 'loc_sub_1_2', name: 'Gaines Étage', createdAt: now + 4 },
    { id: 'loc_chantier_2', parentId: 'root', name: 'Chantier Résidence Parc', createdAt: now + 5 },
    { id: 'loc_sub_2_1', parentId: 'loc_chantier_2', name: 'Plomberie', createdAt: now + 6 },
    { id: 'loc_sub_2_2', parentId: 'loc_chantier_2', name: 'Réserves & Finitions', createdAt: now + 7 },
  ];

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FOLDERS_STORE, 'readwrite');
    const store = tx.objectStore(FOLDERS_STORE);
    for (const f of defaults) store.put(f);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getLocalFoldersByParent(parentId: string): Promise<LocalFolderRecord[]> {
  await seedDefaultLocalFoldersIfEmpty();
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FOLDERS_STORE, 'readonly');
    const index = tx.objectStore(FOLDERS_STORE).index('parentId');
    const req = index.getAll(parentId);
    req.onsuccess = () => {
      const list = (req.result as LocalFolderRecord[]) || [];
      list.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getAllLocalFolders(): Promise<LocalFolderRecord[]> {
  await seedDefaultLocalFoldersIfEmpty();
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FOLDERS_STORE, 'readonly');
    const req = tx.objectStore(FOLDERS_STORE).getAll();
    req.onsuccess = () => resolve((req.result as LocalFolderRecord[]) || []);
    req.onerror = () => reject(req.error);
  });
}

export async function createLocalFolder(parentId: string, name: string): Promise<LocalFolderRecord> {
  const db = await openDB();
  const record: LocalFolderRecord = {
    id: `loc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    parentId,
    name: name.trim(),
    createdAt: Date.now(),
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FOLDERS_STORE, 'readwrite');
    tx.objectStore(FOLDERS_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return record;
}

// --- Settings & Recent Targets (localStorage) ---

const DEFAULT_SETTINGS: CaptureSettings = {
  prefix: '',
  burnStamp: true,
  autoPurgeAfterSync: true,
  jpegQuality: 0.9,
};

export function loadCaptureSettings(): CaptureSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveCaptureSettings(settings: CaptureSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadActiveTarget(): TargetFolder | null {
  try {
    const raw = localStorage.getItem(ACTIVE_TARGET_KEY);
    return raw ? (JSON.parse(raw) as TargetFolder) : null;
  } catch {
    return null;
  }
}

export function saveActiveTarget(target: TargetFolder | null): void {
  if (!target) {
    localStorage.removeItem(ACTIVE_TARGET_KEY);
    return;
  }
  localStorage.setItem(ACTIVE_TARGET_KEY, JSON.stringify(target));

  // Update recent targets list (max 5)
  const recents = loadRecentTargets().filter(
    (item) => !(item.id === target.id && item.source === target.source)
  );
  recents.unshift(target);
  localStorage.setItem(RECENT_TARGETS_KEY, JSON.stringify(recents.slice(0, 5)));
}

export function loadRecentTargets(): TargetFolder[] {
  try {
    const raw = localStorage.getItem(RECENT_TARGETS_KEY);
    return raw ? (JSON.parse(raw) as TargetFolder[]) : [];
  } catch {
    return [];
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export function buildPhotoFilename(prefix: string, sequence: number): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const datePart = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const timePart = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const seqPart = String(sequence).padStart(2, '0');
  const cleanPrefix = prefix
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return cleanPrefix
    ? `${datePart}_${timePart}_${cleanPrefix}_${seqPart}.jpg`
    : `${datePart}_${timePart}_${seqPart}.jpg`;
}
