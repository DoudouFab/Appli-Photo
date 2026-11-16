import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Camera,
  FolderPlus,
  FolderTree,
  Home,
  Layers,
  ListChecks,
  WifiOff,
} from 'lucide-react';
import {
  CaptureSettings,
  LocalFolderRecord,
  QueuedPhoto,
  TargetFolder,
} from './types';
import {
  buildPhotoFilename,
  createLocalFolder,
  deletePhotoRecord,
  deletePhotosByIds,
  getAllLocalFolders,
  getAllPhotos,
  getDescendantIdsFromList,
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
import { useStorageQuota } from './hooks/useStorageQuota';
import { PWAInstallButton } from './components/PWAInstallButton';
import { HomeDashboard } from './components/HomeDashboard';
import { FolderExplorer } from './components/FolderExplorer';
import { CameraViewfinder } from './components/CameraViewfinder';
import { UploadQueue } from './components/UploadQueue';

type ActiveTab = 'home' | 'folders' | 'camera' | 'queue';

export function App() {
  const isOnline = useOnlineStatus();

  const [activeTab, setActiveTab] = useState<ActiveTab>('home');
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
  const [allFolders, setAllFolders] = useState<LocalFolderRecord[]>([]);
  const [selectedChantierId, setSelectedChantierId] = useState<string | null>(null);
  const [transferScope, setTransferScope] = useState<'all' | 'chantier'>('all');
  const [creatingChantierTab, setCreatingChantierTab] = useState(false);
  const [newChantierName, setNewChantierName] = useState('');
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

  const rootChantiers = useMemo(
    () =>
      allFolders
        .filter((f) => f.parentId === 'root')
        .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' })),
    [allFolders]
  );

  const selectedChantier = useMemo(
    () => rootChantiers.find((c) => c.id === selectedChantierId) || rootChantiers[0] || null,
    [rootChantiers, selectedChantierId]
  );

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

  const refreshFolders = useCallback(async () => {
    try {
      const list = await getAllLocalFolders();
      setAllFolders(list);
      const roots = list
        .filter((f) => f.parentId === 'root')
        .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
      setSelectedChantierId((curr) => {
        if (curr && roots.some((r) => r.id === curr)) return curr;
        return roots[0]?.id ?? null;
      });
    } catch {
      // Ignore IndexedDB error
    }
  }, []);

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
    refreshFolders();
    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      navigator.storage.persist().catch(() => {});
    }
  }, [loadStoredPhotos, refreshFolders]);

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

  const handleCreateChantierTab = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newChantierName.trim();
    if (!trimmed) return;
    const created = await createLocalFolder('root', trimmed);
    setNewChantierName('');
    setCreatingChantierTab(false);
    await refreshFolders();
    setSelectedChantierId(created.id);
    const target: TargetFolder = {
      id: created.id,
      name: created.name,
      pathSegments: [
        { id: 'root', name: 'Mes chantiers' },
        { id: created.id, name: created.name },
      ],
    };
    setActiveTarget(target);
    saveActiveTarget(target);
    setRecentTargets(loadRecentTargets());
  };

  const countPhotosForChantier = useCallback(
    (chantierId: string) => {
      const ids = getDescendantIdsFromList(allFolders, chantierId);
      return photos.filter((p) => ids.has(p.folderId)).length;
    },
    [allFolders, photos]
  );

  const storageQuota = useStorageQuota(photos);

  const handleLaunchCameraForChantier = (chantierId?: string) => {
    if (chantierId) {
      const chantier = rootChantiers.find((c) => c.id === chantierId);
      const alreadyInsideChantier = activeTarget?.pathSegments.some(
        (s) => s.id === chantierId
      );
      if (chantier && !alreadyInsideChantier) {
        const target: TargetFolder = {
          id: chantier.id,
          name: chantier.name,
          pathSegments: [
            { id: 'root', name: 'Mes chantiers' },
            { id: chantier.id, name: chantier.name },
          ],
        };
        setActiveTarget(target);
        saveActiveTarget(target);
        setRecentTargets(loadRecentTargets());
      }
      setSelectedChantierId(chantierId);
    } else if (!activeTarget && selectedChantier) {
      const target: TargetFolder = {
        id: selectedChantier.id,
        name: selectedChantier.name,
        pathSegments: [
          { id: 'root', name: 'Mes chantiers' },
          { id: selectedChantier.id, name: selectedChantier.name },
        ],
      };
      setActiveTarget(target);
      saveActiveTarget(target);
      setRecentTargets(loadRecentTargets());
    }
    setActiveTab('camera');
  };

  const totalCount = photos.length;

  const sessionPhotosForActiveFolder = activeTarget
    ? photos.filter((p) => p.folderId === activeTarget.id)
    : [];

  return (
    <div className="min-h-[100dvh] w-full max-w-full overflow-x-clip flex flex-col bg-slate-100 text-slate-950">
      {/* Top Bar — 3-Zone Contract on Desktop, Compact 52px Header on Mobile */}
      <header className="sticky top-0 z-30 h-[52px] md:h-16 w-full bg-white/95 backdrop-blur-md border-b border-slate-300 px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4 md:gap-8">
        {/* Zone 1: Brand Title — clicking always opens Accueil */}
        <a
          href="./"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('home');
          }}
          className="inline-flex items-center gap-2 text-base sm:text-lg font-bold tracking-tight text-slate-950 whitespace-nowrap min-w-0 font-display"
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
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-700">
          <button
            type="button"
            onClick={() => setActiveTab('home')}
            className={`whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              activeTab === 'home'
                ? 'text-slate-950 font-semibold underline decoration-amber-500 decoration-2 underline-offset-8'
                : 'hover:text-slate-950'
            }`}
          >
            Accueil
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('folders')}
            className={`whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              activeTab === 'folders'
                ? 'text-slate-950 font-semibold underline decoration-amber-500 decoration-2 underline-offset-8'
                : 'hover:text-slate-950'
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
                : 'hover:text-slate-950'
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
                : 'hover:text-slate-950'
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

      {/* Chantier Tabs Bar — always visible except during Camera capture; only this bar scrolls horizontally */}
      {activeTab !== 'camera' && (
        <div className="w-full max-w-full overflow-hidden bg-white border-b border-slate-200">
          <div className="mx-auto w-full max-w-6xl px-3 sm:px-6 py-2 flex items-center gap-2 overflow-x-auto no-scrollbar touch-pan-x">
            {activeTab === 'queue' && rootChantiers.length > 0 && (
              <button
                type="button"
                onClick={() => setTransferScope('all')}
                className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  transferScope === 'all'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Tous</span>
                <span className="tabular-nums opacity-80">({totalCount})</span>
              </button>
            )}

            {rootChantiers.map((chantier) => {
              const count = countPhotosForChantier(chantier.id);
              const isSelected =
                activeTab === 'queue'
                  ? transferScope === 'chantier' && selectedChantier?.id === chantier.id
                  : activeTab === 'folders' && selectedChantier?.id === chantier.id;

              return (
                <button
                  key={chantier.id}
                  type="button"
                  onClick={() => {
                    setSelectedChantierId(chantier.id);
                    if (activeTab === 'queue') {
                      setTransferScope('chantier');
                    } else if (activeTab === 'home') {
                      setActiveTab('folders');
                    }
                  }}
                  className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
                  }`}
                >
                  <span className="max-w-[140px] truncate">{chantier.name}</span>
                  <span className="tabular-nums opacity-80">({count})</span>
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => setCreatingChantierTab((v) => !v)}
              className="min-h-[38px] px-3 rounded-xl border border-dashed border-slate-300 text-slate-700 text-xs font-semibold hover:border-amber-500 hover:text-slate-950 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FolderPlus className="w-3.5 h-3.5 text-amber-600" />
              <span>Nouveau chantier</span>
            </button>
          </div>

          {creatingChantierTab && (
            <form
              onSubmit={handleCreateChantierTab}
              className="mx-auto w-full max-w-6xl px-3 sm:px-6 pb-3 pt-1 flex flex-col sm:flex-row gap-2"
            >
              <input
                type="text"
                value={newChantierName}
                onChange={(e) => setNewChantierName(e.target.value)}
                placeholder="Nom du nouveau chantier (ex: Villa Martin, Résidence Parc)..."
                autoFocus
                className="flex-1 min-w-0 min-h-[42px] px-3.5 rounded-xl border border-slate-300 bg-slate-50 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="submit"
                  disabled={!newChantierName.trim()}
                  className="min-h-[42px] px-4 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                >
                  Créer l’onglet
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreatingChantierTab(false);
                    setNewChantierName('');
                  }}
                  className="min-h-[42px] px-3 rounded-xl border border-slate-300 bg-white text-slate-700 text-xs font-medium hover:bg-slate-50 cursor-pointer"
                >
                  Annuler
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Main Workspace */}
      <main className="flex-1 w-full max-w-full min-w-0 flex flex-col">
        <div className="flex-1 w-full max-w-full min-w-0">
          {activeTab === 'home' && (
            <HomeDashboard
              rootChantiers={rootChantiers}
              allFolders={allFolders}
              photos={photos}
              storage={storageQuota}
              onOpenChantierFolders={(chantierId) => {
                setSelectedChantierId(chantierId);
                setActiveTab('folders');
              }}
              onLaunchCameraForChantier={handleLaunchCameraForChantier}
              onOpenTransfer={(scope, chantierId) => {
                if (chantierId) setSelectedChantierId(chantierId);
                setTransferScope(scope);
                setActiveTab('queue');
              }}
              onOpenCreateChantier={() => setCreatingChantierTab(true)}
            />
          )}

          {activeTab === 'folders' && (
            <FolderExplorer
              allFolders={allFolders}
              rootChantiers={rootChantiers}
              selectedChantier={selectedChantier}
              activeTarget={activeTarget}
              recentTargets={recentTargets}
              photos={photos}
              onSelectTarget={handleSelectTarget}
              onImportGalleryFiles={handleImportGalleryFiles}
              onDeletePhoto={handleDeletePhoto}
              onDeletePhotosBatch={handleDeletePhotosBatch}
              onFoldersChanged={refreshFolders}
              onFoldersDeleted={handleFoldersDeleted}
              onOpenCreateChantier={() => setCreatingChantierTab(true)}
              onOpenTransfer={(scope) => {
                setTransferScope(scope);
                setActiveTab('queue');
              }}
              onFeedback={showToast}
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
              allFolders={allFolders}
              selectedChantier={selectedChantier}
              transferScope={transferScope}
              onChangeTransferScope={setTransferScope}
              isOnline={isOnline}
              pendingPcAck={pendingPcAck}
              onStartWaitingPcAck={setPendingPcAck}
              onConfirmPcAck={handleConfirmPcAck}
              onDeletePhoto={handleDeletePhoto}
              onDeletePhotosBatch={handleDeletePhotosBatch}
              onFeedback={showToast}
            />
          )}
        </div>

        {/* Quiet Signature Footer */}
        <footer className="mx-auto w-full max-w-6xl px-4 sm:px-6 pt-2 pb-20 md:pb-6 text-center md:text-right text-xs text-slate-500">
          ChantierShot · F.Pirquin
        </footer>
      </main>

      {/* Mobile Bottom Thumb-Zone Tab Bar (56px, within 15% combined sticky height cap) */}
      <nav
        aria-label="Navigation principale mobile"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-300 pb-safe"
      >
        <div className="grid grid-cols-4 h-14 items-center">
          <button
            type="button"
            onClick={() => setActiveTab('home')}
            className={`h-full flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
              activeTab === 'home' ? 'text-slate-950 font-bold' : 'text-slate-600'
            }`}
          >
            <Home
              className={`w-5 h-5 ${activeTab === 'home' ? 'text-amber-600' : ''}`}
            />
            <span className="text-[11px] font-medium tracking-tight">Accueil</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('folders')}
            className={`h-full flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
              activeTab === 'folders' ? 'text-slate-950 font-bold' : 'text-slate-600'
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
            className={`h-full flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
              activeTab === 'camera' ? 'text-slate-950 font-bold' : 'text-slate-600'
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
            className={`h-full flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
              activeTab === 'queue' ? 'text-slate-950 font-bold' : 'text-slate-600'
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
