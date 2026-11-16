import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Camera,
  Check,
  ChevronRight,
  Folder,
  FolderPlus,
  ImagePlus,
  Layers,
  Loader2,
  Share2,
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
  deleteAllLocalFolders,
  deleteLocalFolderRecursive,
  formatBytes,
  getDescendantIdsFromList,
} from '../lib/storage';
import { sharePhotosNativeOrDownload } from '../lib/share';
import { PhotoViewerModal } from './PhotoViewerModal';

interface FolderPhotoTileProps {
  photo: QueuedPhoto;
  showFolderHint: boolean;
  selectionMode: boolean;
  isSelected: boolean;
  onClick: () => void;
}

const FolderPhotoTile: React.FC<FolderPhotoTileProps> = ({
  photo,
  showFolderHint,
  selectionMode,
  isSelected,
  onClick,
}) => {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(photo.blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [photo.blob]);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative aspect-square w-full rounded-xl overflow-hidden bg-slate-200 border text-left cursor-pointer transition-transform active:scale-[0.98] ${
        isSelected
          ? 'border-amber-500 ring-2 ring-amber-500'
          : 'border-slate-300 hover:border-slate-400'
      }`}
    >
      {url && (
        <img
          src={url}
          alt={photo.filename}
          loading="lazy"
          className="w-full h-full object-cover"
        />
      )}

      {selectionMode && (
        <span
          className={`absolute top-1.5 right-1.5 w-6 h-6 rounded-full border flex items-center justify-center ${
            isSelected
              ? 'bg-amber-500 border-amber-600 text-slate-950'
              : 'bg-slate-950/60 border-white/70 text-transparent'
          }`}
        >
          <Check className="w-3.5 h-3.5 stroke-[3]" />
        </span>
      )}

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/85 via-slate-950/40 to-transparent px-2 pt-4 pb-1.5">
        <div className="text-[10px] font-medium text-white truncate tabular-nums">
          {showFolderHint
            ? photo.folderPath
            : new Date(photo.capturedAt).toLocaleTimeString('fr-FR', {
                hour: '2-digit',
                minute: '2-digit',
              })}
        </div>
      </div>
    </button>
  );
};

interface FolderExplorerProps {
  allFolders: LocalFolderRecord[];
  rootChantiers: LocalFolderRecord[];
  selectedChantier: LocalFolderRecord | null;
  activeTarget: TargetFolder | null;
  recentTargets: TargetFolder[];
  photos: QueuedPhoto[];
  onSelectTarget: (target: TargetFolder, launchCamera?: boolean) => void;
  onImportGalleryFiles: (target: TargetFolder, files: File[]) => Promise<void>;
  onDeletePhoto: (id: string) => Promise<void>;
  onDeletePhotosBatch: (ids: string[]) => Promise<void>;
  onFoldersChanged: () => Promise<void>;
  onFoldersDeleted: (deletedIds: Set<string> | 'ALL', alsoDeletePhotos: boolean) => Promise<void>;
  onOpenCreateChantier: () => void;
  onOpenTransfer: (scope: 'all' | 'chantier') => void;
  onFeedback?: (message: string) => void;
}

export const FolderExplorer: React.FC<FolderExplorerProps> = ({
  allFolders,
  rootChantiers,
  selectedChantier,
  activeTarget,
  recentTargets,
  photos,
  onSelectTarget,
  onImportGalleryFiles,
  onDeletePhoto,
  onDeletePhotosBatch,
  onFoldersChanged,
  onFoldersDeleted,
  onOpenCreateChantier,
  onOpenTransfer,
  onFeedback,
}) => {
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const [importingGallery, setImportingGallery] = useState(false);
  const [photoScopeMode, setPhotoScopeMode] = useState<'auto' | 'here' | 'tree'>('auto');
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set());
  const [confirmDeleteSelected, setConfirmDeleteSelected] = useState(false);
  const [sharingSelection, setSharingSelection] = useState(false);

  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbSegment[]>(() =>
    selectedChantier
      ? [
          { id: 'root', name: 'Mes chantiers' },
          { id: selectedChantier.id, name: selectedChantier.name },
        ]
      : [{ id: 'root', name: 'Mes chantiers' }]
  );
  const [error, setError] = useState<string | null>(null);

  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [submittingFolder, setSubmittingFolder] = useState(false);

  const [confirmDeleteFolderId, setConfirmDeleteFolderId] = useState<string | null>(null);
  const [confirmDeleteChantier, setConfirmDeleteChantier] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [deleteAllChecked, setDeleteAllChecked] = useState(false);

  // Sync breadcrumbs whenever user clicks a different Chantier tab
  useEffect(() => {
    setCreatingFolder(false);
    setConfirmDeleteFolderId(null);
    setConfirmDeleteChantier(false);
    setConfirmDeleteAll(false);
    setDeleteAllChecked(false);
    setSelectionMode(false);
    setSelectedPhotoIds(new Set());
    setConfirmDeleteSelected(false);
    setViewerIndex(null);
    setPhotoScopeMode('auto');
    if (selectedChantier) {
      setBreadcrumbs([
        { id: 'root', name: 'Mes chantiers' },
        { id: selectedChantier.id, name: selectedChantier.name },
      ]);
    } else {
      setBreadcrumbs([{ id: 'root', name: 'Mes chantiers' }]);
    }
  }, [selectedChantier?.id, selectedChantier?.name]);

  const currentFolder = breadcrumbs[breadcrumbs.length - 1];
  const visibleBreadcrumbs = breadcrumbs.filter((b) => b.id !== 'root');

  const folders = useMemo(
    () =>
      allFolders
        .filter((f) => f.parentId === currentFolder.id)
        .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' })),
    [allFolders, currentFolder.id]
  );

  const countPhotosInFolderTree = useCallback(
    (folderId: string): number => {
      if (folderId === 'root') return photos.length;
      const ids = getDescendantIdsFromList(allFolders, folderId);
      return photos.filter((p) => ids.has(p.folderId)).length;
    },
    [allFolders, photos]
  );

  const enterFolder = (folder: LocalFolderRecord) => {
    setBreadcrumbs((prev) => [...prev, { id: folder.id, name: folder.name }]);
    setCreatingFolder(false);
    setConfirmDeleteFolderId(null);
    setSelectionMode(false);
    setSelectedPhotoIds(new Set());
    setConfirmDeleteSelected(false);
    setPhotoScopeMode('auto');
  };

  const jumpToBreadcrumb = (visibleIdx: number) => {
    // visibleBreadcrumbs skips 'root' at index 0 of breadcrumbs
    setBreadcrumbs((prev) => prev.slice(0, visibleIdx + 2));
    setCreatingFolder(false);
    setConfirmDeleteFolderId(null);
    setSelectionMode(false);
    setSelectedPhotoIds(new Set());
    setConfirmDeleteSelected(false);
    setPhotoScopeMode('auto');
  };

  const currentAsTarget: TargetFolder | null = selectedChantier
    ? {
        id: currentFolder.id,
        name: currentFolder.name,
        pathSegments: breadcrumbs,
      }
    : null;

  const effectiveTarget = activeTarget || currentAsTarget;

  const handleSelectCurrent = (launchCamera: boolean) => {
    if (!currentAsTarget) return;
    onSelectTarget(currentAsTarget, launchCamera);
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

  const handleCreateSubFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newFolderName.trim();
    if (!trimmed || !selectedChantier) return;

    setSubmittingFolder(true);
    setError(null);
    try {
      await createLocalFolder(currentFolder.id, trimmed);
      setNewFolderName('');
      setCreatingFolder(false);
      await onFoldersChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la création.');
    } finally {
      setSubmittingFolder(false);
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    const deletedIds = await deleteLocalFolderRecursive(folderId);
    setConfirmDeleteFolderId(null);
    setConfirmDeleteChantier(false);
    await onFoldersDeleted(deletedIds, true);
    await onFoldersChanged();
  };

  const handleDeleteAllFolders = async () => {
    await deleteAllLocalFolders();
    setConfirmDeleteAll(false);
    setConfirmDeleteChantier(false);
    setBreadcrumbs([{ id: 'root', name: 'Mes chantiers' }]);
    await onFoldersDeleted('ALL', true);
    await onFoldersChanged();
  };

  const totalPhotosHere = selectedChantier ? countPhotosInFolderTree(currentFolder.id) : 0;
  const selectedChantierPhotoCount = selectedChantier
    ? countPhotosInFolderTree(selectedChantier.id)
    : 0;
  const selectedChantierSubfolderCount = selectedChantier
    ? getDescendantIdsFromList(allFolders, selectedChantier.id).size - 1
    : 0;

  const directFolderPhotos = useMemo(
    () =>
      selectedChantier
        ? photos.filter((p) => p.folderId === currentFolder.id)
        : [],
    [photos, selectedChantier, currentFolder.id]
  );

  const treeFolderPhotos = useMemo(() => {
    if (!selectedChantier) return [];
    const ids = getDescendantIdsFromList(allFolders, currentFolder.id);
    return photos.filter((p) => ids.has(p.folderId));
  }, [allFolders, photos, selectedChantier, currentFolder.id]);

  const effectivePhotoScope: 'here' | 'tree' =
    photoScopeMode === 'auto'
      ? directFolderPhotos.length > 0 || treeFolderPhotos.length === 0
        ? 'here'
        : 'tree'
      : photoScopeMode;

  const displayedPhotos =
    effectivePhotoScope === 'tree' ? treeFolderPhotos : directFolderPhotos;

  const toggleSelectPhoto = (id: string) => {
    setSelectedPhotoIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSharePhotos = async (targetPhotos: QueuedPhoto[]) => {
    if (targetPhotos.length === 0) return;
    setSharingSelection(true);
    try {
      const outcome = await sharePhotosNativeOrDownload(
        targetPhotos,
        currentFolder.name
      );
      if (outcome.status === 'fallback_downloaded') {
        onFeedback?.(
          `${outcome.count} photo(s) téléchargée(s) — le partage direct WhatsApp/Messenger/Outlook s’ouvre sur smartphone.`
        );
      }
    } finally {
      setSharingSelection(false);
    }
  };

  // Empty state when no Chantier tabs exist yet
  if (!selectedChantier) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-10">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
            <FolderPlus className="w-7 h-7" />
          </div>
          <h1 className="text-xl font-semibold text-slate-900">
            Aucun onglet chantier créé
          </h1>
          <p className="text-sm text-slate-600 max-w-md mx-auto">
            Créez votre premier onglet chantier (ex : Villa Martin, Résidence Parc) pour y ranger plusieurs sous-dossiers et vos photos.
          </p>
          <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onOpenCreateChantier}
              className="min-h-[48px] px-5 rounded-xl bg-amber-500 text-slate-950 text-sm font-semibold hover:bg-amber-400 inline-flex items-center gap-2 cursor-pointer"
            >
              <FolderPlus className="w-4 h-4" />
              <span>Créer un chantier</span>
            </button>

            {photos.length > 0 && !confirmDeleteAll && (
              <button
                type="button"
                onClick={() => {
                  setDeleteAllChecked(false);
                  setConfirmDeleteAll(true);
                }}
                className="min-h-[48px] px-4 rounded-xl border border-red-200 text-red-600 text-xs font-semibold hover:bg-red-50 inline-flex items-center gap-2 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>Supprimer les {photos.length} photo(s) restante(s)</span>
              </button>
            )}
          </div>

          {confirmDeleteAll && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-left space-y-3">
              <div className="text-xs text-red-900">
                <strong>Vérification requise :</strong> supprimer définitivement les {photos.length} photo(s) restante(s) ?
              </div>
              <label className="flex items-center gap-2 text-xs text-red-900 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={deleteAllChecked}
                  onChange={(e) => setDeleteAllChecked(e.target.checked)}
                  className="w-4 h-4 rounded border-red-300 text-red-600 focus:ring-red-500"
                />
                <span>Je confirme la suppression définitive</span>
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!deleteAllChecked}
                  onClick={handleDeleteAllFolders}
                  className="min-h-[38px] px-3.5 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-40 cursor-pointer"
                >
                  Oui, tout supprimer
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmDeleteAll(false);
                    setDeleteAllChecked(false);
                  }}
                  className="min-h-[38px] px-3 rounded-xl border border-red-200 bg-white text-slate-700 text-xs font-medium hover:bg-slate-50 cursor-pointer"
                >
                  Annuler
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-3 sm:px-6 py-3 sm:py-5 overflow-x-clip">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-6 items-start">
        {/* Main Subfolder Browser Column for the Active Chantier Tab */}
        <div className="lg:col-span-8 space-y-3.5 sm:space-y-4 min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 min-w-0">
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-slate-950 truncate">
                {selectedChantier.name}
              </h1>
              <p className="text-xs text-slate-600 tabular-nums">
                {selectedChantierPhotoCount} photo{selectedChantierPhotoCount > 1 ? 's' : ''} au total dans ce chantier
                {selectedChantierSubfolderCount > 0 &&
                  ` · ${selectedChantierSubfolderCount} sous-dossier${selectedChantierSubfolderCount > 1 ? 's' : ''}`}
              </p>
            </div>

            <div className="w-full sm:w-auto flex flex-wrap items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={() => {
                  setConfirmDeleteAll(false);
                  setDeleteAllChecked(false);
                  setConfirmDeleteChantier(false);
                  setCreatingFolder((v) => !v);
                }}
                className="min-h-[42px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-slate-900 text-xs font-semibold hover:bg-slate-50 transition-colors inline-flex items-center gap-1.5 cursor-pointer"
              >
                <FolderPlus className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Nouveau sous-dossier</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setConfirmDeleteAll(false);
                  setConfirmDeleteChantier((v) => !v);
                }}
                className="min-h-[42px] px-3 py-2 rounded-xl border border-slate-200 bg-white text-red-600 text-xs font-semibold hover:bg-red-50 transition-colors inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                <span>Supprimer ce chantier</span>
              </button>

              {rootChantiers.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setConfirmDeleteChantier(false);
                    setDeleteAllChecked(false);
                    setConfirmDeleteAll((v) => !v);
                  }}
                  className="min-h-[42px] px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-medium hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                >
                  Tout supprimer
                </button>
              )}
            </div>
          </div>

          {confirmDeleteChantier && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs text-red-900">
                <strong>Supprimer l’onglet « {selectedChantier.name} » ?</strong> Cela effacera ses{' '}
                {selectedChantierSubfolderCount} sous-dossier(s) et ses {selectedChantierPhotoCount} photo(s).
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleDeleteFolder(selectedChantier.id)}
                  className="min-h-[38px] px-3.5 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700 cursor-pointer"
                >
                  Supprimer
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteChantier(false)}
                  className="min-h-[38px] px-3 rounded-xl border border-red-200 bg-white text-slate-700 text-xs font-medium hover:bg-slate-50 cursor-pointer"
                >
                  Annuler
                </button>
              </div>
            </div>
          )}

          {confirmDeleteAll && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 space-y-3">
              <div className="text-xs text-red-900">
                <strong>Vérification requise — Tout supprimer ?</strong> Cette action effacera définitivement les{' '}
                <strong>{rootChantiers.length}</strong> chantier(s), tous leurs sous-dossiers et{' '}
                <strong>{photos.length}</strong> photo(s).
              </div>
              <label className="flex items-center gap-2 text-xs text-red-900 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={deleteAllChecked}
                  onChange={(e) => setDeleteAllChecked(e.target.checked)}
                  className="w-4 h-4 rounded border-red-300 text-red-600 focus:ring-red-500"
                />
                <span>Je confirme vouloir tout supprimer définitivement</span>
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!deleteAllChecked}
                  onClick={handleDeleteAllFolders}
                  className="min-h-[38px] px-3.5 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-40 cursor-pointer"
                >
                  Oui, tout effacer
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmDeleteAll(false);
                    setDeleteAllChecked(false);
                  }}
                  className="min-h-[38px] px-3 rounded-xl border border-red-200 bg-white text-slate-700 text-xs font-medium hover:bg-slate-50 cursor-pointer"
                >
                  Annuler
                </button>
              </div>
            </div>
          )}

          {/* Breadcrumb Trail within the Selected Chantier */}
          {visibleBreadcrumbs.length > 1 && (
            <nav
              aria-label="Chemin dans le chantier"
              className="flex items-center gap-1.5 overflow-x-auto py-2 px-3 rounded-xl bg-white border border-slate-200 text-sm"
            >
              {visibleBreadcrumbs.map((seg, idx) => {
                const isLast = idx === visibleBreadcrumbs.length - 1;
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
                      <span className="max-w-[160px] truncate">{seg.name}</span>
                    </button>
                  </React.Fragment>
                );
              })}
            </nav>
          )}

          {/* Inline Create Subfolder Form */}
          {creatingFolder && (
            <form
              onSubmit={handleCreateSubFolder}
              className="rounded-2xl border border-amber-300 bg-amber-50/50 p-4 flex flex-col sm:flex-row gap-3"
            >
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder={`Sous-dossier dans « ${currentFolder.name} »...`}
                autoFocus
                className="flex-1 min-w-0 min-h-[44px] px-3.5 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
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

          {/* Subfolder List */}
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-3 sm:px-4 py-2.5 sm:py-3 border-b border-slate-100 flex items-center justify-between gap-2.5">
              <div className="min-w-0 flex-1 text-xs font-medium text-slate-500 tabular-nums truncate">
                {folders.length} sous-dossier{folders.length > 1 ? 's' : ''}
                <span className="mx-1.5">·</span>
                <span className="text-slate-700 font-semibold">
                  {totalPhotosHere} photo{totalPhotosHere > 1 ? 's' : ''}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleSelectCurrent(true)}
                className="min-h-[36px] px-2.5 sm:px-3 rounded-lg bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>Photographier ici</span>
              </button>
            </div>

            {folders.length === 0 ? (
              <div className="py-10 px-4 text-center space-y-3">
                <p className="text-sm font-medium text-slate-800">
                  Aucun sous-dossier dans « {currentFolder.name} » pour le moment.
                </p>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Ajoutez plusieurs sous-dossiers (ex : Gros œuvre, Électricité, Plomberie) ou prenez directement vos photos ici.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setCreatingFolder(true)}
                    className="min-h-[44px] px-4 rounded-xl border border-slate-300 bg-white text-slate-800 text-xs font-semibold hover:bg-slate-50 inline-flex items-center gap-2 cursor-pointer"
                  >
                    <FolderPlus className="w-4 h-4 text-amber-600" />
                    <span>Ajouter un sous-dossier</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectCurrent(true)}
                    className="min-h-[44px] px-4 rounded-xl bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400 inline-flex items-center gap-2 cursor-pointer"
                  >
                    <Camera className="w-4 h-4" />
                    <span>Prendre des photos ici</span>
                  </button>
                </div>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {folders.map((folder) => {
                  const isActive = activeTarget?.id === folder.id;
                  const queuedCount = countPhotosInFolderTree(folder.id);
                  const descendantCount = getDescendantIdsFromList(allFolders, folder.id).size - 1;
                  const needsConfirm = queuedCount > 0 || descendantCount > 0;
                  const isConfirming = confirmDeleteFolderId === folder.id;

                  return (
                    <li
                      key={folder.id}
                      className={`px-2.5 sm:px-4 min-w-0 transition-colors ${
                        isActive ? 'bg-amber-50/70' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5 sm:gap-2 min-h-[56px] min-w-0">
                        <button
                          type="button"
                          onClick={() => enterFolder(folder)}
                          className="flex-1 min-w-0 min-h-[52px] flex items-center gap-2.5 sm:gap-3 text-left cursor-pointer py-1.5"
                        >
                          <span className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                            <Folder className="w-4 h-4 text-amber-600" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-slate-900 truncate">
                              {folder.name}
                            </span>
                            <span className="block text-xs text-slate-500 tabular-nums truncate">
                              {queuedCount} photo{queuedCount > 1 ? 's' : ''}
                              {descendantCount > 0 &&
                                ` · ${descendantCount} sous-dossier${descendantCount > 1 ? 's' : ''}`}
                            </span>
                          </span>
                        </button>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleSelectChild(folder, true)}
                            className="min-h-[38px] px-2.5 sm:px-3 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-900 hover:text-white hover:border-slate-900 transition-colors inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
                          >
                            <Camera className="w-3.5 h-3.5" />
                            <span>Photos</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              needsConfirm
                                ? setConfirmDeleteFolderId(isConfirming ? null : folder.id)
                                : handleDeleteFolder(folder.id)
                            }
                            aria-label={`Supprimer ${folder.name}`}
                            className="min-h-[38px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => enterFolder(folder)}
                            aria-label={`Ouvrir ${folder.name}`}
                            className="min-h-[38px] min-w-[34px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {isConfirming && (
                        <div className="pb-3 pt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-red-900 bg-red-50/80 rounded-xl px-3 mb-2">
                          <span>
                            Supprimer « {folder.name} »
                            {descendantCount > 0 ? ` (${descendantCount} sous-dossier(s))` : ''}
                            {queuedCount > 0 ? ` et ses ${queuedCount} photo(s)` : ''} ?
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleDeleteFolder(folder.id)}
                              className="min-h-[32px] px-3 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 cursor-pointer"
                            >
                              Supprimer
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteFolderId(null)}
                              className="min-h-[32px] px-2.5 rounded-lg border border-red-200 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
                            >
                              Annuler
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Recorded Photos Browser for the Current Folder / Chantier */}
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-3 sm:px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-slate-950 truncate">
                  Photos dans « {currentFolder.name} » ({displayedPhotos.length})
                </h2>
                {displayedPhotos.length > 0 && (
                  <p className="text-[11px] text-slate-600 tabular-nums">
                    Touchez une photo pour l’agrandir, la partager ou la supprimer ·{' '}
                    {formatBytes(displayedPhotos.reduce((s, p) => s + p.size, 0))}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {treeFolderPhotos.length !== directFolderPhotos.length && (
                  <div className="flex items-center p-0.5 rounded-lg bg-slate-100 text-[11px] font-semibold">
                    <button
                      type="button"
                      onClick={() => {
                        setPhotoScopeMode('here');
                        setSelectedPhotoIds(new Set());
                      }}
                      className={`px-2 py-1 rounded-md cursor-pointer tabular-nums ${
                        effectivePhotoScope === 'here'
                          ? 'bg-white text-slate-950 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Ici ({directFolderPhotos.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPhotoScopeMode('tree');
                        setSelectedPhotoIds(new Set());
                      }}
                      className={`px-2 py-1 rounded-md cursor-pointer tabular-nums ${
                        effectivePhotoScope === 'tree'
                          ? 'bg-white text-slate-950 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Tout ({treeFolderPhotos.length})
                    </button>
                  </div>
                )}

                {displayedPhotos.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectionMode((v) => !v);
                      setSelectedPhotoIds(new Set());
                      setConfirmDeleteSelected(false);
                    }}
                    className={`min-h-[36px] px-2.5 rounded-lg border text-xs font-semibold cursor-pointer ${
                      selectionMode
                        ? 'bg-slate-900 border-slate-900 text-white'
                        : 'bg-white border-slate-300 text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    {selectionMode ? 'Terminer' : 'Sélectionner'}
                  </button>
                )}
              </div>
            </div>

            {selectionMode && displayedPhotos.length > 0 && (
              <div className="px-3 sm:px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 tabular-nums">
                  <span>{selectedPhotoIds.size} sélectionnée(s)</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedPhotoIds.size === displayedPhotos.length) {
                        setSelectedPhotoIds(new Set());
                      } else {
                        setSelectedPhotoIds(new Set(displayedPhotos.map((p) => p.id)));
                      }
                    }}
                    className="text-amber-700 hover:underline cursor-pointer"
                  >
                    {selectedPhotoIds.size === displayedPhotos.length
                      ? 'Tout décocher'
                      : 'Tout cocher'}
                  </button>
                </div>

                {selectedPhotoIds.size > 0 && !confirmDeleteSelected && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={sharingSelection}
                      onClick={() =>
                        handleSharePhotos(
                          displayedPhotos.filter((p) => selectedPhotoIds.has(p.id))
                        )
                      }
                      className="min-h-[38px] px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {sharingSelection ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Share2 className="w-3.5 h-3.5" />
                      )}
                      <span>Partager (WhatsApp / Outlook)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setConfirmDeleteSelected(true)}
                      className="min-h-[38px] px-3 rounded-xl border border-red-200 bg-white text-red-600 hover:bg-red-50 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Supprimer ({selectedPhotoIds.size})</span>
                    </button>
                  </div>
                )}

                {confirmDeleteSelected && selectedPhotoIds.size > 0 && (
                  <div className="w-full pt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-red-900">
                    <span>
                      Supprimer définitivement ces <strong>{selectedPhotoIds.size}</strong> photo(s) ?
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          await onDeletePhotosBatch(Array.from(selectedPhotoIds));
                          setSelectedPhotoIds(new Set());
                          setConfirmDeleteSelected(false);
                          setSelectionMode(false);
                          onFeedback?.('Photos sélectionnées supprimées.');
                        }}
                        className="min-h-[34px] px-3 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 cursor-pointer"
                      >
                        Oui, supprimer
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteSelected(false)}
                        className="min-h-[34px] px-3 rounded-lg border border-red-200 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {displayedPhotos.length === 0 ? (
              <div className="py-7 px-4 text-center text-xs text-slate-600">
                Aucune photo enregistrée dans ce dossier pour le moment.
              </div>
            ) : (
              <div className="p-2.5 sm:p-3 grid grid-cols-3 sm:grid-cols-4 gap-2 sm:gap-2.5">
                {displayedPhotos.map((photo, idx) => (
                  <FolderPhotoTile
                    key={photo.id}
                    photo={photo}
                    showFolderHint={effectivePhotoScope === 'tree'}
                    selectionMode={selectionMode}
                    isSelected={selectedPhotoIds.has(photo.id)}
                    onClick={() => {
                      if (selectionMode) {
                        toggleSelectPhoto(photo.id);
                      } else {
                        setViewerIndex(idx);
                      }
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Sidebar */}
        <aside className="lg:col-span-4 space-y-4 sm:space-y-5 min-w-0">
          {/* Active Destination Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
            <div>
              <div className="text-xs font-medium text-slate-500">Destination active</div>
              {effectiveTarget ? (
                <>
                  <h3 className="mt-1 text-lg font-semibold text-slate-900">
                    {effectiveTarget.name}
                  </h3>
                  <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                    {effectiveTarget.pathSegments
                      .filter((s) => s.id !== 'root')
                      .map((s) => s.name)
                      .join(' / ')}
                  </p>
                </>
              ) : null}
            </div>

            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() =>
                  effectiveTarget
                    ? onSelectTarget(effectiveTarget, true)
                    : handleSelectCurrent(true)
                }
                className="w-full min-h-[48px] px-4 rounded-xl bg-amber-500 text-slate-950 text-sm font-semibold hover:bg-amber-400 active:scale-[0.98] transition-all inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <Camera className="w-4 h-4" />
                <span>Prendre des photos</span>
              </button>

              <button
                type="button"
                disabled={importingGallery}
                onClick={() => {
                  if (!activeTarget && currentAsTarget) {
                    onSelectTarget(currentAsTarget, false);
                  }
                  galleryInputRef.current?.click();
                }}
                className="w-full min-h-[44px] px-4 rounded-xl border border-slate-300 bg-white text-slate-800 text-xs font-semibold hover:bg-slate-50 transition-colors inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {importingGallery ? (
                  <Loader2 className="w-4 h-4 animate-spin text-amber-600" />
                ) : (
                  <ImagePlus className="w-4 h-4 text-amber-600" />
                )}
                <span>
                  {importingGallery
                    ? 'Importation en cours...'
                    : 'Importer depuis la galerie téléphone'}
                </span>
              </button>

              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={async (e) => {
                  const files = e.target.files ? Array.from(e.target.files) : [];
                  e.target.value = '';
                  if (files.length === 0 || !effectiveTarget) return;
                  setImportingGallery(true);
                  try {
                    await onImportGalleryFiles(effectiveTarget, files);
                  } finally {
                    setImportingGallery(false);
                  }
                }}
                className="hidden"
              />
            </div>
          </div>

          {/* Per-Chantier or All-Chantiers Export / Transfer Shortcuts */}
          {photos.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Export ZIP / Transfert PC
              </h3>
              <p className="text-xs text-slate-600">
                Récupérez uniquement ce chantier ou tous vos chantiers en 1 fois (arborescence conservée).
              </p>

              <div className="space-y-2">
                {selectedChantierPhotoCount > 0 && (
                  <button
                    type="button"
                    onClick={() => onOpenTransfer('chantier')}
                    className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 bg-white text-slate-900 text-xs font-semibold hover:bg-slate-50 transition-colors inline-flex items-center justify-between gap-2 cursor-pointer"
                  >
                    <span className="truncate">
                      Chantier « {selectedChantier.name} » ({selectedChantierPhotoCount})
                    </span>
                    <ArrowRight className="w-4 h-4 shrink-0 text-amber-600" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => onOpenTransfer('all')}
                  className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors inline-flex items-center justify-between gap-2 cursor-pointer"
                >
                  <span className="inline-flex items-center gap-1.5 truncate">
                    <Layers className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>Tous les chantiers en 1 fois ({photos.length})</span>
                  </span>
                  <ArrowRight className="w-4 h-4 shrink-0" />
                </button>
              </div>
            </div>
          )}

          {/* Recent Folders */}
          {recentTargets.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Derniers dossiers utilisés
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
                          {target.pathSegments
                            .filter((s) => s.id !== 'root')
                            .map((s) => s.name)
                            .join(' / ')}
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

      {viewerIndex !== null && displayedPhotos.length > 0 && (
        <PhotoViewerModal
          photos={displayedPhotos}
          initialIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onDeletePhoto={onDeletePhoto}
          onFeedback={onFeedback}
        />
      )}
    </div>
  );
};
