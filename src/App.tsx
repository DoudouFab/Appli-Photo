import React, { useCallback, useEffect, useState } from 'react';
import {
  Camera,
  FolderTree,
  ListChecks,
  WifiOff,
} from 'lucide-react';
import {
  CaptureSettings,
  QueuedPhoto,
  TargetFolder,
} from './types';
import {
  buildPhotoFilename,
  deletePhotoRecord,
  deletePhotosByIds,
  getAllPhotos,
  loadActiveTarget,
  loadCaptureSettings,
  loadRecentTargets,
  normalizeBlobToMax15MP,
  removeDeletedFoldersFromTargets,
  saveActiveTarget,
  saveCaptureSettings,
  savePhotoRecord,
} from './lib/storage';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { PWAInstallButton } from './components/PWAInstallButton';
import { FolderExplorer } from './components/FolderExplorer';
import { CameraViewfinder } from './components/CameraViewfinder';
import { UploadQueue } from './components/UploadQueue';

type ActiveTab = 'folders' | 'camera' | 'queue';

export function App() {
  const isOnline = useOnlineStatus();

  const [activeTab, setActiveTab] = useState<ActiveTab>('folders');
  const [activeTarget, setActiveTarget] = useState<TargetFolder | null>(() =>
    loadActiveTarget()
  );
  const [recentTargets, setRecentTargets] = useState<TargetFolder[]>(() =>
    loadRecentTargets()
  );
  const [settings, setSettings] = useState<CaptureSettings>(() =>
    loadCaptureSettings()
  );
  const [photos, setPhotos] = useState<QueuedPhoto[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [pendingPcAck, setPendingPcAck] = useState<{
    code: string;
    sentIds: string[];
    autoDelete: boolean;
    mode: 'http' | 'p2p';
  } | null>(() => {
    try {
      const raw = localStorage.getItem('chantiershot_pending_pc_ack_v1');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((curr) => (curr === msg ? null : curr));
    }, 3500);
  }, []);

  const handleConfirmPcAck = useCallback(
    async (sentIds: string[], autoDelete: boolean) => {
      if (autoDelete && sentIds.length > 0) {
        await deletePhotosByIds(sentIds);
        const idSet = new Set(sentIds);
        setPhotos((prev) => prev.filter((p) => !idSet.has(p.id)));
        showToast(
          `Transfert PC réussi : ${sentIds.length} photo(s) supprimée(s) automatiquement.`
        );
      } else {
        showToast('Transfert confirmé sur votre PC.');
      }
      setPendingPcAck(null);
    },
    [showToast]
  );

  const loadStoredPhotos = useCallback(async () => {
    try {
      const stored = await getAllPhotos();
      setPhotos(stored);
    } catch {
      // Ignore IndexedDB load error
    }
  }, []);

  useEffect(() => {
    loadStoredPhotos();
    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      navigator.storage.persist().catch(() => {});
    }
  }, [loadStoredPhotos]);

  // Background poll for HTTP PC confirmation even if user switches tabs on phone
  useEffect(() => {
    if (!pendingPcAck) {
      localStorage.removeItem('chantiershot_pending_pc_ack_v1');
      return;
    }
    if (pendingPcAck.mode === 'http') {
      localStorage.setItem('chantiershot_pending_pc_ack_v1', JSON.stringify(pendingPcAck));
    } else {
      // P2P sessions rely on live DataChannel ack and are not persisted across full reloads
      return;
    }

    let active = true;
    const checkAck = async () => {
      try {
        const res = await fetch(`./api/transfer/${pendingPcAck.code}/status`);
        if (res.status === 404 && active) {
          setPendingPcAck(null);
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as { received?: boolean };
        if (data.received && active) {
          await handleConfirmPcAck(pendingPcAck.sentIds, pendingPcAck.autoDelete);
        }
      } catch {
        // Retry next interval
      }
    };

    checkAck();
    const timer = setInterval(checkAck, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [pendingPcAck, handleConfirmPcAck]);

  const handleSelectTarget = (target: TargetFolder, launchCamera = false) => {
    setActiveTarget(target);
    saveActiveTarget(target);
    setRecentTargets(loadRecentTargets());
    if (launchCamera) {
      setActiveTab('camera');
    }
  };

  const handleUpdateSettings = (next: CaptureSettings) => {
    setSettings(next);
    saveCaptureSettings(next);
  };

  const handlePhotoCaptured = async (blob: Blob, filename: string) => {
    if (!activeTarget) return;
    const pathLabel = activeTarget.pathSegments
      .filter((s) => s.id !== 'root')
      .map((s) => s.name)
      .join(' / ');
    const newPhoto: QueuedPhoto = {
      id: `ph_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      filename,
      blob,
      size: blob.size,
      capturedAt: Date.now(),
      folderId: activeTarget.id,
      folderPath: pathLabel || activeTarget.name,
    };

    await savePhotoRecord(newPhoto);
    setPhotos((prev) => [newPhoto, ...prev]);
  };

  const handleDeletePhoto = async (id: string) => {
    await deletePhotoRecord(id);
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  };

  const handleDeletePhotosBatch = async (ids: string[]) => {
    await deletePhotosByIds(ids);
    const idSet = new Set(ids);
    setPhotos((prev) => prev.filter((p) => !idSet.has(p.id)));
  };

  const handleImportGalleryFiles = async (target: TargetFolder, files: File[]) => {
    const pathLabel = target.pathSegments
      .filter((s) => s.id !== 'root')
      .map((s) => s.name)
      .join(' / ');
    const folderPath = pathLabel || target.name;
    const stampLabel = settings.burnStamp ? folderPath : undefined;

    let seq = photos.filter((p) => p.folderId === target.id).length;
    const imported: QueuedPhoto[] = [];

    for (const file of files) {
      seq += 1;
      const filename = buildPhotoFilename(settings.prefix, seq);
      let finalBlob: Blob = file;
      if (file.type.startsWith('image/')) {
        try {
          finalBlob = await normalizeBlobToMax15MP(file, {
            stampFolderLabel: stampLabel,
            quality: settings.jpegQuality,
          });
        } catch {
          finalBlob = file;
        }
      }
      const record: QueuedPhoto = {
        id: `ph_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        filename,
        blob: finalBlob,
        size: finalBlob.size,
        capturedAt: Date.now(),
        folderId: target.id,
        folderPath,
      };
      await savePhotoRecord(record);
      imported.push(record);
    }

    if (imported.length > 0) {
      setPhotos((prev) => [...imported.reverse(), ...prev]);
      showToast(`${imported.length} photo(s) importée(s) dans « ${target.name} ».`);
    }
  };

  const handleFoldersDeleted = async (
    deletedFolderIds: Set<string> | 'ALL',
    alsoDeletePhotos: boolean
  ) => {
    const { active, recents } = removeDeletedFoldersFromTargets(deletedFolderIds);
    setActiveTarget(active);
    setRecentTargets(recents);

    if (alsoDeletePhotos) {
      if (deletedFolderIds === 'ALL') {
        const allIds = photos.map((p) => p.id);
        if (allIds.length > 0) {
          await deletePhotosByIds(allIds);
          setPhotos([]);
        }
        showToast('Tous les dossiers et photos ont été supprimés.');
      } else {
        const toDeleteIds = photos
          .filter((p) => deletedFolderIds.has(p.folderId))
          .map((p) => p.id);
        if (toDeleteIds.length > 0) {
          await deletePhotosByIds(toDeleteIds);
          const idSet = new Set(toDeleteIds);
          setPhotos((prev) => prev.filter((p) => !idSet.has(p.id)));
        }
        showToast('Dossier supprimé.');
      }
    } else {
      showToast('Dossier supprimé.');
    }
  };

  const totalCount = photos.length;

  const sessionPhotosForActiveFolder = activeTarget
    ? photos.filter((p) => p.folderId === activeTarget.id)
    : [];

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Bar — 3-Zone Contract on Desktop, Compact 52px Header on Mobile */}
      <header className="sticky top-0 z-30 h-[52px] md:h-16 bg-white/90 backdrop-blur-md border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 md:gap-8">
        {/* Zone 1: Brand Title with refined architectural camera-folder emblem */}
        <a
          href="./"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('folders');
          }}
          className="inline-flex items-center gap-2.5 text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 font-display"
        >
          <svg
            viewBox="0 0 32 32"
            fill="none"
            className="w-7 h-7 shrink-0"
            aria-hidden="true"
          >
            <rect width="32" height="32" rx="8" fill="#0F172A" />
            <path
              d="M6.5 10.5C6.5 9.67157 7.17157 9 8 9H12.8L14.5 10.7H24C24.8284 10.7 25.5 11.3716 25.5 12.2V22C25.5 22.8284 24.8284 23.5 24 23.5H8C7.17157 23.5 6.5 22.8284 6.5 22V10.5Z"
              fill="#1E293B"
              stroke="#475569"
              strokeWidth="1.2"
            />
            <circle cx="16" cy="17.2" r="4.3" fill="#0F172A" stroke="#F59E0B" strokeWidth="1.7" />
            <circle cx="16" cy="17.2" r="1.7" fill="#F59E0B" />
          </svg>
          <span>ChantierShot</span>
        </a>

        {/* Zone 2: Desktop Navigation Links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          <button
            type="button"
            onClick={() => setActiveTab('folders')}
            className={`whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              activeTab === 'folders'
                ? 'text-slate-950 font-semibold underline decoration-amber-500 decoration-2 underline-offset-8'
                : 'hover:text-slate-900'
            }`}
          >
            Dossiers
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('camera')}
            className={`whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              activeTab === 'camera'
                ? 'text-slate-950 font-semibold underline decoration-amber-500 decoration-2 underline-offset-8'
                : 'hover:text-slate-900'
            }`}
          >
            Appareil photo
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('queue')}
            className={`whitespace-nowrap shrink-0 cursor-pointer transition-colors tabular-nums ${
              activeTab === 'queue'
                ? 'text-slate-950 font-semibold underline decoration-amber-500 decoration-2 underline-offset-8'
                : 'hover:text-slate-900'
            }`}
          >
            Transfert{totalCount > 0 ? ` (${totalCount})` : ''}
          </button>
        </nav>

        {/* Zone 3: Install App Primary Action (visible on mobile & desktop) */}
        <div className="flex items-center gap-2 shrink-0">
          <PWAInstallButton />
          <button
            type="button"
            onClick={() => setActiveTab('camera')}
            className="hidden md:inline-flex min-h-[40px] px-3.5 py-2 rounded-lg bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400 transition-colors items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Prendre une photo</span>
          </button>
        </div>
      </header>

      {/* Offline Status Banner */}
      {!isOnline && (
        <div className="bg-amber-500 text-slate-950 px-4 py-1.5 text-xs font-semibold flex items-center justify-center gap-2">
          <WifiOff className="w-3.5 h-3.5 shrink-0" />
          <span>
            Mode hors-ligne actif : dossiers, photos et export ZIP restent 100 % disponibles.
          </span>
        </div>
      )}

      {/* Main Workspace */}
      <main className="flex-1 flex flex-col">
        <div className="flex-1">
          {activeTab === 'folders' && (
            <FolderExplorer
              activeTarget={activeTarget}
              recentTargets={recentTargets}
              photos={photos}
              onSelectTarget={handleSelectTarget}
              onImportGalleryFiles={handleImportGalleryFiles}
              onFoldersDeleted={handleFoldersDeleted}
              onOpenTransfer={() => setActiveTab('queue')}
            />
          )}

          {activeTab === 'camera' && (
            <CameraViewfinder
              activeTarget={activeTarget}
              settings={settings}
              recentSessionPhotos={sessionPhotosForActiveFolder}
              totalStoredPhotos={totalCount}
              onUpdateSettings={handleUpdateSettings}
              onPhotoCaptured={handlePhotoCaptured}
              onChangeFolder={() => setActiveTab('folders')}
              onOpenTransfer={() => setActiveTab('queue')}
            />
          )}

          {activeTab === 'queue' && (
            <UploadQueue
              photos={photos}
              isOnline={isOnline}
              pendingPcAck={pendingPcAck}
              onStartWaitingPcAck={setPendingPcAck}
              onConfirmPcAck={handleConfirmPcAck}
              onDeletePhoto={handleDeletePhoto}
              onDeletePhotosBatch={handleDeletePhotosBatch}
            />
          )}
        </div>

        {/* Quiet Signature Footer */}
        <footer className="mx-auto w-full max-w-6xl px-4 sm:px-6 pt-2 pb-24 md:pb-6 text-center md:text-right text-xs text-slate-400">
          ChantierShot · F.Pirquin
        </footer>
      </main>

      {/* Mobile Bottom Thumb-Zone Tab Bar (64px, within 15% combined sticky height cap) */}
      <nav
        aria-label="Navigation principale mobile"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-safe"
      >
        <div className="grid grid-cols-3 h-16 items-center">
          <button
            type="button"
            onClick={() => setActiveTab('folders')}
            className={`h-full flex flex-col items-center justify-center gap-1 cursor-pointer ${
              activeTab === 'folders' ? 'text-slate-950' : 'text-slate-500'
            }`}
          >
            <FolderTree
              className={`w-5 h-5 ${activeTab === 'folders' ? 'text-amber-600' : ''}`}
            />
            <span className="text-[11px] font-medium tracking-tight">Dossiers</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('camera')}
            className={`h-full flex flex-col items-center justify-center gap-1 cursor-pointer ${
              activeTab === 'camera' ? 'text-slate-950' : 'text-slate-500'
            }`}
          >
            <Camera
              className={`w-5 h-5 ${activeTab === 'camera' ? 'text-amber-600' : ''}`}
            />
            <span className="text-[11px] font-medium tracking-tight">Appareil</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('queue')}
            className={`h-full flex flex-col items-center justify-center gap-1 cursor-pointer ${
              activeTab === 'queue' ? 'text-slate-950' : 'text-slate-500'
            }`}
          >
            <ListChecks
              className={`w-5 h-5 ${activeTab === 'queue' ? 'text-amber-600' : ''}`}
            />
            <span className="text-[11px] font-medium tracking-tight tabular-nums">
              Transfert{totalCount > 0 ? ` (${totalCount})` : ''}
            </span>
          </button>
        </div>
      </nav>

      {/* Toast Feedback */}
      {toastMessage && (
        <div className="fixed bottom-20 md:bottom-6 right-4 z-50 rounded-xl bg-slate-900 text-white px-4 py-3 text-xs font-medium shadow-lg">
          {toastMessage}
        </div>
      )}
    </div>
  );
}

export default App;
