import React, { useEffect, useMemo } from 'react';
import { Folder, FolderInput, X } from 'lucide-react';
import { LocalFolderRecord, TargetFolder } from '../types';
import { buildTargetFolderFromId } from '../lib/storage';

interface MovePhotosModalProps {
  photoCount: number;
  allFolders: LocalFolderRecord[];
  currentFolderId?: string;
  onSelectDestination: (target: TargetFolder) => Promise<void>;
  onClose: () => void;
}

interface FolderOptionRow {
  folder: LocalFolderRecord;
  depth: number;
  fullPath: string;
}

export const MovePhotosModal: React.FC<MovePhotosModalProps> = ({
  photoCount,
  allFolders,
  currentFolderId,
  onSelectDestination,
  onClose,
}) => {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const rows = useMemo(() => {
    const byParent = new Map<string, LocalFolderRecord[]>();
    for (const f of allFolders) {
      const list = byParent.get(f.parentId) || [];
      list.push(f);
      byParent.set(f.parentId, list);
    }
    for (const list of byParent.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
    }

    const flat: FolderOptionRow[] = [];
    const walk = (parentId: string, depth: number, prefixPath: string[]) => {
      const children = byParent.get(parentId) || [];
      for (const child of children) {
        const nextPath = [...prefixPath, child.name];
        flat.push({
          folder: child,
          depth,
          fullPath: nextPath.join(' / '),
        });
        walk(child.id, depth + 1, nextPath);
      }
    };
    walk('root', 0, []);
    return flat;
  }, [allFolders]);

  const handlePick = async (folderId: string) => {
    const target = buildTargetFolderFromId(allFolders, folderId);
    if (!target) return;
    await onSelectDestination(target);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Déplacer les photos vers un dossier"
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <div className="w-full sm:max-w-lg max-h-[85dvh] rounded-t-2xl sm:rounded-2xl bg-white border border-slate-300 flex flex-col overflow-hidden">
        <header className="px-4 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FolderInput className="w-5 h-5 text-amber-600 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-slate-950 truncate">
                Déplacer {photoCount} photo{photoCount > 1 ? 's' : ''}
              </h2>
              <p className="text-xs text-slate-600">
                Choisissez le chantier ou sous-dossier de destination
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="min-h-[40px] min-w-[40px] rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 flex items-center justify-center shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-2.5 sm:p-3">
          {rows.length === 0 ? (
            <div className="py-8 px-4 text-center text-sm text-slate-600">
              Aucun autre dossier disponible. Créez d’abord un chantier ou sous-dossier.
            </div>
          ) : (
            <ul className="space-y-1">
              {rows.map(({ folder, depth, fullPath }) => {
                const isSameCurrent = Boolean(currentFolderId && folder.id === currentFolderId);
                return (
                  <li key={folder.id}>
                    <button
                      type="button"
                      disabled={isSameCurrent}
                      onClick={() => void handlePick(folder.id)}
                      style={{ paddingLeft: `${12 + Math.min(depth, 4) * 18}px` }}
                      className={`w-full min-h-[46px] pr-3 py-2 rounded-xl flex items-center justify-between gap-2 text-left transition-colors ${
                        isSameCurrent
                          ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                          : 'hover:bg-amber-50 active:bg-amber-100 text-slate-950 cursor-pointer'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Folder
                          className={`w-4 h-4 shrink-0 ${
                            isSameCurrent ? 'text-slate-400' : 'text-amber-600'
                          }`}
                        />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold truncate">{folder.name}</div>
                          {depth > 0 && (
                            <div className="text-[11px] text-slate-500 truncate">{fullPath}</div>
                          )}
                        </div>
                      </div>
                      {isSameCurrent && (
                        <span className="text-[11px] font-medium text-slate-500 shrink-0">
                          Dossier actuel
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};
