import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
  Camera,
  ChevronRight,
  Folder,
  FolderPlus,
  Home,
  Loader2,
  Trash2,
} from 'lucide-react';
import {
  BreadcrumbSegment,
  LocalFolderRecord,
  QueuedPhoto,
  TargetFolder,
} from '../types';
import {
  createLocalFolder,
  deleteLocalFolderRecursive,
  getLocalFoldersByParent,
} from '../lib/storage';

interface FolderExplorerProps {
  activeTarget: TargetFolder | null;
  recentTargets: TargetFolder[];
  photos: QueuedPhoto[];
  onSelectTarget: (target: TargetFolder, launchCamera?: boolean) => void;
  onOpenTransfer: () => void;
}

export const FolderExplorer: React.FC<FolderExplorerProps> = ({
  activeTarget,
  recentTargets,
  photos,
  onSelectTarget,
  onOpenTransfer,
}) => {
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbSegment[]>([
    { id: 'root', name: 'Mes chantiers' },
  ]);
  const [folders, setFolders] = useState<LocalFolderRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [submittingFolder, setSubmittingFolder] = useState(false);

  const currentFolder = breadcrumbs[breadcrumbs.length - 1];

  const loadFolder = useCallback(async (folderId: string) => {
    setLoading(true);
    setError(null);
    try {
      const subFolders = await getLocalFoldersByParent(folderId);
      setFolders(subFolders);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de lecture des dossiers.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFolder(currentFolder.id);
  }, [currentFolder.id, loadFolder]);

  const enterFolder = (folder: LocalFolderRecord) => {
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
        pathSegments: breadcrumbs,
      },
      launchCamera
    );
  };

  const handleSelectChild = (folder: LocalFolderRecord, launchCamera: boolean) => {
    const nextSegments = [...breadcrumbs, { id: folder.id, name: folder.name }];
    onSelectTarget(
      {
        id: folder.id,
        name: folder.name,
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
      await createLocalFolder(currentFolder.id, trimmed);
      setNewFolderName('');
      setCreatingFolder(false);
      await loadFolder(currentFolder.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la création.');
    } finally {
      setSubmittingFolder(false);
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    await deleteLocalFolderRecursive(folderId);
    await loadFolder(currentFolder.id);
  };

  const photosInCurrent = photos.filter((p) => p.folderId === currentFolder.id);

  const countPhotosInSubtree = (folderId: string, folderName: string) => {
    const prefixSegments = breadcrumbs
      .filter((b) => b.id !== 'root')
      .map((b) => b.name.trim());
    prefixSegments.push(folderName.trim());
    const expectedPrefix = prefixSegments.join(' / ');

    return photos.filter(
      (p) =>
        p.folderId === folderId ||
        p.folderPath === expectedPrefix ||
        p.folderPath.startsWith(`${expectedPrefix} / `)
    ).length;
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-4 sm:py-5">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Main Folder Browser Column */}
        <div className="lg:col-span-8 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-lg font-semibold text-slate-900">
              Dossiers de chantier
            </h1>

            <button
              type="button"
              onClick={() => setCreatingFolder((v) => !v)}
              className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-slate-800 text-xs font-semibold hover:bg-slate-50 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FolderPlus className="w-4 h-4 text-amber-600" />
              <span>Nouveau dossier</span>
            </button>
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
                placeholder="Ex: Chantier Martin, Lot Électricité, Étage 2..."
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

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          )}

          {/* Folder List */}
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-4">
              <div className="text-xs font-medium text-slate-500 tabular-nums">
                {folders.length} dossier{folders.length > 1 ? 's' : ''}
                {photosInCurrent.length > 0 && (
                  <>
                    <span className="mx-1.5">·</span>
                    {photosInCurrent.length} photo{photosInCurrent.length > 1 ? 's' : ''} ici
                  </>
                )}
              </div>
              {breadcrumbs.length > 1 && (
                <button
                  type="button"
                  onClick={() => handleSelectCurrent(true)}
                  className="min-h-[36px] px-3 rounded-lg bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>Photographier ici</span>
                </button>
              )}
            </div>

            {loading ? (
              <div className="py-12 flex items-center justify-center gap-2 text-sm text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Chargement des dossiers...</span>
              </div>
            ) : folders.length === 0 ? (
              <div className="py-12 px-4 text-center space-y-3">
                <p className="text-sm font-medium text-slate-800">
                  Aucun sous-dossier ici pour le moment.
                </p>
                <p className="text-xs text-slate-500">
                  Créez un sous-dossier (ex: Sous-sol, Cuisine, Tableau) ou prenez directement vos photos ici.
                </p>
                <button
                  type="button"
                  onClick={() => handleSelectCurrent(true)}
                  className="min-h-[44px] px-4 rounded-xl bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400 inline-flex items-center gap-2 cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  <span>Prendre des photos dans « {currentFolder.name} »</span>
                </button>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {folders.map((folder) => {
                  const isActive = activeTarget?.id === folder.id;
                  const queuedCount = countPhotosInSubtree(folder.id, folder.name);

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
                          {queuedCount > 0 && (
                            <span className="block text-xs text-slate-500 tabular-nums">
                              {queuedCount} photo{queuedCount > 1 ? 's' : ''}
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
                          <span>Photos</span>
                        </button>
                        {queuedCount === 0 && (
                          <button
                            type="button"
                            onClick={() => handleDeleteFolder(folder.id)}
                            aria-label={`Supprimer ${folder.name}`}
                            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
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
              </ul>
            )}
          </div>
        </div>

        {/* Right Sidebar */}
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
                </>
              ) : (
                <p className="mt-1 text-sm text-slate-600">
                  Sélectionnez un chantier ou sous-dossier pour commencer vos photos.
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
                  ? 'Prendre des photos'
                  : `Utiliser « ${currentFolder.name} »`}
              </span>
            </button>
          </div>

          {/* Photos Ready for PC Transfer */}
          {photos.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">
                  Prêt pour le PC boulot
                </h3>
                <span className="text-xs font-mono font-semibold text-amber-700 tabular-nums">
                  {photos.length} photo{photos.length > 1 ? 's' : ''}
                </span>
              </div>
              <p className="text-xs text-slate-600">
                Transférez vos photos déjà classées vers votre PC puis supprimez-les automatiquement de l’appli.
              </p>
              <button
                type="button"
                onClick={onOpenTransfer}
                className="w-full min-h-[44px] px-4 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Transférer vers le PC</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Recent Sites for 1-Tap Arrival */}
          {recentTargets.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Derniers chantiers utilisés
              </h3>
              <ul className="divide-y divide-slate-100">
                {recentTargets.map((target) => (
                  <li key={target.id} className="py-2 first:pt-0 last:pb-0">
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
