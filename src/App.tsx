import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  Cloud,
  FolderTree,
  ListChecks,
  LogOut,
  WifiOff,
} from 'lucide-react';
import {
  AuthStatus,
  CaptureSettings,
  QueuedPhoto,
  TargetFolder,
} from './types';
import {
  clearSyncedPhotos,
  deletePhotoRecord,
  getAllPhotos,
  loadActiveTarget,
  loadCaptureSettings,
  loadRecentTargets,
  saveActiveTarget,
  saveCaptureSettings,
  savePhotoRecord,
} from './lib/storage';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OneDriveSetupModal } from './components/OneDriveSetupModal';
import { FolderExplorer } from './components/FolderExplorer';
import { CameraViewfinder } from './components/CameraViewfinder';
import { UploadQueue } from './components/UploadQueue';

type ActiveTab = 'folders' | 'camera' | 'queue';

export function App() {
  const isOnline = useOnlineStatus();

  const [authStatus, setAuthStatus] = useState<AuthStatus>({
    configured: false,
    authenticated: false,
    user: null,
    redirectUri:
      typeof window !== 'undefined'
        ? `${window.location.origin}/auth/callback`
        : '/auth/callback',
  });

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
  const [setupModalOpen, setSetupModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const uploadingIdsRef = useRef<Set<string>>(new Set());

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((curr) => (curr === msg ? null : curr));
    }, 3500);
  }, []);

  const refreshAuthStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/status');
      if (!res.ok) return;
      const data = (await res.json()) as AuthStatus;
      setAuthStatus(data);
    } catch {
      // Offline or server unreachable
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
    refreshAuthStatus();
    loadStoredPhotos();
  }, [refreshAuthStatus, loadStoredPhotos]);

  // Listen for OAuth popup completion
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin;
      if (
        !origin.endsWith('.run.app') &&
        !origin.includes('localhost') &&
        origin !== window.location.origin
      ) {
        return;
      }
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        refreshAuthStatus();
        showToast('Compte OneDrive connecté.');
      } else if (event.data?.type === 'OAUTH_AUTH_ERROR') {
        showToast('Échec de la connexion Microsoft OneDrive.');
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [refreshAuthStatus, showToast]);

  const handleConnectOneDrive = async () => {
    try {
      const res = await fetch('/api/auth/url');
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        if (err.error === 'MICROSOFT_NOT_CONFIGURED') {
          setSetupModalOpen(true);
          return;
        }
        showToast('Impossible de démarrer la connexion OneDrive.');
        return;
      }
      const { url } = (await res.json()) as { url: string };
      const popup = window.open(url, 'onedrive_oauth_popup', 'width=600,height=720');
      if (!popup) {
        showToast('Autorisez les fenêtres pop-up pour connecter OneDrive.');
      }
    } catch {
      showToast('Erreur réseau lors de la connexion à OneDrive.');
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setAuthStatus((prev) => ({ ...prev, authenticated: false, user: null }));
    if (activeTarget?.source === 'onedrive') {
      setActiveTarget(null);
      saveActiveTarget(null);
    }
    showToast('Déconnecté de OneDrive.');
  };

  const uploadSinglePhoto = useCallback(
    async (photo: QueuedPhoto) => {
      if (uploadingIdsRef.current.has(photo.id)) return;
      if (!authStatus.authenticated || !isOnline) return;

      uploadingIdsRef.current.add(photo.id);
      const uploadingState: QueuedPhoto = {
        ...photo,
        status: 'uploading',
        errorMessage: undefined,
      };
      setPhotos((prev) => prev.map((p) => (p.id === photo.id ? uploadingState : p)));
      await savePhotoRecord(uploadingState);

      try {
        const targetParentId = photo.source === 'onedrive' ? photo.folderId : 'root';
        const res = await fetch('/api/onedrive/upload', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Parent-Id': encodeURIComponent(targetParentId),
            'X-File-Name': encodeURIComponent(photo.filename),
            'X-Content-Type': photo.blob.type || 'image/jpeg',
          },
          body: photo.blob,
        });

        if (!res.ok) {
          const errData = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(errData.error || `Erreur HTTP ${res.status}`);
        }

        const data = (await res.json()) as { item?: { webUrl?: string } };
        const syncedPhoto: QueuedPhoto = {
          ...photo,
          status: 'synced',
          source: 'onedrive',
          webUrl: data.item?.webUrl,
          errorMessage: undefined,
        };

        if (settings.autoPurgeAfterSync) {
          // Keep entry briefly without bloating long-term disk cache by removing old synced ones later;
          // save synced state so user sees immediate confirmation in Queue.
          await savePhotoRecord(syncedPhoto);
        } else {
          await savePhotoRecord(syncedPhoto);
        }

        setPhotos((prev) => prev.map((p) => (p.id === photo.id ? syncedPhoto : p)));
      } catch (err) {
        const errorPhoto: QueuedPhoto = {
          ...photo,
          status: 'error',
          errorMessage: err instanceof Error ? err.message : 'Échec du transfert',
        };
        await savePhotoRecord(errorPhoto);
        setPhotos((prev) => prev.map((p) => (p.id === photo.id ? errorPhoto : p)));
      } finally {
        uploadingIdsRef.current.delete(photo.id);
      }
    },
    [authStatus.authenticated, isOnline, settings.autoPurgeAfterSync]
  );

  // Auto-sync pending OneDrive photos when coming back online
  useEffect(() => {
    if (!isOnline || !authStatus.authenticated) return;
    const pendingOneDrive = photos.filter(
      (p) => p.source === 'onedrive' && p.status === 'pending'
    );
    pendingOneDrive.forEach((photo) => {
      uploadSinglePhoto(photo);
    });
  }, [isOnline, authStatus.authenticated, photos, uploadSinglePhoto]);

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
    const pathLabel = activeTarget.pathSegments.map((s) => s.name).join(' / ');
    const newPhoto: QueuedPhoto = {
      id: `ph_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      filename,
      blob,
      size: blob.size,
      capturedAt: Date.now(),
      folderId: activeTarget.id,
      folderPath: pathLabel,
      source: activeTarget.source,
      status: 'pending',
    };

    await savePhotoRecord(newPhoto);
    setPhotos((prev) => [newPhoto, ...prev]);

    if (activeTarget.source === 'onedrive' && authStatus.authenticated && isOnline) {
      uploadSinglePhoto(newPhoto);
    }
  };

  const handleSyncAll = async () => {
    if (!authStatus.authenticated || !isOnline) return;
    const toSync = photos.filter((p) => p.status === 'pending' || p.status === 'error');
    for (const photo of toSync) {
      await uploadSinglePhoto(photo);
    }
  };

  const handleRetryPhoto = async (id: string) => {
    const found = photos.find((p) => p.id === id);
    if (found) await uploadSinglePhoto(found);
  };

  const handleDeletePhoto = async (id: string) => {
    await deletePhotoRecord(id);
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  };

  const handleClearSynced = async () => {
    await clearSyncedPhotos();
    setPhotos((prev) => prev.filter((p) => p.status !== 'synced'));
  };

  const pendingCount = photos.filter(
    (p) => p.status === 'pending' || p.status === 'uploading' || p.status === 'error'
  ).length;

  const sessionPhotosForActiveFolder = activeTarget
    ? photos.filter(
        (p) => p.folderId === activeTarget.id && p.source === activeTarget.source
      )
    : [];

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Bar — 3-Zone Contract on Desktop, Compact 52px Header on Mobile */}
      <header className="sticky top-0 z-30 h-[52px] md:h-16 bg-white/90 backdrop-blur-md border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 md:gap-8">
        {/* Zone 1: Brand Title */}
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('folders');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 font-display"
        >
          ChantierShot
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
            File d’envoi{pendingCount > 0 ? ` (${pendingCount})` : ''}
          </button>
        </nav>

        {/* Zone 3: Primary Action */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden sm:block">
            <PWAInstallButton />
          </div>
          {authStatus.authenticated ? (
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline text-xs font-medium text-slate-600 max-w-[160px] truncate">
                {authStatus.user?.displayName || authStatus.user?.mail || 'OneDrive'}
              </span>
              <button
                type="button"
                onClick={handleLogout}
                aria-label="Déconnecter OneDrive"
                className="min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Déconnexion</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleConnectOneDrive}
              className="min-h-[40px] px-3.5 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Cloud className="w-3.5 h-3.5 text-sky-400" />
              <span>Connecter OneDrive</span>
            </button>
          )}
        </div>
      </header>

      {/* Real Connectivity Banner (only shown when offline) */}
      {!isOnline && (
        <div className="bg-amber-500 text-slate-950 px-4 py-2 text-xs font-semibold flex items-center justify-center gap-2">
          <WifiOff className="w-4 h-4 shrink-0" />
          <span>
            Mode hors-ligne : vos photos sont sécurisées localement et partiront sur OneDrive dès le retour du réseau.
          </span>
        </div>
      )}

      {/* Main Workspace */}
      <main className="flex-1">
        {activeTab === 'folders' && (
          <FolderExplorer
            authStatus={authStatus}
            activeTarget={activeTarget}
            recentTargets={recentTargets}
            photos={photos}
            onSelectTarget={handleSelectTarget}
            onConnectOneDrive={handleConnectOneDrive}
          />
        )}

        {activeTab === 'camera' && (
          <CameraViewfinder
            activeTarget={activeTarget}
            settings={settings}
            recentSessionPhotos={sessionPhotosForActiveFolder}
            onUpdateSettings={handleUpdateSettings}
            onPhotoCaptured={handlePhotoCaptured}
            onChangeFolder={() => setActiveTab('folders')}
            onOpenQueue={() => setActiveTab('queue')}
          />
        )}

        {activeTab === 'queue' && (
          <UploadQueue
            photos={photos}
            authStatus={authStatus}
            isOnline={isOnline}
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            onSyncAll={handleSyncAll}
            onRetryPhoto={handleRetryPhoto}
            onDeletePhoto={handleDeletePhoto}
            onClearSynced={handleClearSynced}
            onConnectOneDrive={handleConnectOneDrive}
          />
        )}
      </main>

      {/* Mobile Bottom Thumb-Zone Tab Bar (64px, fits within 15% combined sticky height cap) */}
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
              File{pendingCount > 0 ? ` (${pendingCount})` : ''}
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

      <OneDriveSetupModal
        open={setupModalOpen}
        redirectUri={authStatus.redirectUri}
        onClose={() => setSetupModalOpen(false)}
      />
    </div>
  );
}

export default App;
