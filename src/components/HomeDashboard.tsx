import React, { useMemo } from 'react';
import {
  AlertTriangle,
  Archive,
  Camera,
  CheckCircle2,
  ChevronRight,
  FolderOpen,
  FolderPlus,
  HardDrive,
} from 'lucide-react';
import { LocalFolderRecord, QueuedPhoto } from '../types';
import { formatBytes, getDescendantIdsFromList } from '../lib/storage';
import { StorageQuotaState } from '../hooks/useStorageQuota';

interface HomeDashboardProps {
  rootChantiers: LocalFolderRecord[];
  allFolders: LocalFolderRecord[];
  photos: QueuedPhoto[];
  storage: StorageQuotaState;
  onOpenChantierFolders: (chantierId: string) => void;
  onLaunchCameraForChantier: (chantierId?: string) => void;
  onOpenTransfer: (scope: 'all' | 'chantier', chantierId?: string) => void;
  onOpenCreateChantier: () => void;
}

const numberFormatter = new Intl.NumberFormat('fr-FR');

export const HomeDashboard: React.FC<HomeDashboardProps> = ({
  rootChantiers,
  allFolders,
  photos,
  storage,
  onOpenChantierFolders,
  onLaunchCameraForChantier,
  onOpenTransfer,
  onOpenCreateChantier,
}) => {
  const totalPhotos = photos.length;
  const totalSubfolders = Math.max(0, allFolders.length - rootChantiers.length);

  const chantierSummaries = useMemo(() => {
    return rootChantiers.map((chantier) => {
      const descendantIds = getDescendantIdsFromList(allFolders, chantier.id);
      const chantierPhotos = photos.filter((p) => descendantIds.has(p.folderId));
      const photoCount = chantierPhotos.length;
      const bytes = chantierPhotos.reduce((acc, p) => acc + (p.size || 0), 0);
      const subfolderCount = Math.max(0, descendantIds.size - 1);
      const sharePercent = totalPhotos > 0 ? Math.round((photoCount / totalPhotos) * 100) : 0;

      return {
        chantier,
        photoCount,
        bytes,
        subfolderCount,
        sharePercent,
      };
    });
  }, [rootChantiers, allFolders, photos, totalPhotos]);

  const gaugeHealth = useMemo(() => {
    if (storage.quotaBytes === null) {
      return {
        label: 'Stockage local actif',
        textClass: 'text-slate-800',
        Icon: HardDrive,
      };
    }
    if (storage.usedPercent >= 90) {
      return {
        label: 'Espace presque plein — transférez vos photos',
        textClass: 'text-red-700',
        Icon: AlertTriangle,
      };
    }
    if (storage.usedPercent >= 70) {
      return {
        label: 'Espace modéré — pensez à exporter en ZIP',
        textClass: 'text-amber-800',
        Icon: AlertTriangle,
      };
    }
    return {
      label: 'Espace disponible confortable',
      textClass: 'text-emerald-800',
      Icon: CheckCircle2,
    };
  }, [storage.quotaBytes, storage.usedPercent]);

  const HealthIcon = gaugeHealth.Icon;
  const usedPercentFormatted = storage.usedPercent.toFixed(1).replace('.', ',');

  return (
    <div className="mx-auto w-full max-w-6xl px-3 sm:px-6 py-4 sm:py-6 space-y-5 sm:space-y-6">
      {/* Hero Summary + Storage Gauge (2-column stretched split on desktop, stacked cleanly on mobile) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        {/* Left: Total Photos & Field Actions */}
        <section className="lg:col-span-5 min-w-0 rounded-2xl border border-slate-300 bg-white p-4 sm:p-5 flex flex-col justify-between gap-4">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-slate-700">
              Tableau de bord terrain
            </p>
            <div className="flex items-baseline gap-2.5 flex-wrap">
              <span className="text-4xl sm:text-5xl font-bold tracking-tight text-slate-950 tabular-nums font-display">
                {numberFormatter.format(totalPhotos)}
              </span>
              <span className="text-base sm:text-lg font-semibold text-slate-800">
                {totalPhotos > 1 ? 'photos classées' : 'photo classée'}
              </span>
            </div>
            <p className="text-xs sm:text-sm font-medium text-slate-700 tabular-nums">
              {rootChantiers.length}{' '}
              {rootChantiers.length > 1 ? 'chantiers' : 'chantier'}
              <span aria-hidden="true"> · </span>
              {totalSubfolders}{' '}
              {totalSubfolders > 1 ? 'sous-dossiers' : 'sous-dossier'}
              <span aria-hidden="true"> · </span>
              {formatBytes(storage.photosBytes)}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => onLaunchCameraForChantier()}
              className="min-h-[52px] px-3.5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 active:scale-[0.99] text-slate-950 text-sm font-bold inline-flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <Camera className="w-5 h-5 shrink-0" />
              <span className="truncate">Prendre photo</span>
            </button>

            <button
              type="button"
              onClick={() => onOpenTransfer('all')}
              className="min-h-[52px] px-3.5 py-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 active:scale-[0.99] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <Archive className="w-5 h-5 shrink-0 text-amber-400" />
              <span className="truncate">Transfert / ZIP</span>
            </button>
          </div>
        </section>

        {/* Right: Used vs Free Storage Gauge + Photo Capacity Parallel */}
        <section className="lg:col-span-7 min-w-0 rounded-2xl border border-slate-300 bg-white p-4 sm:p-5 flex flex-col justify-between gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-base sm:text-lg font-bold text-slate-950 font-display">
              Jauge d’espace disponible
            </h1>
            <div
              className={`inline-flex items-center gap-1.5 text-xs font-semibold ${gaugeHealth.textClass}`}
            >
              <HealthIcon className="w-4 h-4 shrink-0" />
              <span>{gaugeHealth.label}</span>
            </div>
          </div>

          {storage.quotaBytes !== null && storage.freeBytes !== null ? (
            <>
              {/* High-Contrast Daylight Storage Bar */}
              <div className="space-y-2">
                <div className="flex items-baseline justify-between gap-2 text-xs sm:text-sm">
                  <span className="font-bold text-slate-950 tabular-nums">
                    {usedPercentFormatted} % utilisé
                  </span>
                  <span className="font-semibold text-slate-800 tabular-nums">
                    {formatBytes(storage.freeBytes)} libre sur{' '}
                    {formatBytes(storage.quotaBytes)}
                  </span>
                </div>

                <div
                  role="progressbar"
                  aria-label="Espace de stockage utilisé"
                  aria-valuenow={Math.round(storage.usedPercent)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="h-7 w-full rounded-xl bg-slate-100 border border-slate-300 overflow-hidden flex"
                >
                  {storage.photosBytes > 0 && (
                    <div
                      style={{
                        width: `${Math.max(storage.photosPercent, 1.5)}%`,
                      }}
                      className="h-full bg-amber-500 transition-[width] duration-300"
                      title={`Photos ChantierShot : ${formatBytes(storage.photosBytes)}`}
                    />
                  )}
                  {storage.otherPercent > 0.2 && (
                    <div
                      style={{ width: `${storage.otherPercent}%` }}
                      className="h-full bg-slate-600 transition-[width] duration-300"
                      title={`Autres données : ${formatBytes(storage.otherUsageBytes)}`}
                    />
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-slate-700 tabular-nums">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm bg-amber-500 border border-amber-600 shrink-0" />
                    Photos ({formatBytes(storage.photosBytes)})
                  </span>
                  {storage.otherUsageBytes > 1024 * 1024 && (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-sm bg-slate-600 shrink-0" />
                      Appli & cache ({formatBytes(storage.otherUsageBytes)})
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm bg-slate-100 border border-slate-400 shrink-0" />
                    Libre ({formatBytes(storage.freeBytes)})
                  </span>
                </div>
              </div>

              {/* Hairline-divided 3-Column Metrics including Parallel in Photos */}
              <div className="grid grid-cols-3 gap-2 sm:gap-4 pt-3 border-t border-slate-200">
                <div className="min-w-0">
                  <div className="text-[11px] sm:text-xs font-medium text-slate-700">
                    Utilisé
                  </div>
                  <div className="mt-0.5 text-sm sm:text-lg font-bold text-slate-950 tabular-nums truncate">
                    {formatBytes(storage.totalUsageBytes)}
                  </div>
                </div>

                <div className="min-w-0 border-l border-slate-200 pl-2 sm:pl-4">
                  <div className="text-[11px] sm:text-xs font-medium text-slate-700">
                    Espace libre
                  </div>
                  <div className="mt-0.5 text-sm sm:text-lg font-bold text-emerald-800 tabular-nums truncate">
                    {formatBytes(storage.freeBytes)}
                  </div>
                </div>

                <div className="min-w-0 border-l border-slate-200 pl-2 sm:pl-4">
                  <div className="text-[11px] sm:text-xs font-medium text-slate-700">
                    Capacité restante
                  </div>
                  <div className="mt-0.5 text-sm sm:text-lg font-bold text-slate-950 tabular-nums truncate">
                    {storage.estimatedRemainingPhotos !== null
                      ? `~ ${numberFormatter.format(storage.estimatedRemainingPhotos)} photos`
                      : '—'}
                  </div>
                  <div className="text-[10px] sm:text-[11px] text-slate-600 tabular-nums truncate">
                    {storage.isRealAverage
                      ? `moy. ${formatBytes(storage.avgPhotoBytes)} / photo`
                      : `base ~${formatBytes(storage.avgPhotoBytes)} / photo`}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-3 pt-1">
              <div className="text-sm text-slate-800">
                Vos photos occupent actuellement{' '}
                <strong className="font-bold text-slate-950 tabular-nums">
                  {formatBytes(storage.photosBytes)}
                </strong>{' '}
                en mémoire locale.
              </div>
              <p className="text-xs text-slate-700">
                Ce navigateur ne communique pas le quota libre total de l’appareil.
              </p>
            </div>
          )}
        </section>
      </div>

      {/* Chantiers Overview List */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-bold text-slate-950 font-display truncate">
              Mes chantiers ({rootChantiers.length})
            </h2>
            <p className="text-xs text-slate-700">
              Touchez un chantier pour ouvrir ses sous-dossiers ou photographier directement.
            </p>
          </div>

          <button
            type="button"
            onClick={onOpenCreateChantier}
            className="min-h-[44px] px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-950 text-xs sm:text-sm font-semibold hover:bg-slate-100 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FolderPlus className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Nouveau chantier</span>
          </button>
        </div>

        {rootChantiers.length === 0 ? (
          <div className="rounded-2xl border border-slate-300 bg-white p-6 sm:p-8 text-center space-y-4">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700">
              <FolderOpen className="w-6 h-6" />
            </div>
            <div className="space-y-1 max-w-md mx-auto">
              <h3 className="text-base font-bold text-slate-950">
                Aucun chantier créé
              </h3>
              <p className="text-sm text-slate-700">
                L’application démarre vierge. Créez votre premier chantier pour y organiser vos sous-dossiers et vos photos.
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenCreateChantier}
              className="min-h-[48px] px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-bold inline-flex items-center gap-2 cursor-pointer"
            >
              <FolderPlus className="w-4 h-4" />
              <span>Créer mon premier chantier</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {chantierSummaries.map(
              ({ chantier, photoCount, bytes, subfolderCount, sharePercent }) => (
                <article
                  key={chantier.id}
                  className="min-w-0 rounded-2xl border border-slate-300 bg-white p-4 flex flex-col justify-between gap-3.5"
                >
                  <button
                    type="button"
                    onClick={() => onOpenChantierFolders(chantier.id)}
                    className="w-full text-left space-y-2.5 cursor-pointer group"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-base font-bold text-slate-950 truncate group-hover:underline decoration-amber-500 decoration-2 underline-offset-4">
                        {chantier.name}
                      </h3>
                      <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-slate-950 shrink-0" />
                    </div>

                    <div className="text-xs font-medium text-slate-700 tabular-nums">
                      <strong className="text-slate-950 font-bold">
                        {numberFormatter.format(photoCount)}
                      </strong>{' '}
                      {photoCount > 1 ? 'photos' : 'photo'}
                      <span aria-hidden="true"> · </span>
                      {subfolderCount}{' '}
                      {subfolderCount > 1 ? 'sous-dossiers' : 'sous-dossier'}
                      <span aria-hidden="true"> · </span>
                      {formatBytes(bytes)}
                    </div>

                    <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
                      <div
                        style={{
                          width: photoCount > 0 ? `${Math.max(sharePercent, 6)}%` : '0%',
                        }}
                        className="h-full bg-amber-500 transition-[width] duration-300"
                      />
                    </div>
                  </button>

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200">
                    <button
                      type="button"
                      onClick={() => onOpenChantierFolders(chantier.id)}
                      className="min-h-[44px] px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-950 text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <FolderOpen className="w-4 h-4 shrink-0 text-slate-700" />
                      <span>Dossiers</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onLaunchCameraForChantier(chantier.id)}
                      className="min-h-[44px] px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Camera className="w-4 h-4 shrink-0" />
                      <span>Photo</span>
                    </button>
                  </div>
                </article>
              )
            )}
          </div>
        )}
      </section>
    </div>
  );
};
