import React, { useEffect, useRef, useState } from 'react';
import {
  Archive,
  CheckCircle2,
  Download,
  FolderOutput,
  Laptop,
  Loader2,
  Send,
  Smartphone,
  Trash2,
} from 'lucide-react';
import { QueuedPhoto } from '../types';
import { buildPhotosZipBlob, formatBytes } from '../lib/storage';
import {
  P2PReceiverSession,
  ReceivedPcPhoto,
  sendPhotosViaP2P,
  startP2PReceiver,
} from '../lib/p2pTransfer';

interface FileSystemWritableLike {
  write: (data: Blob) => Promise<void>;
  close: () => Promise<void>;
}

interface FileSystemFileHandleLike {
  createWritable: () => Promise<FileSystemWritableLike>;
}

interface FileSystemDirectoryHandleLike {
  getDirectoryHandle: (
    name: string,
    options?: { create?: boolean }
  ) => Promise<FileSystemDirectoryHandleLike>;
  getFileHandle: (
    name: string,
    options?: { create?: boolean }
  ) => Promise<FileSystemFileHandleLike>;
}

interface TransferRoomItem {
  id: string;
  filename: string;
  folderPath: string;
  size: number;
  uploadedAt: number;
}

interface TransferRoomStatus {
  code: string;
  expiresAt: number;
  received: boolean;
  photoCount: number;
  totalBytes: number;
  items: TransferRoomItem[];
}

interface UploadQueueProps {
  photos: QueuedPhoto[];
  isOnline: boolean;
  pendingPcAck: {
    code: string;
    sentIds: string[];
    autoDelete: boolean;
    mode: 'http' | 'p2p';
  } | null;
  onStartWaitingPcAck: (
    pending: {
      code: string;
      sentIds: string[];
      autoDelete: boolean;
      mode: 'http' | 'p2p';
    } | null
  ) => void;
  onConfirmPcAck: (sentIds: string[], autoDelete: boolean) => Promise<void>;
  onDeletePhoto: (id: string) => Promise<void>;
  onDeletePhotosBatch: (ids: string[]) => Promise<void>;
}

const PhotoThumbnail: React.FC<{ blob: Blob; alt: string }> = ({ blob, alt }) => {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  if (!url) {
    return <div className="w-14 h-14 rounded-xl bg-slate-100 shrink-0" />;
  }

  return (
    <img
      src={url}
      alt={alt}
      className="w-14 h-14 rounded-xl object-cover bg-slate-100 shrink-0 border border-slate-200"
    />
  );
};

export const UploadQueue: React.FC<UploadQueueProps> = ({
  photos,
  isOnline,
  pendingPcAck,
  onStartWaitingPcAck,
  onConfirmPcAck,
  onDeletePhoto,
  onDeletePhotosBatch,
}) => {
  const [roleMode, setRoleMode] = useState<'phone' | 'pc'>(() =>
    photos.length > 0 ? 'phone' : 'pc'
  );

  const [storageEstimate, setStorageEstimate] = useState<{
    availableBytes: number;
    estimatedPhotosLeft: number;
  } | null>(null);

  // Phone -> PC Send State
  const [targetCode, setTargetCode] = useState('');
  const [autoDeleteAfterPc, setAutoDeleteAfterPc] = useState(true);
  const [sendingToPc, setSendingToPc] = useState(false);
  const [sendProgress, setSendProgress] = useState<{ sent: number; total: number } | null>(null);
  const [phoneTransferMsg, setPhoneTransferMsg] = useState<string | null>(null);

  // Phone Local ZIP State
  const [exportingZip, setExportingZip] = useState(false);
  const [deleteAfterZip, setDeleteAfterZip] = useState(true);

  // PC Receiver State (supports both HTTP Relay and WebRTC P2P for GitHub Pages)
  const [pcTransport, setPcTransport] = useState<'http' | 'p2p' | null>(null);
  const [pcCode, setPcCode] = useState<string | null>(null);
  const [pcRoomStatus, setPcRoomStatus] = useState<TransferRoomStatus | null>(null);
  const [p2pReceivedPhotos, setP2pReceivedPhotos] = useState<ReceivedPcPhoto[]>([]);
  const [p2pSaved, setP2pSaved] = useState(false);
  const p2pSessionRef = useRef<P2PReceiverSession | null>(null);

  const [creatingRoom, setCreatingRoom] = useState(false);
  const [savingToDisk, setSavingToDisk] = useState(false);
  const [saveDiskProgress, setSaveDiskProgress] = useState<string | null>(null);
  const [pcError, setPcError] = useState<string | null>(null);

  const supportsDirectoryPicker =
    typeof window !== 'undefined' &&
    'showDirectoryPicker' in window &&
    window.self === window.top;

  const totalBytes = photos.reduce((acc, p) => acc + p.size, 0);

  useEffect(() => {
    if (!navigator.storage || typeof navigator.storage.estimate !== 'function') return;
    navigator.storage
      .estimate()
      .then((est) => {
        if (typeof est.quota === 'number' && typeof est.usage === 'number') {
          const availableBytes = Math.max(0, est.quota - est.usage);
          const avgPhotoSize =
            photos.length > 0
              ? Math.max(350_000, totalBytes / photos.length)
              : 2_500_000;
          const estimatedPhotosLeft = Math.floor(availableBytes / avgPhotoSize);
          setStorageEstimate({ availableBytes, estimatedPhotosLeft });
        }
      })
      .catch(() => {});
  }, [photos.length, totalBytes]);

  // Clean up P2P receiver if unmounted
  useEffect(() => {
    return () => {
      p2pSessionRef.current?.destroy();
    };
  }, []);

  // Poll HTTP room status when in HTTP relay mode
  useEffect(() => {
    if (!pcCode || pcTransport !== 'http') return;
    let active = true;

    const poll = async () => {
      try {
        const res = await fetch(`./api/transfer/${pcCode}/status`);
        if (!res.ok) {
          if (res.status === 404 && active) {
            setPcRoomStatus(null);
            setPcCode(null);
          }
          return;
        }
        const data = (await res.json()) as TransferRoomStatus;
        if (active) setPcRoomStatus(data);
      } catch {
        // Ignore transient poll error
      }
    };

    poll();
    const timer = setInterval(poll, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [pcCode, pcTransport]);

  const handleSendToPc = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = targetCode.replace(/\D/g, '');
    if (cleanCode.length !== 6 || photos.length === 0) return;

    setSendingToPc(true);
    setPhoneTransferMsg(null);
    setSendProgress({ sent: 0, total: photos.length });

    try {
      // Detect if Node HTTP relay is available; otherwise use WebRTC P2P (works on GitHub Pages)
      let useHttp = false;
      try {
        const checkRes = await fetch(`./api/transfer/${cleanCode}/status`);
        const contentType = checkRes.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          if (!checkRes.ok) {
            setPhoneTransferMsg('Code invalide ou expiré. Vérifiez le code affiché sur le PC.');
            return;
          }
          useHttp = true;
        }
      } catch {
        useHttp = false;
      }

      const sentIds: string[] = [];

      if (useHttp) {
        for (let i = 0; i < photos.length; i++) {
          const photo = photos[i];
          const res = await fetch(`./api/transfer/${cleanCode}/upload`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
              'X-Photo-Id': encodeURIComponent(photo.id),
              'X-File-Name': encodeURIComponent(photo.filename),
              'X-Folder-Path': encodeURIComponent(photo.folderPath),
              'X-Content-Type': photo.blob.type || 'image/jpeg',
            },
            body: photo.blob,
          });
          if (!res.ok) {
            throw new Error(`Échec sur ${photo.filename}`);
          }
          sentIds.push(photo.id);
          setSendProgress({ sent: i + 1, total: photos.length });
        }

        onStartWaitingPcAck({
          code: cleanCode,
          sentIds,
          autoDelete: autoDeleteAfterPc,
          mode: 'http',
        });
      } else {
        const idsToSend = photos.map((p) => p.id);
        let alreadyConfirmed = false;
        await sendPhotosViaP2P(
          cleanCode,
          photos,
          (sent, total) => setSendProgress({ sent, total }),
          async () => {
            alreadyConfirmed = true;
            await onConfirmPcAck(idsToSend, autoDeleteAfterPc);
            setPhoneTransferMsg(
              autoDeleteAfterPc
                ? `Transfert confirmé par le PC : ${idsToSend.length} photo(s) supprimée(s) automatiquement.`
                : 'Le PC a bien enregistré vos photos.'
            );
          }
        );
        sentIds.push(...idsToSend);
        if (!alreadyConfirmed) {
          onStartWaitingPcAck({
            code: cleanCode,
            sentIds,
            autoDelete: autoDeleteAfterPc,
            mode: 'p2p',
          });
        }
      }

      setPhoneTransferMsg((prev) =>
        prev?.startsWith('Transfert confirmé') || prev?.startsWith('Le PC a bien')
          ? prev
          : `${sentIds.length} photo(s) envoyée(s) ! Cliquez sur « Enregistrer » ou « Télécharger en ZIP » sur votre PC.`
      );
    } catch (err) {
      setPhoneTransferMsg(
        err instanceof Error ? err.message : 'Erreur lors de l’envoi vers le PC.'
      );
    } finally {
      setSendingToPc(false);
    }
  };

  const handleLocalZipExport = async () => {
    if (photos.length === 0) return;
    setExportingZip(true);
    setPhoneTransferMsg(null);
    try {
      const zipBlob = await buildPhotosZipBlob(photos);
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Chantiers_${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);

      if (deleteAfterZip) {
        const ids = photos.map((p) => p.id);
        await onDeletePhotosBatch(ids);
        setPhoneTransferMsg(
          `ZIP exporté et ${ids.length} photo(s) supprimée(s) de l’appli.`
        );
      } else {
        setPhoneTransferMsg('Archive ZIP prête et téléchargée.');
      }
    } finally {
      setExportingZip(false);
    }
  };

  const handleCreatePcCode = async () => {
    setCreatingRoom(true);
    setPcError(null);
    setP2pReceivedPhotos([]);
    setP2pSaved(false);
    setPcRoomStatus(null);
    p2pSessionRef.current?.destroy();
    p2pSessionRef.current = null;

    try {
      const res = await fetch('./api/transfer/create', { method: 'POST' });
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const data = (await res.json()) as { code: string };
        setPcTransport('http');
        setPcCode(data.code);
        setCreatingRoom(false);
        return;
      }
    } catch {
      // Static hosting (GitHub Pages): fall back cleanly to PeerJS WebRTC P2P
    }

    setPcTransport('p2p');
    const session = startP2PReceiver({
      onReady: (code) => {
        setPcCode(code);
        setCreatingRoom(false);
      },
      onPhotoReceived: (photo) => {
        setP2pReceivedPhotos((prev) =>
          prev.some((p) => p.id === photo.id) ? prev : [...prev, photo]
        );
      },
      onError: (msg) => {
        setPcError(msg);
        setCreatingRoom(false);
      },
    });
    p2pSessionRef.current = session;
  };

  const activePcPhotoCount =
    pcTransport === 'p2p' ? p2pReceivedPhotos.length : pcRoomStatus?.photoCount ?? 0;
  const activePcTotalBytes =
    pcTransport === 'p2p'
      ? p2pReceivedPhotos.reduce((sum, p) => sum + p.size, 0)
      : pcRoomStatus?.totalBytes ?? 0;
  const activePcReceived =
    pcTransport === 'p2p' ? p2pSaved : Boolean(pcRoomStatus?.received);

  const handlePcDownloadZip = async () => {
    if (!pcCode) return;
    setPcError(null);

    if (pcTransport === 'p2p') {
      if (p2pReceivedPhotos.length === 0) return;
      const zipInput: QueuedPhoto[] = p2pReceivedPhotos.map((p) => ({
        id: p.id,
        filename: p.filename,
        blob: p.blob,
        size: p.size,
        capturedAt: p.uploadedAt,
        folderId: '',
        folderPath: p.folderPath,
      }));
      const zipBlob = await buildPhotosZipBlob(zipInput);
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Chantiers_${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);

      p2pSessionRef.current?.sendAck();
      setP2pSaved(true);
      return;
    }

    const link = document.createElement('a');
    link.href = `./api/transfer/${pcCode}/zip`;
    link.download = `Chantiers_${new Date().toISOString().slice(0, 10)}.zip`;
    link.click();

    await fetch(`./api/transfer/${pcCode}/ack`, { method: 'POST' });
    setPcRoomStatus((prev) => (prev ? { ...prev, received: true } : prev));
  };

  const handlePcSaveToFolder = async () => {
    if (!pcCode || activePcPhotoCount === 0) return;
    const picker = (
      window as unknown as {
        showDirectoryPicker?: (opts?: {
          mode?: 'read' | 'readwrite';
        }) => Promise<FileSystemDirectoryHandleLike>;
      }
    ).showDirectoryPicker;

    if (!picker) {
      setPcError(
        'Votre navigateur ne permet pas l’écriture directe dans un dossier. Utilisez le bouton ZIP.'
      );
      return;
    }

    setSavingToDisk(true);
    setPcError(null);
    try {
      const rootHandle = await picker({ mode: 'readwrite' });

      if (pcTransport === 'p2p') {
        for (let i = 0; i < p2pReceivedPhotos.length; i++) {
          const item = p2pReceivedPhotos[i];
          setSaveDiskProgress(`${i + 1} / ${p2pReceivedPhotos.length}`);

          let dirHandle = rootHandle;
          const segments = item.folderPath
            .split('/')
            .map((s) => s.trim())
            .filter(Boolean);
          for (const seg of segments) {
            dirHandle = await dirHandle.getDirectoryHandle(seg, { create: true });
          }
          const fileHandle = await dirHandle.getFileHandle(item.filename, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(item.blob);
          await writable.close();
        }
        p2pSessionRef.current?.sendAck();
        setP2pSaved(true);
      } else if (pcRoomStatus) {
        for (let i = 0; i < pcRoomStatus.items.length; i++) {
          const item = pcRoomStatus.items[i];
          setSaveDiskProgress(`${i + 1} / ${pcRoomStatus.items.length}`);

          const fileRes = await fetch(
            `./api/transfer/${pcCode}/file/${encodeURIComponent(item.id)}`
          );
          if (!fileRes.ok) throw new Error(`Lecture impossible pour ${item.filename}`);
          const blob = await fileRes.blob();

          let dirHandle = rootHandle;
          const segments = item.folderPath
            .split('/')
            .map((s) => s.trim())
            .filter(Boolean);

          for (const seg of segments) {
            dirHandle = await dirHandle.getDirectoryHandle(seg, { create: true });
          }

          const fileHandle = await dirHandle.getFileHandle(item.filename, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
        }
        await fetch(`./api/transfer/${pcCode}/ack`, { method: 'POST' });
        setPcRoomStatus((prev) => (prev ? { ...prev, received: true } : prev));
      }

      setSaveDiskProgress(null);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setSaveDiskProgress(null);
      } else {
        setPcError(
          err instanceof Error
            ? err.message
            : 'Erreur lors de l’écriture dans le dossier. Utilisez le téléchargement ZIP.'
        );
      }
    } finally {
      setSavingToDisk(false);
    }
  };

  const handleDownloadSingle = (photo: QueuedPhoto) => {
    const url = URL.createObjectURL(photo.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = photo.filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-4 sm:py-5 space-y-6">
      {/* Mode Selector: Phone (Sender) vs Work PC (Receiver) */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-200/70">
          <button
            type="button"
            onClick={() => setRoleMode('phone')}
            className={`min-h-[42px] px-4 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap cursor-pointer ${
              roleMode === 'phone'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Smartphone className="w-4 h-4 text-amber-600" />
            <span>Envoyer depuis ce téléphone</span>
          </button>
          <button
            type="button"
            onClick={() => setRoleMode('pc')}
            className={`min-h-[42px] px-4 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap cursor-pointer ${
              roleMode === 'pc'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Laptop className="w-4 h-4 text-sky-600" />
            <span>Récupérer sur mon PC boulot</span>
          </button>
        </div>

        <div className="text-xs text-slate-500 tabular-nums">
          {photos.length} photo{photos.length > 1 ? 's' : ''} stockée
          {photos.length > 1 ? 's' : ''} ({formatBytes(totalBytes)})
          {storageEstimate && (
            <>
              <span className="mx-1.5">·</span>
              <span>
                Capacité restante : ~
                {storageEstimate.estimatedPhotosLeft.toLocaleString('fr-FR')} photos
              </span>
            </>
          )}
        </div>
      </div>

      {/* PHONE SENDER VIEW */}
      {roleMode === 'phone' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          {/* Card 1: Direct Send to Work PC via 6-digit code */}
          <div className="lg:col-span-7 rounded-2xl border border-slate-200 bg-white p-5 flex flex-col justify-between gap-4">
            <div className="space-y-2">
              <h2 className="text-base font-semibold text-slate-900">
                1. Envoyer directement vers votre PC boulot
              </h2>
              <p className="text-sm text-slate-600">
                Ouvrez ChantierShot sur votre PC du bureau, cliquez sur « Récupérer sur mon PC boulot », puis saisissez le code à 6 chiffres ci-dessous.
              </p>
            </div>

            <form onSubmit={handleSendToPc} className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={targetCode}
                  onChange={(e) => setTargetCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="Code à 6 chiffres (ex: 482915)"
                  className="flex-1 min-h-[48px] px-4 rounded-xl border border-slate-300 text-base font-mono tracking-widest text-slate-900 placeholder:text-slate-400 placeholder:tracking-normal placeholder:font-sans focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <button
                  type="submit"
                  disabled={
                    sendingToPc ||
                    !isOnline ||
                    photos.length === 0 ||
                    targetCode.replace(/\D/g, '').length !== 6
                  }
                  className="min-h-[48px] px-5 rounded-xl bg-amber-500 text-slate-950 text-sm font-semibold hover:bg-amber-400 disabled:opacity-50 inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
                >
                  {sendingToPc ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  <span>
                    {sendProgress && sendingToPc
                      ? `Envoi ${sendProgress.sent}/${sendProgress.total}...`
                      : `Envoyer (${photos.length})`}
                  </span>
                </button>
              </div>

              <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoDeleteAfterPc}
                  onChange={(e) => setAutoDeleteAfterPc(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                />
                <span>
                  Supprimer automatiquement les photos de l’appli dès que le PC les a enregistrées
                </span>
              </label>
            </form>

            {(phoneTransferMsg || pendingPcAck) && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-medium text-slate-800 flex items-center gap-2">
                {pendingPcAck ? (
                  <Loader2 className="w-4 h-4 animate-spin text-sky-600 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                )}
                <span>
                  {phoneTransferMsg ||
                    `En attente de confirmation du PC (code ${pendingPcAck?.code}) pour supprimer automatiquement les ${pendingPcAck?.sentIds.length} photo(s)...`}
                </span>
              </div>
            )}
          </div>

          {/* Card 2: Instant Local ZIP Export + Auto Cleanup */}
          <div className="lg:col-span-5 rounded-2xl border border-slate-200 bg-white p-5 flex flex-col justify-between gap-4">
            <div className="space-y-2">
              <h2 className="text-base font-semibold text-slate-900">
                2. Export ZIP classé (fonctionne hors-ligne)
              </h2>
              <p className="text-sm text-slate-600">
                Génère une archive ZIP avec tous vos chantiers et sous-dossiers déjà rangés, puis nettoie l’appli.
              </p>
            </div>

            <div className="space-y-3">
              <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={deleteAfterZip}
                  onChange={(e) => setDeleteAfterZip(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                />
                <span>Supprimer de l’appli juste après l’export ZIP</span>
              </label>

              <button
                type="button"
                onClick={handleLocalZipExport}
                disabled={exportingZip || photos.length === 0}
                className="w-full min-h-[48px] px-4 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-50 inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                {exportingZip ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Archive className="w-4 h-4" />
                )}
                <span>Télécharger le ZIP classé ({photos.length})</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WORK PC RECEIVER VIEW */}
      {roleMode === 'pc' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Réception sur votre PC boulot
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Générez un code, envoyez depuis votre téléphone, puis enregistrez directement dans un dossier du serveur ou en ZIP déjà classé.
              </p>
            </div>

            {!pcCode && (
              <button
                type="button"
                onClick={handleCreatePcCode}
                disabled={creatingRoom || !isOnline}
                className="min-h-[48px] px-5 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-50 inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {creatingRoom && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>Générer un code de réception</span>
              </button>
            )}
          </div>

          {pcError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {pcError}
            </div>
          )}

          {pcCode && (
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center pt-2 border-t border-slate-100">
              <div className="md:col-span-5 rounded-2xl bg-slate-950 text-white p-5 text-center space-y-2">
                <div className="text-xs text-slate-400">
                  Saisissez ce code sur votre téléphone
                </div>
                <div className="text-4xl font-bold font-mono tracking-[0.2em] tabular-nums text-amber-400">
                  {pcCode}
                </div>
                <div className="text-xs text-slate-400 tabular-nums">
                  {activePcPhotoCount > 0
                    ? `${activePcPhotoCount} photo(s) reçue(s) · ${formatBytes(
                        activePcTotalBytes
                      )}`
                    : 'En attente du téléphone...'}
                </div>
              </div>

              <div className="md:col-span-7 space-y-3">
                {activePcPhotoCount > 0 ? (
                  <>
                    {activePcReceived ? (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 flex items-center gap-2.5">
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                        <span>
                          Photos enregistrées ! Le téléphone supprime automatiquement sa copie locale.
                        </span>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-700">
                        <strong>{activePcPhotoCount}</strong> photo(s) prête(s) avec leurs dossiers de chantier :
                      </p>
                    )}

                    <div className="flex flex-col sm:flex-row gap-3">
                      {supportsDirectoryPicker && (
                        <button
                          type="button"
                          onClick={handlePcSaveToFolder}
                          disabled={savingToDisk}
                          className="flex-1 min-h-[48px] px-4 rounded-xl bg-amber-500 text-slate-950 text-sm font-semibold hover:bg-amber-400 disabled:opacity-50 inline-flex items-center justify-center gap-2 cursor-pointer"
                        >
                          {savingToDisk ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <FolderOutput className="w-4 h-4" />
                          )}
                          <span>
                            {savingToDisk && saveDiskProgress
                              ? `Écriture ${saveDiskProgress}...`
                              : 'Enregistrer dans un dossier PC / Serveur'}
                          </span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={handlePcDownloadZip}
                        className="flex-1 min-h-[48px] px-4 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 inline-flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <Archive className="w-4 h-4" />
                        <span>Télécharger en ZIP classé</span>
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-slate-600 space-y-2">
                    <p>
                      1. Sur votre téléphone, ouvrez l’onglet <strong>Transfert</strong> puis « Envoyer depuis ce téléphone ».
                    </p>
                    <p>
                      2. Tapez le code <strong>{pcCode}</strong> et appuyez sur Envoyer.
                    </p>
                    <p>
                      3. Vous pourrez ensuite tout copier en un clic sur votre PC ou lecteur réseau du serveur.
                    </p>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleCreatePcCode}
                  className="text-xs font-medium text-slate-500 hover:text-slate-900 underline cursor-pointer"
                >
                  Générer un nouveau code
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stored Photos List */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Photos stockées dans l’application
          </h2>
          {photos.length > 0 && (
            <button
              type="button"
              onClick={() => onDeletePhotosBatch(photos.map((p) => p.id))}
              className="text-xs font-medium text-red-600 hover:underline cursor-pointer"
            >
              Tout vider ({photos.length})
            </button>
          )}
        </div>

        {photos.length === 0 ? (
          <div className="py-10 px-4 text-center text-sm text-slate-500">
            Aucune photo en attente sur cet appareil.
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
                        })}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  <button
                    type="button"
                    onClick={() => handleDownloadSingle(photo)}
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
