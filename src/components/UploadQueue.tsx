import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  CloudUpload,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import { AuthStatus, CaptureSettings, QueuedPhoto } from '../types';
import { formatBytes } from '../lib/storage';

interface UploadQueueProps {
  photos: QueuedPhoto[];
  authStatus: AuthStatus;
  isOnline: boolean;
  settings: CaptureSettings;
  onUpdateSettings: (next: CaptureSettings) => void;
  onSyncAll: () => Promise<void>;
  onRetryPhoto: (id: string) => Promise<void>;
  onDeletePhoto: (id: string) => Promise<void>;
  onClearSynced: () => Promise<void>;
  onConnectOneDrive: () => void;
}

const PhotoThumbnail: React.FC<{ blob: Blob; alt: string }> = ({ blob, alt }) => {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  if (!url) {
    return <div className="w-16 h-16 rounded-xl bg-slate-100 shrink-0" />;
  }

  return (
    <img
      src={url}
      alt={alt}
      className="w-16 h-16 rounded-xl object-cover bg-slate-100 shrink-0 border border-slate-200"
    />
  );
};

export const UploadQueue: React.FC<UploadQueueProps> = ({
  photos,
  authStatus,
  isOnline,
  settings,
  onUpdateSettings,
  onSyncAll,
  onRetryPhoto,
  onDeletePhoto,
  onClearSynced,
  onConnectOneDrive,
}) => {
  const [syncingAll, setSyncingAll] = useState(false);

  const pendingPhotos = photos.filter((p) => p.status === 'pending' || p.status === 'error');
  const syncedPhotos = photos.filter((p) => p.status === 'synced');
  const totalBytes = photos.reduce((acc, p) => acc + p.size, 0);

  const handleSyncAll = async () => {
    setSyncingAll(true);
    try {
      await onSyncAll();
    } finally {
      setSyncingAll(false);
    }
  };

  const handleDownloadPhoto = (photo: QueuedPhoto) => {
    const url = URL.createObjectURL(photo.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = photo.filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-5 pb-28 lg:pb-10 space-y-6">
      {/* Top KPI Summary & Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        <div className="lg:col-span-7 grid grid-cols-3 gap-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">En attente</div>
            <div className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">
              {pendingPhotos.length}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">Sur OneDrive</div>
            <div className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">
              {syncedPhotos.length}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">Cache local</div>
            <div className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">
              {formatBytes(totalBytes)}
            </div>
          </div>
        </div>

        <div className="lg:col-span-5 rounded-2xl border border-slate-200 bg-white p-4 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-slate-900">
                Nettoyage auto après envoi OneDrive
              </div>
              <div className="text-xs text-slate-500">
                Ne garde aucune copie sur le téléphone une fois enregistrée
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.autoPurgeAfterSync}
              onClick={() =>
                onUpdateSettings({
                  ...settings,
                  autoPurgeAfterSync: !settings.autoPurgeAfterSync,
                })
              }
              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                settings.autoPurgeAfterSync ? 'bg-amber-500' : 'bg-slate-300'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  settings.autoPurgeAfterSync ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {authStatus.authenticated ? (
              <button
                type="button"
                onClick={handleSyncAll}
                disabled={syncingAll || !isOnline || pendingPhotos.length === 0}
                className="flex-1 min-h-[44px] px-4 rounded-xl bg-sky-600 text-white text-xs font-semibold hover:bg-sky-700 disabled:opacity-50 inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
              >
                {syncingAll ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CloudUpload className="w-4 h-4" />
                )}
                <span>Synchroniser ({pendingPhotos.length})</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onConnectOneDrive}
                className="flex-1 min-h-[44px] px-4 rounded-xl bg-sky-600 text-white text-xs font-semibold hover:bg-sky-700 inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
              >
                <CloudUpload className="w-4 h-4" />
                <span>Connecter OneDrive pour envoyer</span>
              </button>
            )}

            {syncedPhotos.length > 0 && (
              <button
                type="button"
                onClick={onClearSynced}
                className="min-h-[44px] px-3.5 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Vider envoyées</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Queue List */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            Historique et file de transfert
          </h2>
          <span className="text-xs text-slate-500 tabular-nums">
            {photos.length} photo{photos.length > 1 ? 's' : ''}
          </span>
        </div>

        {photos.length === 0 ? (
          <div className="py-12 px-4 text-center text-sm text-slate-500">
            Aucune photo en attente ou en cache. Les photos prises avec l’appareil apparaîtront ici.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {photos.map((photo) => (
              <li
                key={photo.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <PhotoThumbnail blob={photo.blob} alt={photo.filename} />
                  <div className="min-w-0 space-y-1">
                    <div className="text-sm font-mono font-medium text-slate-900 truncate">
                      {photo.filename}
                    </div>
                    <div className="text-xs text-slate-600 truncate">
                      {photo.folderPath}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 tabular-nums">
                      <span>{formatBytes(photo.size)}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {new Date(photo.capturedAt).toLocaleTimeString('fr-FR', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                      <span aria-hidden="true">·</span>
                      {photo.status === 'synced' ? (
                        <span className="text-emerald-700 font-medium inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Enregistrée sur OneDrive
                        </span>
                      ) : photo.status === 'uploading' ? (
                        <span className="text-sky-700 font-medium inline-flex items-center gap-1">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Envoi en cours...
                        </span>
                      ) : photo.status === 'error' ? (
                        <span className="text-red-700 font-medium inline-flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          {photo.errorMessage || 'Échec envoi'}
                        </span>
                      ) : (
                        <span className="text-amber-700 font-medium">
                          {photo.source === 'local'
                            ? 'Stockée en dossier local'
                            : 'En attente de réseau'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  {photo.webUrl && (
                    <a
                      href={photo.webUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="min-h-[40px] px-3 rounded-lg border border-slate-200 text-xs font-medium text-sky-700 hover:bg-slate-50 inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>OneDrive</span>
                    </a>
                  )}
                  {(photo.status === 'error' || photo.status === 'pending') &&
                    authStatus.authenticated && (
                      <button
                        type="button"
                        onClick={() => onRetryPhoto(photo.id)}
                        disabled={!isOnline}
                        className="min-h-[40px] px-3 rounded-lg border border-slate-200 text-xs font-medium text-slate-800 hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Envoyer</span>
                      </button>
                    )}
                  <button
                    type="button"
                    onClick={() => handleDownloadPhoto(photo)}
                    aria-label="Télécharger la photo"
                    className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeletePhoto(photo.id)}
                    aria-label="Supprimer la photo"
                    className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg border border-slate-200 text-red-600 hover:bg-red-50 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
