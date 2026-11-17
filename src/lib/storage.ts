import JSZip from 'jszip';
import {
  CaptureSettings,
  LocalFolderRecord,
  PortableFolderBundle,
  PortableFolderNode,
  QueuedPhoto,
  TargetFolder,
} from '../types';

const DB_NAME = 'chantiershot_db';
const DB_VERSION = 1;
const PHOTOS_STORE = 'photos';
const FOLDERS_STORE = 'local_folders';

const LEGACY_SETTINGS_KEY = 'chantiershot_settings_v1';
const SETTINGS_KEY = 'chantiershot_settings_v2';
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

export async function deletePhotosByIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTOS_STORE, 'readwrite');
    const store = tx.objectStore(PHOTOS_STORE);
    for (const id of ids) {
      store.delete(id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function movePhotosToFolder(
  ids: string[],
  target: TargetFolder
): Promise<string> {
  const pathSegments = target.pathSegments
    .filter((s) => s.id !== 'root')
    .map((s) => s.name);
  const newFolderPath = pathSegments.length > 0 ? pathSegments.join(' / ') : target.name;
  if (ids.length === 0) return newFolderPath;

  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PHOTOS_STORE, 'readwrite');
    const store = tx.objectStore(PHOTOS_STORE);
    for (const id of ids) {
      const req = store.get(id);
      req.onsuccess = () => {
        const existing = req.result as QueuedPhoto | undefined;
        if (existing) {
          store.put({
            ...existing,
            folderId: target.id,
            folderPath: newFolderPath,
          });
        }
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return newFolderPath;
}

export async function updatePhotoNote(photoId: string, note: string): Promise<void> {
  const trimmed = note.trim().slice(0, 300);
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PHOTOS_STORE, 'readwrite');
    const store = tx.objectStore(PHOTOS_STORE);
    const req = store.get(photoId);
    req.onsuccess = () => {
      const existing = req.result as QueuedPhoto | undefined;
      if (existing) {
        const updated: QueuedPhoto = { ...existing };
        if (trimmed) {
          updated.note = trimmed;
        } else {
          delete updated.note;
        }
        store.put(updated);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function sanitizeZipSegments(rawPath: string): string[] {
  return rawPath
    .split('/')
    .map((s) => s.trim().replace(/[\\:*?"<>|]/g, '-'))
    .filter((s) => s && s !== '.' && s !== '..' && s !== 'Mes chantiers' && s !== 'Chantiers locaux');
}

export function getDescendantIdsFromList(
  allFolders: LocalFolderRecord[],
  folderId: string
): Set<string> {
  const ids = new Set<string>([folderId]);
  let added = true;
  while (added) {
    added = false;
    for (const f of allFolders) {
      if (ids.has(f.parentId) && !ids.has(f.id)) {
        ids.add(f.id);
        added = true;
      }
    }
  }
  return ids;
}

export function getFolderPathsFromList(
  allFolders: LocalFolderRecord[],
  rootChantierId?: string
): string[] {
  const byId = new Map(allFolders.map((f) => [f.id, f]));
  const allowedIds = rootChantierId
    ? getDescendantIdsFromList(allFolders, rootChantierId)
    : null;

  const paths: string[] = [];
  for (const f of allFolders) {
    if (allowedIds && !allowedIds.has(f.id)) continue;
    const segments: string[] = [];
    let curr: LocalFolderRecord | undefined = f;
    const guard = new Set<string>();
    while (curr && !guard.has(curr.id)) {
      guard.add(curr.id);
      segments.unshift(curr.name);
      if (curr.parentId === 'root') break;
      curr = byId.get(curr.parentId);
    }

    const clean = sanitizeZipSegments(segments.join('/'));
    if (clean.length > 0) {
      paths.push(clean.join('/'));
    }
  }

  return Array.from(new Set(paths));
}

export async function getAllUserFolderPaths(rootChantierId?: string): Promise<string[]> {
  const allFolders = await getAllLocalFolders();
  return getFolderPathsFromList(allFolders, rootChantierId);
}

export function buildTargetFolderFromId(
  allFolders: LocalFolderRecord[],
  folderId: string
): TargetFolder | null {
  const byId = new Map(allFolders.map((f) => [f.id, f]));
  const target = byId.get(folderId);
  if (!target) return null;

  const segments: { id: string; name: string }[] = [];
  let curr: LocalFolderRecord | undefined = target;
  const guard = new Set<string>();
  while (curr && !guard.has(curr.id)) {
    guard.add(curr.id);
    segments.unshift({ id: curr.id, name: curr.name });
    if (curr.parentId === 'root') break;
    curr = byId.get(curr.parentId);
  }
  segments.unshift({ id: 'root', name: 'Mes chantiers' });

  return {
    id: target.id,
    name: target.name,
    pathSegments: segments,
  };
}

export function buildNotesFilesForExport(
  photos: QueuedPhoto[],
  allFolders: LocalFolderRecord[] = []
): { folderPath: string; content: string }[] {
  const byId = new Map(allFolders.map((f) => [f.id, f]));
  const folderNoteByZipPath = new Map<string, string>();
  const photoNotesByZipPath = new Map<string, QueuedPhoto[]>();

  const photoFolderIds = new Set(photos.map((p) => p.folderId));

  for (const f of allFolders) {
    const trimmedNote = f.note?.trim();
    if (!trimmedNote) continue;
    // Include folder note if any exported photo belongs to this folder or if exporting all
    const descendants = getDescendantIdsFromList(allFolders, f.id);
    const matchesExport =
      photos.length === 0 ||
      Array.from(descendants).some((id) => photoFolderIds.has(id));
    if (!matchesExport) continue;

    const segments: string[] = [];
    let curr: LocalFolderRecord | undefined = f;
    const guard = new Set<string>();
    while (curr && !guard.has(curr.id)) {
      guard.add(curr.id);
      segments.unshift(curr.name);
      if (curr.parentId === 'root') break;
      curr = byId.get(curr.parentId);
    }
    const clean = sanitizeZipSegments(segments.join('/')).join('/');
    if (clean) {
      folderNoteByZipPath.set(clean, trimmedNote);
    }
  }

  for (const photo of photos) {
    const trimmedNote = photo.note?.trim();
    if (!trimmedNote) continue;
    const cleanSegments = sanitizeZipSegments(photo.folderPath);
    const zipPath = cleanSegments.length > 0 ? cleanSegments.join('/') : 'Chantier';
    const arr = photoNotesByZipPath.get(zipPath) || [];
    arr.push(photo);
    photoNotesByZipPath.set(zipPath, arr);
  }

  const allPaths = Array.from(
    new Set([...folderNoteByZipPath.keys(), ...photoNotesByZipPath.keys()])
  ).sort((a, b) => a.localeCompare(b, 'fr'));

  const result: { folderPath: string; content: string }[] = [];
  for (const folderPath of allPaths) {
    const lines: string[] = [`Dossier : ${folderPath}`, ''];
    const fNote = folderNoteByZipPath.get(folderPath);
    if (fNote) {
      lines.push('Note du dossier :');
      lines.push(fNote);
      lines.push('');
    }
    const pNotes = photoNotesByZipPath.get(folderPath) || [];
    if (pNotes.length > 0) {
      lines.push('Notes par photo :');
      for (const p of pNotes) {
        const dt = new Date(p.capturedAt).toLocaleString('fr-FR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
        lines.push(`- ${p.filename} (${dt}) : ${p.note?.trim()}`);
      }
      lines.push('');
    }
    result.push({
      folderPath,
      content: lines.join('\n'),
    });
  }

  return result;
}

export async function buildPhotosZipBlob(
  photos: QueuedPhoto[],
  extraFolderPaths: string[] = [],
  allFolders: LocalFolderRecord[] = []
): Promise<Blob> {
  const zip = new JSZip();

  for (const folderPath of extraFolderPaths) {
    const cleanSegments = sanitizeZipSegments(folderPath);
    if (cleanSegments.length > 0) {
      zip.folder(cleanSegments.join('/'));
    }
  }

  for (const photo of photos) {
    const cleanSegments = sanitizeZipSegments(photo.folderPath);
    const pathPrefix = cleanSegments.length > 0 ? cleanSegments.join('/') : 'Chantier';
    zip.file(`${pathPrefix}/${photo.filename}`, photo.blob, { compression: 'STORE' });
  }

  const noteFiles = buildNotesFilesForExport(photos, allFolders);
  for (const nf of noteFiles) {
    zip.file(`${nf.folderPath}/notes.txt`, nf.content);
  }
  if (noteFiles.length > 0) {
    const summary = noteFiles.map((nf) => nf.content).join('\n------------------------------\n\n');
    zip.file('notes_chantiers.txt', summary);
  }

  return zip.generateAsync({ type: 'blob' });
}

// --- Local Offline Folders in IndexedDB ---

export async function getLocalFoldersByParent(parentId: string): Promise<LocalFolderRecord[]> {
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

export async function updateFolderNote(folderId: string, note: string): Promise<void> {
  const trimmed = note.trim().slice(0, 600);
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FOLDERS_STORE, 'readwrite');
    const store = tx.objectStore(FOLDERS_STORE);
    const req = store.get(folderId);
    req.onsuccess = () => {
      const existing = req.result as LocalFolderRecord | undefined;
      if (existing) {
        const updated: LocalFolderRecord = { ...existing };
        if (trimmed) {
          updated.note = trimmed;
        } else {
          delete updated.note;
        }
        store.put(updated);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getDescendantFolderIds(folderId: string): Promise<Set<string>> {
  const all = await getAllLocalFolders();
  const result = new Set<string>([folderId]);
  let added = true;
  while (added) {
    added = false;
    for (const f of all) {
      if (result.has(f.parentId) && !result.has(f.id)) {
        result.add(f.id);
        added = true;
      }
    }
  }
  return result;
}

export async function deleteLocalFolderRecursive(folderId: string): Promise<Set<string>> {
  const toDelete = await getDescendantFolderIds(folderId);
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FOLDERS_STORE, 'readwrite');
    const store = tx.objectStore(FOLDERS_STORE);
    for (const id of toDelete) {
      store.delete(id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return toDelete;
}

export async function deleteAllLocalFolders(): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FOLDERS_STORE, 'readwrite');
    tx.objectStore(FOLDERS_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Portable Folder Preparation (PC <-> Phone, 0 Cloud Quota) ---

export function exportFolderBundle(
  allFolders: LocalFolderRecord[],
  rootChantierId?: string
): PortableFolderBundle {
  const childrenByParent = new Map<string, LocalFolderRecord[]>();
  for (const f of allFolders) {
    const arr = childrenByParent.get(f.parentId) || [];
    arr.push(f);
    childrenByParent.set(f.parentId, arr);
  }
  for (const arr of childrenByParent.values()) {
    arr.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  }

  const buildNode = (folder: LocalFolderRecord, visited: Set<string>): PortableFolderNode => {
    visited.add(folder.id);
    const kids = (childrenByParent.get(folder.id) || [])
      .filter((k) => !visited.has(k.id))
      .map((k) => buildNode(k, new Set(visited)));
    const node: PortableFolderNode = { name: folder.name };
    if (folder.note?.trim()) {
      node.note = folder.note.trim();
    }
    if (kids.length > 0) {
      node.children = kids;
    }
    return node;
  };

  const roots = (childrenByParent.get('root') || []).filter(
    (r) => !rootChantierId || r.id === rootChantierId
  );

  return {
    version: 1,
    exportedAt: Date.now(),
    chantiers: roots.map((r) => buildNode(r, new Set<string>())),
  };
}

export function countPortableNodes(nodes: PortableFolderNode[]): number {
  let count = 0;
  for (const n of nodes) {
    count += 1;
    if (Array.isArray(n.children) && n.children.length > 0) {
      count += countPortableNodes(n.children);
    }
  }
  return count;
}

export function parsePathsToFolderBundle(rawPaths: string[]): PortableFolderBundle {
  const roots: PortableFolderNode[] = [];

  const insertSegments = (segments: string[]) => {
    let level = roots;
    for (const rawSeg of segments) {
      const cleanName = rawSeg.trim().slice(0, 100);
      if (!cleanName || cleanName === '.' || cleanName === '..') continue;
      const key = cleanName.toLocaleLowerCase('fr');
      let match = level.find((n) => n.name.toLocaleLowerCase('fr') === key);
      if (!match) {
        match = { name: cleanName, children: [] };
        level.push(match);
      }
      if (!match.children) {
        match.children = [];
      }
      level = match.children;
    }
  };

  for (const line of rawPaths) {
    const normalized = line
      .replace(/\\/g, '/')
      .replace(/\s*>\s*/g, '/')
      .trim();
    if (!normalized) continue;
    const segments = normalized.split('/').map((s) => s.trim()).filter(Boolean);
    if (segments.length > 0) {
      insertSegments(segments);
    }
  }

  const pruneEmptyChildren = (nodes: PortableFolderNode[]): PortableFolderNode[] =>
    nodes.map((n) => {
      const children = n.children && n.children.length > 0 ? pruneEmptyChildren(n.children) : undefined;
      return children ? { name: n.name, ...(n.note ? { note: n.note } : {}), children } : { name: n.name, ...(n.note ? { note: n.note } : {}) };
    });

  return {
    version: 1,
    exportedAt: Date.now(),
    chantiers: pruneEmptyChildren(roots),
  };
}

export function extractFolderPathsFromFileList(files: FileList | File[]): string[] {
  const pathSet = new Set<string>();
  const list = Array.from(files);
  for (const file of list) {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || '';
    if (!rel) continue;
    const parts = rel.split('/').map((s) => s.trim()).filter(Boolean);
    // Remove trailing filename so only directory segments remain
    if (parts.length > 1) {
      pathSet.add(parts.slice(0, -1).join('/'));
    }
  }
  return Array.from(pathSet);
}

export function parsePortableFolderBundleText(rawText: string): PortableFolderBundle {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error('Le fichier sélectionné est vide.');
  }

  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as Partial<PortableFolderBundle>;
    if (!parsed || !Array.isArray(parsed.chantiers)) {
      throw new Error('Format de fichier modèle ChantierShot invalide.');
    }
    const sanitizeNode = (node: PortableFolderNode): PortableFolderNode | null => {
      const name = typeof node?.name === 'string' ? node.name.trim().slice(0, 100) : '';
      if (!name) return null;
      const clean: PortableFolderNode = { name };
      if (typeof node.note === 'string' && node.note.trim()) {
        clean.note = node.note.trim().slice(0, 600);
      }
      if (Array.isArray(node.children)) {
        const kids = node.children
          .map(sanitizeNode)
          .filter((x): x is PortableFolderNode => Boolean(x));
        if (kids.length > 0) clean.children = kids;
      }
      return clean;
    };
    const chantiers = parsed.chantiers
      .map(sanitizeNode)
      .filter((x): x is PortableFolderNode => Boolean(x));
    if (chantiers.length === 0) {
      throw new Error('Aucun chantier trouvé dans ce fichier.');
    }
    return {
      version: 1,
      exportedAt: typeof parsed.exportedAt === 'number' ? parsed.exportedAt : Date.now(),
      chantiers,
    };
  }

  // Fallback: plain text list of paths (one path per line)
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const bundle = parsePathsToFolderBundle(lines);
  if (bundle.chantiers.length === 0) {
    throw new Error('Aucun dossier valide détecté dans ce fichier texte.');
  }
  return bundle;
}

export async function importFolderBundle(bundle: PortableFolderBundle): Promise<{
  createdCount: number;
  skippedCount: number;
  updatedNotesCount: number;
  rootChantierIds: string[];
}> {
  const existing = await getAllLocalFolders();
  const byParentAndName = new Map<string, LocalFolderRecord>();
  const makeKey = (parentId: string, name: string) =>
    `${parentId}::${name.trim().toLocaleLowerCase('fr')}`;

  for (const f of existing) {
    byParentAndName.set(makeKey(f.parentId, f.name), f);
  }

  const toPut: LocalFolderRecord[] = [];
  let createdCount = 0;
  let skippedCount = 0;
  let updatedNotesCount = 0;
  const rootChantierIds: string[] = [];
  let seq = 0;

  const walk = (nodes: PortableFolderNode[], parentId: string, depth: number) => {
    for (const node of nodes) {
      const cleanName = node.name.trim().slice(0, 100);
      if (!cleanName) continue;
      const key = makeKey(parentId, cleanName);
      let record = byParentAndName.get(key);
      const cleanNote = node.note?.trim().slice(0, 600);

      if (!record) {
        seq += 1;
        record = {
          id: `loc_${Date.now()}_${seq}_${Math.random().toString(36).slice(2, 6)}`,
          parentId,
          name: cleanName,
          createdAt: Date.now() + seq,
          ...(cleanNote ? { note: cleanNote } : {}),
        };
        byParentAndName.set(key, record);
        toPut.push(record);
        createdCount += 1;
      } else {
        skippedCount += 1;
        if (cleanNote && !record.note?.trim()) {
          record = { ...record, note: cleanNote };
          byParentAndName.set(key, record);
          toPut.push(record);
          updatedNotesCount += 1;
        }
      }

      if (depth === 0) {
        rootChantierIds.push(record.id);
      }

      if (Array.isArray(node.children) && node.children.length > 0 && depth < 12) {
        walk(node.children, record.id, depth + 1);
      }
    }
  };

  walk(bundle.chantiers, 'root', 0);

  if (toPut.length > 0) {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(FOLDERS_STORE, 'readwrite');
      const store = tx.objectStore(FOLDERS_STORE);
      for (const rec of toPut) {
        store.put(rec);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  return {
    createdCount,
    skippedCount,
    updatedNotesCount,
    rootChantierIds,
  };
}

// --- Settings & Recent Targets (localStorage) ---

const DEFAULT_SETTINGS: CaptureSettings = {
  prefix: '',
  burnStamp: false,
  jpegQuality: 0.85,
};

export const MAX_PHOTO_MEGAPIXELS = 15_000_000;

export function drawCornerStamp(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  folderLabel: string
): void {
  const now = new Date();
  const label = `${now.toLocaleDateString('fr-FR')} ${now.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  })} — ${folderLabel}`;

  const fontSize = Math.max(18, Math.round(width * 0.018));
  ctx.font = `600 ${fontSize}px sans-serif`;
  const metrics = ctx.measureText(label);
  const padX = Math.round(fontSize * 0.7);
  const padY = Math.round(fontSize * 0.45);
  const boxW = Math.min(width - 24, metrics.width + padX * 2);
  const boxH = fontSize + padY * 2;
  const x = width - boxW - 16;
  const y = height - boxH - 16;

  ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
  ctx.beginPath();
  ctx.roundRect(x, y, boxW, boxH, 8);
  ctx.fill();

  ctx.fillStyle = '#F8FAFC';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + padX, y + boxH / 2, boxW - padX * 2);
}

export async function normalizeBlobToMax15MP(
  sourceBlob: Blob,
  options: { stampFolderLabel?: string; quality?: number }
): Promise<Blob> {
  const quality = options.quality ?? 0.85;
  const bitmap = await createImageBitmap(sourceBlob);
  try {
    const srcW = bitmap.width;
    const srcH = bitmap.height;
    const totalPixels = srcW * srcH;
    const needsResize = totalPixels > MAX_PHOTO_MEGAPIXELS;
    const needsStamp = Boolean(options.stampFolderLabel);

    if (
      !needsResize &&
      !needsStamp &&
      sourceBlob.type === 'image/jpeg' &&
      sourceBlob.size <= 3_800_000
    ) {
      return sourceBlob;
    }

    const scale = needsResize ? Math.sqrt(MAX_PHOTO_MEGAPIXELS / totalPixels) : 1;
    const targetW = Math.max(1, Math.round(srcW * scale));
    const targetH = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return sourceBlob;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);

    if (options.stampFolderLabel) {
      drawCornerStamp(ctx, targetW, targetH, options.stampFolderLabel);
    }

    const output = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', quality)
    );
    return output || sourceBlob;
  } finally {
    bitmap.close();
  }
}

export function loadCaptureSettings(): CaptureSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }
    const legacyRaw = localStorage.getItem(LEGACY_SETTINGS_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as Partial<CaptureSettings>;
      const migrated: CaptureSettings = {
        prefix: typeof legacy.prefix === 'string' ? legacy.prefix : DEFAULT_SETTINGS.prefix,
        jpegQuality:
          typeof legacy.jpegQuality === 'number'
            ? legacy.jpegQuality
            : DEFAULT_SETTINGS.jpegQuality,
        burnStamp: false,
      };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(migrated));
      return migrated;
    }
    return DEFAULT_SETTINGS;
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

  const recents = loadRecentTargets().filter((item) => item.id !== target.id);
  recents.unshift(target);
  localStorage.setItem(RECENT_TARGETS_KEY, JSON.stringify(recents.slice(0, 5)));
}

export function removeDeletedFoldersFromTargets(deletedIds: Set<string> | 'ALL'): {
  active: TargetFolder | null;
  recents: TargetFolder[];
} {
  if (deletedIds === 'ALL') {
    localStorage.removeItem(ACTIVE_TARGET_KEY);
    localStorage.removeItem(RECENT_TARGETS_KEY);
    return { active: null, recents: [] };
  }

  let active = loadActiveTarget();
  if (active && active.pathSegments.some((s) => deletedIds.has(s.id))) {
    localStorage.removeItem(ACTIVE_TARGET_KEY);
    active = null;
  }

  const recents = loadRecentTargets().filter(
    (t) => !t.pathSegments.some((s) => deletedIds.has(s.id))
  );
  localStorage.setItem(RECENT_TARGETS_KEY, JSON.stringify(recents));
  return { active, recents };
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
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2).replace('.', ',')} Go`;
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
