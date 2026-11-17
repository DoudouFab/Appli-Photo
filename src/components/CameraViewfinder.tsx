import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  Check,
  FolderOpen,
  Grid3X3,
  ImagePlus,
  Loader2,
  Maximize2,
  MessageSquareText,
  Minimize2,
  RefreshCw,
  Stamp,
  SwitchCamera,
  ZoomIn,
} from 'lucide-react';
import { CaptureSettings, QueuedPhoto, TargetFolder } from '../types';
import {
  buildPhotoFilename,
  drawCornerStamp,
  MAX_PHOTO_MEGAPIXELS,
  normalizeBlobToMax15MP,
} from '../lib/storage';

interface CameraViewfinderProps {
  activeTarget: TargetFolder | null;
  settings: CaptureSettings;
  recentSessionPhotos: QueuedPhoto[];
  totalStoredPhotos: number;
  onUpdateSettings: (next: CaptureSettings) => void;
  onPhotoCaptured: (blob: Blob, filename: string, note?: string) => Promise<void>;
  onChangeFolder: () => void;
  onOpenTransfer: () => void;
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
  totalStoredPhotos,
  onUpdateSettings,
  onPhotoCaptured,
  onChangeFolder,
  onOpenTransfer,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const viewfinderRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nativeCameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraState, setCameraState] = useState<'initializing' | 'ready' | 'unavailable'>(
    'initializing'
  );
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [flashActive, setFlashActive] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [importingProgress, setImportingProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [sessionCount, setSessionCount] = useState(0);
  const [lastThumbUrl, setLastThumbUrl] = useState<string | null>(null);
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number; step: number } | null>(
    null
  );
  const [zoomValue, setZoomValue] = useState(1);
  const [rearLenses, setRearLenses] = useState<{ deviceId: string; label: string }[]>([]);
  const [selectedRearDeviceId, setSelectedRearDeviceId] = useState<string | null>(null);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [pendingNote, setPendingNote] = useState('');

  const enterFullscreen = useCallback(async () => {
    setIsFullscreen(true);
    const el = viewfinderRef.current;
    if (el && typeof el.requestFullscreen === 'function' && !document.fullscreenElement) {
      try {
        await el.requestFullscreen();
      } catch {
        // iOS Safari & embedded iframes rely on CSS fixed inset-0 fullscreen
      }
    }
  }, []);

  const exitFullscreen = useCallback(async () => {
    setIsFullscreen(false);
    if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
      try {
        await document.exitFullscreen();
      } catch {
        // Ignore if not currently in native fullscreen
      }
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (isFullscreen) {
      void exitFullscreen();
    } else {
      void enterFullscreen();
    }
  }, [isFullscreen, enterFullscreen, exitFullscreen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        void exitFullscreen();
      }
    };
    const handleNativeFullscreenChange = () => {
      // If user exited native fullscreen via hardware Back / Esc, sync overlay state if needed
      if (!document.fullscreenElement && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('fullscreenchange', handleNativeFullscreenChange);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('fullscreenchange', handleNativeFullscreenChange);
    };
  }, [isFullscreen, exitFullscreen]);

  useEffect(() => {
    return () => {
      if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
        document.exitFullscreen().catch(() => {});
      }
    };
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setZoomRange(null);
  }, []);

  const startCamera = useCallback(
    async (mode: 'environment' | 'user', deviceIdOverride?: string | null) => {
      stopCamera();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraState('unavailable');
        setCameraError(
          "L'accès caméra direct n'est pas supporté par ce navigateur. Utilisez l'appareil photo du téléphone ci-dessous."
        );
        return;
      }

      setCameraState('initializing');
      setCameraError(null);

      try {
        const videoConstraints: MediaTrackConstraints =
          mode === 'environment' && deviceIdOverride
            ? {
                deviceId: { exact: deviceIdOverride },
                width: { ideal: 1920 },
                height: { ideal: 1080 },
              }
            : {
                facingMode: { ideal: mode },
                width: { ideal: 1920 },
                height: { ideal: 1080 },
              };

        const stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        });

        streamRef.current = stream;

        const track = stream.getVideoTracks()[0];
        const trackSettings = track?.getSettings?.();
        if (trackSettings?.deviceId) {
          setActiveDeviceId(trackSettings.deviceId);
        }

        // Check hardware zoom support on smartphone lens (including 0.5x / 0.6x ultra-wide)
        if (track && typeof track.getCapabilities === 'function') {
          const caps = track.getCapabilities() as MediaTrackCapabilities & {
            zoom?: { min: number; max: number; step: number };
          };
          if (caps.zoom && caps.zoom.max > caps.zoom.min) {
            const minZ = caps.zoom.min;
            const maxZ = Math.min(caps.zoom.max, 6);
            setZoomRange({
              min: minZ,
              max: maxZ,
              step: caps.zoom.step || 0.1,
            });
            const initialZoom = minZ < 1 && maxZ >= 1 ? 1 : minZ;
            setZoomValue(initialZoom);
            if (initialZoom !== minZ) {
              track
                .applyConstraints({
                  advanced: [{ zoom: initialZoom } as MediaTrackConstraintSet],
                })
                .catch(() => {});
            }
          }
        }

        // Discover multiple physical rear cameras (e.g. 0.5x/0.6x ultra-wide lens on Android)
        if (mode === 'environment' && navigator.mediaDevices.enumerateDevices) {
          try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoInputs = devices.filter((d) => d.kind === 'videoinput');
            const backCameras = videoInputs.filter((d) => {
              const lbl = (d.label || '').toLowerCase();
              return (
                !lbl.includes('front') &&
                !lbl.includes('facetime') &&
                !lbl.includes('user') &&
                !lbl.includes('avant')
              );
            });
            if (backCameras.length > 1) {
              setRearLenses(
                backCameras.map((d, idx) => {
                  const lbl = (d.label || '').toLowerCase();
                  let shortLabel = `Obj. ${idx + 1}`;
                  if (lbl.includes('0.5') || lbl.includes('ultra')) {
                    shortLabel = '0.5x';
                  } else if (lbl.includes('0.6')) {
                    shortLabel = '0.6x';
                  } else if (lbl.includes('wide') && !lbl.includes('ultra')) {
                    shortLabel = 'Grand-angle';
                  } else if (lbl.includes('tele')) {
                    shortLabel = 'Télé';
                  } else if (idx === 0) {
                    shortLabel = '1x';
                  }
                  return { deviceId: d.deviceId, label: shortLabel };
                })
              );
            } else {
              setRearLenses([]);
            }
          } catch {
            // Ignore enumerateDevices restriction
          }
        } else if (mode === 'user') {
          setRearLenses([]);
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCameraState('ready');
      } catch (err) {
        if (deviceIdOverride) {
          // Retry with default facingMode if specific lens constraint failed
          setSelectedRearDeviceId(null);
          void startCamera(mode, null);
          return;
        }
        setCameraState('unavailable');
        const msg =
          err instanceof Error && err.name === 'NotAllowedError'
            ? "Permission caméra refusée. Autorisez la caméra ou utilisez le bouton d'appareil natif."
            : "Aucune caméra directe détectée. Utilisez le bouton d'appareil photo natif ci-dessous.";
        setCameraError(msg);
      }
    },
    [stopCamera]
  );

  // Keep smartphone screen awake while taking site photos
  useEffect(() => {
    if (!activeTarget) return;
    let wakeLock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
    };
    if (nav.wakeLock) {
      nav.wakeLock
        .request('screen')
        .then((lock) => {
          wakeLock = lock;
        })
        .catch(() => {});
    }
    return () => {
      wakeLock?.release().catch(() => {});
    };
  }, [activeTarget]);

  useEffect(() => {
    if (activeTarget) {
      void startCamera(facingMode, facingMode === 'environment' ? selectedRearDeviceId : null);
    }
    return () => {
      stopCamera();
    };
  }, [activeTarget, facingMode, selectedRearDeviceId, startCamera, stopCamera]);

  useEffect(() => {
    if (recentSessionPhotos.length === 0) {
      setLastThumbUrl(null);
      return;
    }
    const url = URL.createObjectURL(recentSessionPhotos[0].blob);
    setLastThumbUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [recentSessionPhotos]);

  const handleZoomChange = async (val: number) => {
    setZoomValue(val);
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({
        advanced: [{ zoom: val } as MediaTrackConstraintSet],
      });
    } catch {
      // Ignore unsupported zoom constraint
    }
  };

  const handleCapture = async () => {
    if (!activeTarget || !videoRef.current || cameraState !== 'ready' || capturing) return;

    const video = videoRef.current;
    const srcW = video.videoWidth || 1280;
    const srcH = video.videoHeight || 720;
    const totalPixels = srcW * srcH;
    const scale =
      totalPixels > MAX_PHOTO_MEGAPIXELS
        ? Math.sqrt(MAX_PHOTO_MEGAPIXELS / totalPixels)
        : 1;
    const width = Math.max(1, Math.round(srcW * scale));
    const height = Math.max(1, Math.round(srcH * scale));

    setCapturing(true);
    setFlashActive(true);
    setTimeout(() => setFlashActive(false), 140);

    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas indisponible');

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(video, 0, 0, width, height);

      if (settings.burnStamp) {
        const pathText = activeTarget.pathSegments
          .filter((s) => s.id !== 'root')
          .map((s) => s.name)
          .join(' / ');
        drawCornerStamp(ctx, width, height, pathText || activeTarget.name);
      }

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/jpeg', settings.jpegQuality)
      );

      if (!blob) throw new Error('Impossible de générer le fichier JPEG.');

      const nextSeq = sessionCount + 1;
      setSessionCount(nextSeq);
      const filename = buildPhotoFilename(settings.prefix, nextSeq);
      const cleanNote = pendingNote.trim();
      await onPhotoCaptured(blob, filename, cleanNote || undefined);
      if (cleanNote) {
        setPendingNote('');
      }
    } finally {
      setCapturing(false);
    }
  };

  const handleNativeFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeTarget || !e.target.files || e.target.files.length === 0) return;
    const files = Array.from(e.target.files);
    let seq = Math.max(sessionCount, recentSessionPhotos.length);
    const pathText = activeTarget.pathSegments
      .filter((s) => s.id !== 'root')
      .map((s) => s.name)
      .join(' / ');
    const stampLabel = settings.burnStamp ? pathText || activeTarget.name : undefined;
    const cleanNote = pendingNote.trim() || undefined;

    setImportingProgress({ current: 0, total: files.length });
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        seq += 1;
        const filename = buildPhotoFilename(settings.prefix, seq);
        if (file.type.startsWith('image/')) {
          try {
            const processed = await normalizeBlobToMax15MP(file, {
              stampFolderLabel: stampLabel,
              quality: settings.jpegQuality,
            });
            await onPhotoCaptured(processed, filename, cleanNote);
            setImportingProgress({ current: i + 1, total: files.length });
            continue;
          } catch {
            // Fallback to original file if browser cannot decode format
          }
        }
        await onPhotoCaptured(file, filename, cleanNote);
        setImportingProgress({ current: i + 1, total: files.length });
      }
      setSessionCount(seq);
      if (cleanNote) {
        setPendingNote('');
      }
    } finally {
      setImportingProgress(null);
      e.target.value = '';
    }
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
            Sélectionnez le dossier, sous-dossier ou sous-sous-dossier dans lequel vos photos doivent être classées.
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

  const displaySegments = activeTarget.pathSegments.filter((s) => s.id !== 'root');
  const fullPath =
    displaySegments.length > 0
      ? displaySegments.map((s) => s.name).join(' / ')
      : activeTarget.name;

  return (
    <div className="mx-auto w-full max-w-6xl px-3 sm:px-6 py-2.5 sm:py-5 overflow-x-clip">
      {/* Locked Destination Strip */}
      <div className="mb-2.5 sm:mb-4 rounded-2xl border border-slate-200 bg-white px-3 sm:px-4 py-2 sm:py-3 flex items-center justify-between gap-2.5">
        <div className="min-w-0">
          <div className="text-[11px] sm:text-xs text-slate-500">Classement direct dans</div>
          <div className="text-xs sm:text-sm font-semibold text-slate-900 truncate">{fullPath}</div>
        </div>
        <button
          type="button"
          onClick={onChangeFolder}
          className="min-h-[36px] sm:min-h-[40px] px-3 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
        >
          Changer
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-5 items-start">
        {/* Viewfinder & Shutter Column */}
        <div className="lg:col-span-8 space-y-2.5 sm:space-y-3 min-w-0">
          <div
            ref={viewfinderRef}
            className={
              isFullscreen
                ? 'fixed inset-0 z-50 bg-slate-950 w-full h-[100dvh] overflow-hidden'
                : 'relative rounded-2xl sm:rounded-3xl overflow-hidden bg-slate-950 aspect-square max-h-[52dvh] sm:max-h-none sm:aspect-[4/3] lg:aspect-[16/10] w-full border border-slate-800'
            }
          >
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
            <div
              className={`absolute top-0 inset-x-0 flex items-start justify-between gap-2 ${
                isFullscreen
                  ? 'bg-gradient-to-b from-slate-950/85 via-slate-950/45 to-transparent pt-3.5 pb-6 px-3.5 sm:px-5'
                  : 'p-3'
              }`}
            >
              <div className="min-w-0 flex flex-col gap-1">
                {isFullscreen && (
                  <div className="px-2.5 py-1 rounded-lg bg-slate-950/70 backdrop-blur-md text-xs font-semibold text-amber-400 truncate max-w-[55vw]">
                    {fullPath}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-1.5">
                  <div className="self-start px-3 py-1.5 rounded-xl bg-slate-950/65 backdrop-blur-md text-xs font-medium text-white tabular-nums">
                    Série : {sessionCount} photo{sessionCount > 1 ? 's' : ''}
                  </div>
                  {pendingNote.trim() && (
                    <div className="px-2.5 py-1.5 rounded-xl bg-amber-500/90 text-slate-950 text-[11px] font-bold inline-flex items-center gap-1 max-w-[180px] truncate">
                      <MessageSquareText className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{pendingNote.trim()}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    onUpdateSettings({ ...settings, burnStamp: !settings.burnStamp })
                  }
                  aria-label={
                    settings.burnStamp
                      ? 'Désactiver l’horodatage sur photo'
                      : 'Activer l’horodatage sur photo'
                  }
                  title={
                    settings.burnStamp
                      ? 'Horodatage sur photo : Activé'
                      : 'Horodatage sur photo : Désactivé'
                  }
                  className={`min-h-[40px] min-w-[40px] rounded-xl backdrop-blur-md flex items-center justify-center transition-colors cursor-pointer ${
                    settings.burnStamp
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-slate-950/65 text-white hover:bg-slate-900'
                  }`}
                >
                  <Stamp className="w-4 h-4" />
                </button>
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
                  onClick={() => {
                    setSelectedRearDeviceId(null);
                    setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'));
                  }}
                  aria-label="Changer de caméra"
                  className="min-h-[40px] min-w-[40px] rounded-xl bg-slate-950/65 backdrop-blur-md text-white hover:bg-slate-900 flex items-center justify-center cursor-pointer"
                >
                  <SwitchCamera className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={toggleFullscreen}
                  aria-label={isFullscreen ? 'Quitter le plein écran' : 'Mode plein écran'}
                  className={`min-h-[40px] px-2.5 sm:px-3 rounded-xl backdrop-blur-md text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                    isFullscreen
                      ? 'bg-white/20 border border-white/30 text-white hover:bg-white/30'
                      : 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                  }`}
                >
                  {isFullscreen ? (
                    <>
                      <Minimize2 className="w-4 h-4 shrink-0" />
                      <span>Quitter</span>
                    </>
                  ) : (
                    <>
                      <Maximize2 className="w-4 h-4 shrink-0" />
                      <span>Plein écran</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Hardware Zoom Presets (0.5x / 0.6x / 1x / 2x) & Physical Rear Lenses */}
            {cameraState === 'ready' && (zoomRange || rearLenses.length > 1) && (
              <div
                className={`absolute left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 max-w-[92%] ${
                  isFullscreen ? 'bottom-28' : 'bottom-24'
                }`}
              >
                {rearLenses.length > 1 && (
                  <div className="flex items-center gap-1 px-1.5 py-1 rounded-xl bg-slate-950/75 backdrop-blur-md border border-white/15">
                    {rearLenses.map((lens) => {
                      const isCurrent =
                        selectedRearDeviceId === lens.deviceId ||
                        (!selectedRearDeviceId && activeDeviceId === lens.deviceId);
                      return (
                        <button
                          key={lens.deviceId}
                          type="button"
                          onClick={() => setSelectedRearDeviceId(lens.deviceId)}
                          className={`min-h-[30px] px-2.5 rounded-lg text-[11px] font-bold transition-colors whitespace-nowrap cursor-pointer ${
                            isCurrent
                              ? 'bg-amber-500 text-slate-950'
                              : 'text-white hover:bg-white/15'
                          }`}
                        >
                          {lens.label}
                        </button>
                      );
                    })}
                  </div>
                )}

                {zoomRange && (
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-slate-950/75 backdrop-blur-md text-white">
                    {zoomRange.min < 1 && (
                      <button
                        type="button"
                        onClick={() => handleZoomChange(zoomRange.min)}
                        className={`min-h-[28px] px-2 rounded-lg text-[11px] font-bold tabular-nums cursor-pointer ${
                          Math.abs(zoomValue - zoomRange.min) < 0.08
                            ? 'bg-amber-500 text-slate-950'
                            : 'bg-white/10 text-white hover:bg-white/20'
                        }`}
                      >
                        {zoomRange.min.toFixed(1)}x
                      </button>
                    )}
                    {zoomRange.min < 1 && zoomRange.max >= 1 && (
                      <button
                        type="button"
                        onClick={() => handleZoomChange(1)}
                        className={`min-h-[28px] px-2 rounded-lg text-[11px] font-bold tabular-nums cursor-pointer ${
                          Math.abs(zoomValue - 1) < 0.15
                            ? 'bg-amber-500 text-slate-950'
                            : 'bg-white/10 text-white hover:bg-white/20'
                        }`}
                      >
                        1x
                      </button>
                    )}
                    <ZoomIn className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <input
                      type="range"
                      min={zoomRange.min}
                      max={zoomRange.max}
                      step={zoomRange.step}
                      value={zoomValue}
                      onChange={(e) => handleZoomChange(Number(e.target.value))}
                      aria-label="Zoom caméra"
                      className="w-24 sm:w-28 accent-amber-500"
                    />
                    <span className="text-xs font-mono tabular-nums w-9 text-right">
                      {zoomValue.toFixed(1)}x
                    </span>
                  </div>
                )}
              </div>
            )}

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
                    onClick={() => nativeCameraInputRef.current?.click()}
                    className="min-h-[48px] px-5 rounded-xl bg-amber-500 text-slate-950 text-sm font-semibold hover:bg-amber-400 inline-flex items-center gap-2 cursor-pointer"
                  >
                    <Camera className="w-4 h-4" />
                    <span>Appareil photo du téléphone</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    className="min-h-[48px] px-5 rounded-xl bg-white text-slate-950 text-sm font-semibold hover:bg-slate-100 inline-flex items-center gap-2 cursor-pointer"
                  >
                    <ImagePlus className="w-4 h-4 text-amber-600" />
                    <span>Galerie téléphone</span>
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

            {/* Import Progress Overlay */}
            {importingProgress && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-slate-950/80 backdrop-blur-sm text-white p-6">
                <Loader2 className="w-7 h-7 animate-spin text-amber-400" />
                <div className="text-sm font-semibold tabular-nums">
                  Importation galerie {importingProgress.current} / {importingProgress.total}...
                </div>
              </div>
            )}

            {/* Bottom Shutter Bar inside Viewfinder (Thumb-Zone) */}
            <div
              className={`absolute bottom-0 inset-x-0 bg-gradient-to-t from-slate-950/90 via-slate-950/55 to-transparent pt-6 sm:pt-8 px-3.5 sm:px-5 flex items-center justify-between gap-3 ${
                isFullscreen ? 'pb-6 pb-safe' : 'pb-3 sm:pb-4'
              }`}
            >
              {/* Left: Last Capture Thumbnail / Transfer shortcut */}
              <button
                type="button"
                onClick={() => {
                  void exitFullscreen();
                  onOpenTransfer();
                }}
                className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl overflow-hidden border-2 border-white/30 bg-slate-900 flex items-center justify-center shrink-0 cursor-pointer"
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
                    : () => nativeCameraInputRef.current?.click()
                }
                disabled={capturing || Boolean(importingProgress)}
                aria-label="Prendre une photo"
                className={`${
                  isFullscreen
                    ? 'w-[76px] h-[76px]'
                    : 'w-[66px] h-[66px] sm:w-[72px] sm:h-[72px]'
                } rounded-full border-4 border-white bg-amber-500 hover:bg-amber-400 active:scale-95 transition-transform flex items-center justify-center shadow-lg cursor-pointer disabled:opacity-60`}
              >
                <span
                  className={`${
                    isFullscreen
                      ? 'w-[60px] h-[60px]'
                      : 'w-[50px] h-[50px] sm:w-[56px] sm:h-[56px]'
                  } rounded-full border-2 border-slate-950/20`}
                />
              </button>

              {/* Right: Phone Gallery Multi-Import Button */}
              <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                disabled={Boolean(importingProgress)}
                className="min-h-[44px] sm:min-h-[48px] px-3 sm:px-3.5 rounded-xl bg-slate-900/85 border border-white/20 text-white text-xs font-semibold hover:bg-slate-800 inline-flex items-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-60"
                title="Importer une ou plusieurs photos déjà présentes dans votre galerie téléphone"
              >
                <ImagePlus className="w-4 h-4 text-amber-400" />
                <span>Galerie</span>
              </button>
            </div>
          </div>

          <input
            ref={nativeCameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            onChange={handleNativeFiles}
            className="hidden"
          />
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleNativeFiles}
            className="hidden"
          />
        </div>

        {/* Right Controls & Live Burst Feed */}
        <aside className="lg:col-span-4 space-y-3 sm:space-y-4 min-w-0">
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

            <div className="pt-3 border-t border-slate-100 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5">
                  <MessageSquareText className="w-3.5 h-3.5 text-amber-600" />
                  <span>Note rapide pour la prochaine photo</span>
                </label>
                {pendingNote && (
                  <button
                    type="button"
                    onClick={() => setPendingNote('')}
                    className="text-[11px] font-medium text-slate-500 hover:text-slate-900 cursor-pointer"
                  >
                    Effacer
                  </button>
                )}
              </div>
              <input
                type="text"
                maxLength={300}
                value={pendingNote}
                onChange={(e) => setPendingNote(e.target.value)}
                placeholder="Ex : Fissure mur nord (exportée dans notes.txt)"
                className="w-full min-h-[40px] px-3 rounded-xl border border-slate-300 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>

          {/* Live Session Photos for Active Folder */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">Photos classées</h3>
              <button
                type="button"
                onClick={onOpenTransfer}
                className="text-xs font-medium text-sky-700 hover:underline cursor-pointer"
              >
                Transférer
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                <div className="text-slate-500">Dans ce dossier</div>
                <div className="mt-1 text-lg font-bold text-slate-900 tabular-nums">
                  {recentSessionPhotos.length}
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                <div className="text-slate-500">Total dans l’appli</div>
                <div className="mt-1 text-lg font-bold text-slate-900 tabular-nums">
                  {totalStoredPhotos}
                </div>
              </div>
            </div>

            {recentSessionPhotos.slice(0, 4).length > 0 && (
              <ul className="divide-y divide-slate-100 pt-1">
                {recentSessionPhotos.slice(0, 4).map((p) => (
                  <li key={p.id} className="py-2 flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono text-slate-700 truncate">{p.filename}</span>
                    <span className="shrink-0 inline-flex items-center gap-1 font-medium text-emerald-700">
                      <Check className="w-3.5 h-3.5" />
                      Classée
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {/* Quick Import Shortcuts */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => galleryInputRef.current?.click()}
              disabled={Boolean(importingProgress)}
              className="min-h-[44px] px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-xs font-semibold hover:bg-slate-100 inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <ImagePlus className="w-4 h-4 text-amber-600 shrink-0" />
              <span>Importer galerie</span>
            </button>
            <button
              type="button"
              onClick={() => nativeCameraInputRef.current?.click()}
              disabled={Boolean(importingProgress)}
              className="min-h-[44px] px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 text-xs font-semibold hover:bg-slate-100 inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Camera className="w-4 h-4 text-slate-700 shrink-0" />
              <span>Appareil natif</span>
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
};
