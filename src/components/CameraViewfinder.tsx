import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  FolderOpen,
  Grid3X3,
  ImagePlus,
  Loader2,
  RefreshCw,
  Stamp,
  SwitchCamera,
  AlertCircle,
} from 'lucide-react';
import { CaptureSettings, QueuedPhoto, TargetFolder } from '../types';
import { buildPhotoFilename } from '../lib/storage';

interface CameraViewfinderProps {
  activeTarget: TargetFolder | null;
  settings: CaptureSettings;
  recentSessionPhotos: QueuedPhoto[];
  onUpdateSettings: (next: CaptureSettings) => void;
  onPhotoCaptured: (blob: Blob, filename: string) => Promise<void>;
  onChangeFolder: () => void;
  onOpenQueue: () => void;
}

const QUICK_PREFIXES = [
  { label: 'Aucun', value: '' },
  { label: 'Avant', value: 'Avant' },
  { label: 'Après', value: 'Apres' },
  { label: 'Réseau', value: 'Reseau' },
  { label: 'Anomalie', value: 'Anomalie' },
];

export const CameraViewfinder: React.FC<CameraViewfinderProps> = ({
  activeTarget,
  settings,
  recentSessionPhotos,
  onUpdateSettings,
  onPhotoCaptured,
  onChangeFolder,
  onOpenQueue,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraState, setCameraState] = useState<'initializing' | 'ready' | 'unavailable'>(
    'initializing'
  );
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [flashActive, setFlashActive] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  const [lastThumbUrl, setLastThumbUrl] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const startCamera = useCallback(
    async (mode: 'environment' | 'user') => {
      stopCamera();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraState('unavailable');
        setCameraError(
          "L'accès caméra direct n'est pas supporté par ce navigateur. Utilisez l'appareil photo natif ci-dessous."
        );
        return;
      }

      setCameraState('initializing');
      setCameraError(null);

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: mode },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCameraState('ready');
      } catch (err) {
        setCameraState('unavailable');
        const msg =
          err instanceof Error && err.name === 'NotAllowedError'
            ? "Permission caméra refusée. Autorisez la caméra dans le navigateur ou utilisez l'appareil photo du téléphone."
            : "Aucune caméra active détectée dans cet environnement. Vous pouvez prendre ou importer des photos via le bouton natif.";
        setCameraError(msg);
      }
    },
    [stopCamera]
  );

  useEffect(() => {
    if (activeTarget) {
      startCamera(facingMode);
    }
    return () => {
      stopCamera();
    };
  }, [activeTarget, facingMode, startCamera, stopCamera]);

  // Keep latest session thumbnail URL clean
  useEffect(() => {
    if (recentSessionPhotos.length === 0) {
      setLastThumbUrl(null);
      return;
    }
    const url = URL.createObjectURL(recentSessionPhotos[0].blob);
    setLastThumbUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [recentSessionPhotos]);

  const stampCanvas = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    folderLabel: string
  ) => {
    if (!settings.burnStamp) return;
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
  };

  const handleCapture = async () => {
    if (!activeTarget || !videoRef.current || cameraState !== 'ready' || capturing) return;

    const video = videoRef.current;
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;

    setCapturing(true);
    setFlashActive(true);
    setTimeout(() => setFlashActive(false), 140);

    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas indisponible');

      ctx.drawImage(video, 0, 0, width, height);
      const pathText = activeTarget.pathSegments.map((s) => s.name).join(' / ');
      stampCanvas(ctx, width, height, pathText);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/jpeg', settings.jpegQuality)
      );

      if (!blob) throw new Error('Impossible de générer le fichier JPEG.');

      const nextSeq = sessionCount + 1;
      setSessionCount(nextSeq);
      const filename = buildPhotoFilename(settings.prefix, nextSeq);
      await onPhotoCaptured(blob, filename);
    } finally {
      setCapturing(false);
    }
  };

  const handleNativeFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeTarget || !e.target.files || e.target.files.length === 0) return;
    const files = Array.from(e.target.files);
    let seq = sessionCount;

    for (const file of files) {
      seq += 1;
      const filename = buildPhotoFilename(settings.prefix, seq);
      // Re-encode only if stamp is enabled, otherwise upload original JPEG directly
      if (settings.burnStamp && file.type.startsWith('image/')) {
        try {
          const bitmap = await createImageBitmap(file);
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(bitmap, 0, 0);
            const pathText = activeTarget.pathSegments.map((s) => s.name).join(' / ');
            stampCanvas(ctx, bitmap.width, bitmap.height, pathText);
            const stampedBlob = await new Promise<Blob | null>((resolve) =>
              canvas.toBlob((b) => resolve(b), 'image/jpeg', settings.jpegQuality)
            );
            bitmap.close();
            if (stampedBlob) {
              await onPhotoCaptured(stampedBlob, filename);
              continue;
            }
          }
          bitmap.close();
        } catch {
          // Fallback to raw file below
        }
      }
      await onPhotoCaptured(file, filename);
    }

    setSessionCount(seq);
    e.target.value = '';
  };

  if (!activeTarget) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-12 text-center">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
            <FolderOpen className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-semibold text-slate-900">
            Choisissez d'abord votre chantier
          </h2>
          <p className="text-sm text-slate-600 max-w-md mx-auto">
            Sélectionnez le dossier, sous-dossier ou sous-sous-dossier dans lequel vos photos doivent être rangées automatiquement.
          </p>
          <button
            type="button"
            onClick={onChangeFolder}
            className="min-h-[48px] px-6 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-colors inline-flex items-center gap-2 cursor-pointer"
          >
            <FolderOpen className="w-4 h-4" />
            <span>Sélectionner un dossier</span>
          </button>
        </div>
      </div>
    );
  }

  const fullPath = activeTarget.pathSegments.map((s) => s.name).join(' / ');
  const syncedCount = recentSessionPhotos.filter((p) => p.status === 'synced').length;
  const pendingCount = recentSessionPhotos.filter(
    (p) => p.status === 'pending' || p.status === 'uploading'
  ).length;

  return (
    <div className="mx-auto w-full max-w-6xl px-3 sm:px-6 py-3 sm:py-5 pb-28 lg:pb-8">
      {/* Locked Destination Strip */}
      <div className="mb-3 sm:mb-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-slate-500">
            Enregistrement direct vers{' '}
            {activeTarget.source === 'onedrive' ? 'OneDrive' : 'Dossier local'}
          </div>
          <div className="text-sm font-semibold text-slate-900 truncate">{fullPath}</div>
        </div>
        <button
          type="button"
          onClick={onChangeFolder}
          className="min-h-[40px] px-3.5 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
        >
          Changer
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Viewfinder & Shutter Column */}
        <div className="lg:col-span-8 space-y-3">
          <div className="relative rounded-3xl overflow-hidden bg-slate-950 aspect-[3/4] sm:aspect-[4/3] lg:aspect-[16/10] border border-slate-800">
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className={`w-full h-full object-cover ${
                cameraState === 'ready' ? 'opacity-100' : 'opacity-0'
              }`}
            />

            {/* Rule of thirds framing grid */}
            {showGrid && cameraState === 'ready' && (
              <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
                <div className="border-r border-b border-white/15" />
                <div className="border-r border-b border-white/15" />
                <div className="border-b border-white/15" />
                <div className="border-r border-b border-white/15" />
                <div className="border-r border-b border-white/15" />
                <div className="border-b border-white/15" />
                <div className="border-r border-white/15" />
                <div className="border-r border-white/15" />
                <div />
              </div>
            )}

            {/* Shutter Flash Feedback */}
            {flashActive && (
              <div className="pointer-events-none absolute inset-0 bg-white/80 transition-opacity duration-150" />
            )}

            {/* Top Viewfinder Quick Toggles */}
            <div className="absolute top-3 left-3 right-3 flex items-center justify-between gap-2">
              <div className="px-3 py-1.5 rounded-xl bg-slate-950/65 backdrop-blur-md text-xs font-medium text-white tabular-nums">
                Série : {sessionCount} photo{sessionCount > 1 ? 's' : ''}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowGrid((v) => !v)}
                  aria-label="Afficher ou masquer la grille"
                  className={`min-h-[40px] min-w-[40px] rounded-xl backdrop-blur-md flex items-center justify-center transition-colors cursor-pointer ${
                    showGrid
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-slate-950/65 text-white hover:bg-slate-900'
                  }`}
                >
                  <Grid3X3 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'))
                  }
                  aria-label="Changer de caméra"
                  className="min-h-[40px] min-w-[40px] rounded-xl bg-slate-950/65 backdrop-blur-md text-white hover:bg-slate-900 flex items-center justify-center cursor-pointer"
                >
                  <SwitchCamera className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Initializing / Unavailable State */}
            {cameraState === 'initializing' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-300 p-6 text-center">
                <Loader2 className="w-7 h-7 animate-spin text-amber-400" />
                <span className="text-sm">Activation de l'objectif...</span>
              </div>
            )}

            {cameraState === 'unavailable' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-slate-200 p-6 text-center bg-slate-950">
                <AlertCircle className="w-8 h-8 text-amber-400" />
                <p className="text-sm text-slate-300 max-w-sm">{cameraError}</p>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="min-h-[48px] px-5 rounded-xl bg-amber-500 text-slate-950 text-sm font-semibold hover:bg-amber-400 inline-flex items-center gap-2 cursor-pointer"
                  >
                    <Camera className="w-4 h-4" />
                    <span>Appareil photo du téléphone</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => startCamera(facingMode)}
                    className="min-h-[48px] px-4 rounded-xl border border-slate-700 bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 inline-flex items-center gap-2 cursor-pointer"
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>Réessayer</span>
                  </button>
                </div>
              </div>
            )}

            {/* Bottom Shutter Bar inside Viewfinder (Thumb-Zone) */}
            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-slate-950/90 via-slate-950/55 to-transparent pt-8 pb-4 px-5 flex items-center justify-between gap-4">
              {/* Left: Last Capture Thumbnail / Queue shortcut */}
              <button
                type="button"
                onClick={onOpenQueue}
                className="w-12 h-12 rounded-xl overflow-hidden border-2 border-white/30 bg-slate-900 flex items-center justify-center shrink-0 cursor-pointer"
                aria-label="Voir les photos capturées"
              >
                {lastThumbUrl ? (
                  <img
                    src={lastThumbUrl}
                    alt="Dernière photo"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <ImagePlus className="w-5 h-5 text-slate-400" />
                )}
              </button>

              {/* Center: Tactile Shutter Button */}
              <button
                type="button"
                onClick={
                  cameraState === 'ready'
                    ? handleCapture
                    : () => fileInputRef.current?.click()
                }
                disabled={capturing}
                aria-label="Prendre une photo"
                className="w-[72px] h-[72px] rounded-full border-4 border-white bg-amber-500 hover:bg-amber-400 active:scale-95 transition-transform flex items-center justify-center shadow-lg cursor-pointer disabled:opacity-60"
              >
                <span className="w-[56px] h-[56px] rounded-full border-2 border-slate-950/20" />
              </button>

              {/* Right: Native Camera / Multi-import trigger (e.g., ultra-wide phone lens) */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="min-h-[48px] px-3 rounded-xl bg-slate-900/80 border border-white/15 text-white text-xs font-medium hover:bg-slate-800 inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
                title="Utiliser l'appareil natif du téléphone (grand angle, HDR) ou importer"
              >
                <ImagePlus className="w-4 h-4 text-amber-400" />
                <span className="hidden sm:inline">Natif / Import</span>
              </button>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            onChange={handleNativeFiles}
            className="hidden"
          />
        </div>

        {/* Right Controls & Live Burst Feed */}
        <aside className="lg:col-span-4 space-y-4">
          {/* Quick Prefix & Stamp Options */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-2">
                Préfixe automatique du fichier
              </label>
              <div className="flex flex-wrap gap-1.5 mb-2.5">
                {QUICK_PREFIXES.map((p) => {
                  const selected = settings.prefix === p.value;
                  return (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => onUpdateSettings({ ...settings, prefix: p.value })}
                      className={`min-h-[36px] px-3 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                        selected
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
              <input
                type="text"
                value={settings.prefix}
                onChange={(e) => onUpdateSettings({ ...settings, prefix: e.target.value })}
                placeholder="Mot-clé libre (ex: Tableau_TGBT)"
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Stamp className="w-4 h-4 text-slate-500 shrink-0" />
                <div>
                  <div className="text-xs font-semibold text-slate-900">
                    Horodatage + chantier sur photo
                  </div>
                  <div className="text-xs text-slate-500">
                    Inscrit date, heure et dossier en bas à droite
                  </div>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings.burnStamp}
                onClick={() =>
                  onUpdateSettings({ ...settings, burnStamp: !settings.burnStamp })
                }
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                  settings.burnStamp ? 'bg-amber-500' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    settings.burnStamp ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Live Transfer Status for Active Folder */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">Envoi automatique</h3>
              <button
                type="button"
                onClick={onOpenQueue}
                className="text-xs font-medium text-sky-700 hover:underline cursor-pointer"
              >
                Voir la file
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                <div className="text-slate-500">Synchronisées</div>
                <div className="mt-1 text-lg font-bold text-slate-900 tabular-nums">
                  {syncedCount}
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                <div className="text-slate-500">En attente</div>
                <div className="mt-1 text-lg font-bold text-slate-900 tabular-nums">
                  {pendingCount}
                </div>
              </div>
            </div>

            {recentSessionPhotos.slice(0, 4).length > 0 && (
              <ul className="divide-y divide-slate-100 pt-1">
                {recentSessionPhotos.slice(0, 4).map((p) => (
                  <li key={p.id} className="py-2 flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono text-slate-700 truncate">{p.filename}</span>
                    <span className="shrink-0 inline-flex items-center gap-1 font-medium">
                      {p.status === 'synced' ? (
                        <span className="text-emerald-700 inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          OneDrive
                        </span>
                      ) : p.status === 'uploading' ? (
                        <span className="text-sky-700 inline-flex items-center gap-1">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Envoi
                        </span>
                      ) : p.status === 'error' ? (
                        <span className="text-red-700">Erreur</span>
                      ) : (
                        <span className="text-amber-700">File locale</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};
