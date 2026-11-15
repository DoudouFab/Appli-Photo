import React, { useCallback, useEffect, useState } from 'react';
import {
  Camera,
  ChevronRight,
  Cloud,
  Folder,
  FolderPlus,
  HardDrive,
  Home,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import {
  AuthStatus,
  BreadcrumbSegment,
  DriveFolderItem,
  QueuedPhoto,
  StorageSource,
  TargetFolder,
} from '../types';
import {
  createLocalFolder,
  formatBytes,
  getLocalFoldersByParent,
} from '../lib/storage';

interface FolderExplorerProps {
  authStatus: AuthStatus;
  activeTarget: TargetFolder | null;
  recentTargets: TargetFolder[];
  photos: QueuedPhoto[];
  onSelectTarget: (target: TargetFolder, launchCamera?: boolean) => void;
  onConnectOneDrive: () => void;
}

export const FolderExplorer: React.FC<FolderExplorerProps> = ({
  authStatus,
  activeTarget,
  recentTargets,
  photos,
  onSelectTarget,
  onConnectOneDrive,
}) => {
  const [source, setSource] = useState<StorageSource>(
    authStatus.authenticated ? 'onedrive' : 'local'
  );
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbSegment[]>([
    { id: 'root', name: authStatus.authenticated ? 'OneDrive' : 'Chantiers locaux' },
  ]);
  const [items, setItems] = useState<DriveFolderItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [submittingFolder, setSubmittingFolder] = useState(false);

  // Sync default source when authentication completes
  useEffect(() => {
    if (authStatus.authenticated && source === 'local' && !activeTarget) {
      setSource('onedrive');
      setBreadcrumbs([{ id: 'root', name: 'OneDrive' }]);
    }
  }, [authStatus.authenticated, activeTarget, source]);

  const currentFolder = breadcrumbs[breadcrumbs.length - 1];

  const loadFolder = useCallback(async (targetSource: StorageSource, folderId: string) => {
    setLoading(true);
    setError(null);

    try {
      if (targetSource === 'onedrive') {
        const res = await fetch(`/api/onedrive/children?folderId=${encodeURIComponent(folderId)}`);
        if (res.status === 401) {
          setError('Session OneDrive expirée. Reconnectez votre compte.');
          setItems([]);
          return;
        }
        if (!res.ok) {
          throw new Error('Impossible de charger ce dossier OneDrive.');
        }
        const data = (await res.json()) as {
          items: Array<{
            id: string;
            name: string;
            folder?: { childCount?: number };
            file?: { mimeType?: string };
            size?: number;
            lastModifiedDateTime?: string;
            webUrl?: string;
          }>;
        };

        const mapped: DriveFolderItem[] = data.items
          .filter((it) => Boolean(it.folder) || it.file?.mimeType?.startsWith('image/'))
          .map((it) => ({
            id: it.id,
            name: it.name,
            isFolder: Boolean(it.folder),
            childCount: it.folder?.childCount,
            size: it.size,
            lastModifiedDateTime: it.lastModifiedDateTime,
            webUrl: it.webUrl,
          }));
        setItems(mapped);
      } else {
        const subFolders = await getLocalFoldersByParent(folderId);
        const mapped: DriveFolderItem[] = subFolders.map((f) => ({
          id: f.id,
          name: f.name,
          isFolder: true,
        }));
        setItems(mapped);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de lecture du dossier.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (source === 'onedrive' && !authStatus.authenticated) {
      setItems([]);
      return;
    }
    loadFolder(source, currentFolder.id);
  }, [source, currentFolder.id, authStatus.authenticated, loadFolder]);

  const switchSource = (nextSource: StorageSource) => {
    if (nextSource === 'onedrive' && !authStatus.authenticated) {
      onConnectOneDrive();
      return;
    }
    setSource(nextSource);
    setBreadcrumbs([
      { id: 'root', name: nextSource === 'onedrive' ? 'OneDrive' : 'Chantiers locaux' },
    ]);
    setCreatingFolder(false);
  };

  const enterFolder = (folder: DriveFolderItem) => {
    if (!folder.isFolder) return;
    setBreadcrumbs((prev) => [...prev, { id: folder.id, name: folder.name }]);
    setCreatingFolder(false);
  };

  const jumpToBreadcrumb = (index: number) => {
    setBreadcrumbs((prev) => prev.slice(0, index + 1));
    setCreatingFolder(false);
  };

  const handleSelectCurrent = (launchCamera: boolean) => {
    onSelectTarget(
      {
        id: currentFolder.id,
        name: currentFolder.name,
        source,
        pathSegments: breadcrumbs,
      },
      launchCamera
    );
  };

  const handleSelectChild = (folder: DriveFolderItem, launchCamera: boolean) => {
    const nextSegments = [...breadcrumbs, { id: folder.id, name: folder.name }];
    onSelectTarget(
      {
        id: folder.id,
        name: folder.name,
        source,
        pathSegments: nextSegments,
      },
      launchCamera
    );
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newFolderName.trim();
    if (!trimmed) return;

    setSubmittingFolder(true);
    setError(null);
    try {
      if (source === 'onedrive') {
        const res = await fetch('/api/onedrive/folder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parentId: currentFolder.id, name: trimmed }),
        });
        if (!res.ok) throw new Error('Création du dossier OneDrive impossible.');
      } else {
        await createLocalFolder(currentFolder.id, trimmed);
      }
      setNewFolderName('');
      setCreatingFolder(false);
      await loadFolder(source, currentFolder.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la création.');
    } finally {
      setSubmittingFolder(false);
    }
  };

  const folderItems = items.filter((i) => i.isFolder);
  const photoItems = items.filter((i) => !i.isFolder);
  const localPhotosInCurrent = photos.filter(
    (p) => p.folderId === currentFolder.id && p.source === source
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-5 pb-32 lg:pb-10">
      {/* OneDrive Connection Status Banner when not authenticated */}
      {!authStatus.authenticated && (
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900">
              Connectez votre compte Microsoft OneDrive
            </h2>
            <p className="text-sm text-slate-600">
              Vos photos seront envoyées directement dans vos dossiers de chantier OneDrive sans encombrer la galerie du téléphone. En attendant, vous pouvez tester avec les dossiers locaux hors-ligne.
            </p>
          </div>
          <button
            type="button"
            onClick={onConnectOneDrive}
            className="min-h-[44px] px-4 py-2.5 rounded-xl bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Cloud className="w-4 h-4" />
            <span>Connecter OneDrive</span>
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Main Folder Browser Column */}
        <div className="lg:col-span-8 space-y-4">
          {/* Source Selector & Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-200/70">
              <button
                type="button"
                onClick={() => switchSource('onedrive')}
                className={`min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  source === 'onedrive'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Cloud className="w-4 h-4 text-sky-600" />
                <span>OneDrive</span>
              </button>
              <button
                type="button"
                onClick={() => switchSource('local')}
                className={`min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  source === 'local'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <HardDrive className="w-4 h-4 text-amber-600" />
                <span>Dossiers locaux</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCreatingFolder((v) => !v)}
                className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-slate-800 text-xs font-semibold hover:bg-slate-50 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FolderPlus className="w-4 h-4 text-amber-600" />
                <span>Nouveau dossier</span>
              </button>
              <button
                type="button"
                onClick={() => loadFolder(source, currentFolder.id)}
                disabled={loading}
                aria-label="Actualiser"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Breadcrumb Trail */}
          <nav
            aria-label="Fil d'Ariane des dossiers"
            className="flex items-center gap-1.5 overflow-x-auto py-2 px-3 rounded-xl bg-white border border-slate-200 text-sm"
          >
            {breadcrumbs.map((seg, idx) => {
              const isLast = idx === breadcrumbs.length - 1;
              return (
                <React.Fragment key={seg.id}>
                  {idx > 0 && <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
                  <button
                    type="button"
                    onClick={() => jumpToBreadcrumb(idx)}
                    className={`min-h-[36px] px-2 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                      isLast
                        ? 'font-semibold text-slate-900 bg-slate-100'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    {idx === 0 && <Home className="w-3.5 h-3.5" />}
                    <span className="max-w-[160px] truncate">{seg.name}</span>
                  </button>
                </React.Fragment>
              );
            })}
          </nav>

          {/* Inline Create Folder Form */}
          {creatingFolder && (
            <form
              onSubmit={handleCreateFolder}
              className="rounded-2xl border border-amber-300 bg-amber-50/50 p-4 flex flex-col sm:flex-row gap-3"
            >
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Ex: Lot 03 - Menuiserie ou Étage 2..."
                autoFocus
                className="flex-1 min-h-[44px] px-3.5 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="submit"
                  disabled={submittingFolder || !newFolderName.trim()}
                  className="min-h-[44px] px-4 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                >
                  {submittingFolder ? 'Création...' : 'Créer ici'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreatingFolder(false);
                    setNewFolderName('');
                  }}
                  className="min-h-[44px] px-3 rounded-xl border border-slate-300 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 cursor-pointer"
                >
                  Annuler
                </button>
              </div>
            </form>
          )}

          {/* Error Notice */}
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          )}

          {/* Folder List */}
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-4">
              <div className="text-xs font-medium text-slate-500">
                <span className="tabular-nums">{folderItems.length}</span> dossier
                {folderItems.length > 1 ? 's' : ''}
                {photoItems.length + localPhotosInCurrent.length > 0 && (
                  <>
                    <span className="mx-1.5">·</span>
                    <span className="tabular-nums">
                      {photoItems.length + localPhotosInCurrent.length}
                    </span>{' '}
                    photo{photoItems.length + localPhotosInCurrent.length > 1 ? 's' : ''}
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleSelectCurrent(true)}
                className="min-h-[36px] px-3 rounded-lg bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>Photographier dans « {currentFolder.name} »</span>
              </button>
            </div>

            {loading ? (
              <div className="py-12 flex items-center justify-center gap-2 text-sm text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Chargement des dossiers...</span>
              </div>
            ) : folderItems.length === 0 && photoItems.length === 0 ? (
              <div className="py-12 px-4 text-center space-y-2">
                <p className="text-sm font-medium text-slate-800">
                  Ce dossier est vide pour le moment.
                </p>
                <p className="text-xs text-slate-500">
                  Créez un sous-dossier (ex: Électricité, Plomberie) ou commencez directement à prendre des photos ici.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {folderItems.map((folder) => {
                  const isActive =
                    activeTarget?.id === folder.id && activeTarget?.source === source;
                  return (
                    <li
                      key={folder.id}
                      className={`flex items-center justify-between gap-2 px-3 sm:px-4 min-h-[60px] transition-colors ${
                        isActive ? 'bg-amber-50/70' : 'hover:bg-slate-50'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => enterFolder(folder)}
                        className="flex-1 min-w-0 min-h-[56px] flex items-center gap-3 text-left cursor-pointer py-2"
                      >
                        <span className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                          <Folder className="w-4 h-4 text-amber-600" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-slate-900 truncate">
                            {folder.name}
                          </span>
                          {typeof folder.childCount === 'number' && (
                            <span className="block text-xs text-slate-500 tabular-nums">
                              {folder.childCount} élément{folder.childCount > 1 ? 's' : ''}
                            </span>
                          )}
                        </span>
                      </button>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleSelectChild(folder, true)}
                          className="min-h-[40px] px-3 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-900 hover:text-white hover:border-slate-900 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                        >
                          <Camera className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Photos ici</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => enterFolder(folder)}
                          aria-label={`Ouvrir ${folder.name}`}
                          className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </li>
                  );
                })}

                {photoItems.map((img) => (
                  <li
                    key={img.id}
                    className="flex items-center justify-between gap-3 px-4 min-h-[52px] text-slate-600"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                        <ImageIcon className="w-4 h-4 text-slate-500" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-mono text-slate-800 truncate">{img.name}</div>
                        <div className="text-xs text-slate-500 tabular-nums">
                          {img.size ? formatBytes(img.size) : ''}
                        </div>
                      </div>
                    </div>
                    {img.webUrl && (
                      <a
                        href={img.webUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-medium text-sky-700 hover:underline whitespace-nowrap shrink-0"
                      >
                        Ouvrir
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right Sidebar / Summary Panel on Desktop + Quick Shortcuts */}
        <aside className="lg:col-span-4 space-y-5">
          {/* Active Destination Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
            <div>
              <div className="text-xs font-medium text-slate-500">Destination active</div>
              {activeTarget ? (
                <>
                  <h3 className="mt-1 text-lg font-semibold text-slate-900">
                    {activeTarget.name}
                  </h3>
                  <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                    {activeTarget.pathSegments.map((s) => s.name).join(' / ')}
                  </p>
                  <div className="mt-2 text-xs text-slate-500">
                    Stockage : {activeTarget.source === 'onedrive' ? 'Microsoft OneDrive' : 'Local hors-ligne'}
                  </div>
                </>
              ) : (
                <p className="mt-1 text-sm text-slate-600">
                  Aucun dossier sélectionné. Choisissez un chantier ou sous-dossier ci-contre.
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() =>
                activeTarget
                  ? onSelectTarget(activeTarget, true)
                  : handleSelectCurrent(true)
              }
              className="w-full min-h-[48px] px-4 rounded-xl bg-amber-500 text-slate-950 text-sm font-semibold hover:bg-amber-400 active:scale-[0.98] transition-all inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <Camera className="w-4 h-4" />
              <span>
                {activeTarget
                  ? 'Ouvrir l’appareil photo'
                  : `Utiliser « ${currentFolder.name} »`}
              </span>
            </button>
          </div>

          {/* Recent Sites for 1-Tap Arrival */}
          {recentTargets.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Derniers chantiers utilisés
              </h3>
              <ul className="divide-y divide-slate-100">
                {recentTargets.map((target) => (
                  <li key={`${target.source}_${target.id}`} className="py-2 first:pt-0 last:pb-0">
                    <button
                      type="button"
                      onClick={() => onSelectTarget(target, true)}
                      className="w-full min-h-[44px] flex items-center justify-between gap-2 text-left rounded-lg px-2 hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-900 truncate">
                          {target.name}
                        </div>
                        <div className="text-xs text-slate-500 truncate">
                          {target.pathSegments.map((s) => s.name).join(' / ')}
                        </div>
                      </div>
                      <Camera className="w-4 h-4 text-amber-600 shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};
