import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileUp,
  FolderInput,
  FolderTree,
  Laptop,
  ListPlus,
  Loader2,
  Send,
  Smartphone,
  X,
} from 'lucide-react';
import { LocalFolderRecord, PortableFolderBundle } from '../types';
import {
  countPortableNodes,
  exportFolderBundle,
  extractFolderPathsFromFileList,
  importFolderBundle,
  parsePathsToFolderBundle,
  parsePortableFolderBundleText,
} from '../lib/storage';
import {
  FolderReceiverSession,
  sendFolderBundleViaP2P,
  startFolderBundleReceiverP2P,
} from '../lib/p2pTransfer';

interface FolderPrepModalProps {
  allFolders: LocalFolderRecord[];
  selectedChantier: LocalFolderRecord | null;
  initialMode?: 'pc' | 'phone';
  isOnline: boolean;
  onFoldersChanged: () => Promise<void> | void;
  onFeedback?: (msg: string) => void;
  onClose: () => void;
}

interface DirHandleLike {
  name: string;
  kind: 'file' | 'directory';
  values?: () => AsyncIterable<DirHandleLike>;
}

const IGNORED_SYSTEM_DIRS = new Set([
  '.git',
  'node_modules',
  '$recycle.bin',
  'system volume information',
  '__macosx',
]);

async function collectDirectoryPathsFromHandle(
  handle: DirHandleLike,
  prefix: string,
  out: string[],
  depth = 0
): Promise<void> {
  if (depth > 8) return;
  const currentPath = prefix ? `${prefix}/${handle.name}` : handle.name;
  out.push(currentPath);

  if (typeof handle.values !== 'function') return;
  for await (const entry of handle.values()) {
    if (entry.kind === 'directory') {
      if (IGNORED_SYSTEM_DIRS.has(entry.name.toLowerCase())) continue;
      await collectDirectoryPathsFromHandle(entry, currentPath, out, depth + 1);
    }
  }
}

export const FolderPrepModal: React.FC<FolderPrepModalProps> = ({
  allFolders,
  selectedChantier,
  initialMode,
  isOnline,
  onFoldersChanged,
  onFeedback,
  onClose,
}) => {
  const defaultMode: 'pc' | 'phone' =
    initialMode ||
    (typeof window !== 'undefined' && window.innerWidth >= 768 && allFolders.length > 0
      ? 'pc'
      : allFolders.length === 0
      ? 'phone'
      : 'pc');

  const [mode, setMode] = useState<'pc' | 'phone'>(defaultMode);
  const [sendScope, setSendScope] = useState<'all' | 'chantier'>('all');
  const [quickLines, setQuickLines] = useState('');
  const [creatingFromText, setCreatingFromText] = useState(false);
  const [importingPcDir, setImportingPcDir] = useState(false);

  // PC -> Phone Send State
  const [targetCode, setTargetCode] = useState('');
  const [sendingBundle, setSendingBundle] = useState(false);

  // Phone Receiver State
  const [receiverCode, setReceiverCode] = useState<string | null>(null);
  const [receiverTransport, setReceiverTransport] = useState<'http' | 'p2p' | null>(null);
  const [creatingCode, setCreatingCode] = useState(false);
  const [receivedSummary, setReceivedSummary] = useState<string | null>(null);
  const p2pReceiverRef = useRef<FolderReceiverSession | null>(null);

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const dirInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const supportsDirectoryPicker =
    typeof window !== 'undefined' &&
    'showDirectoryPicker' in window &&
    window.self === window.top;

  useEffect(() => {
    return () => {
      p2pReceiverRef.current?.destroy();
    };
  }, []);

  // Poll HTTP room when phone is waiting in HTTP relay mode
  useEffect(() => {
    if (!receiverCode || receiverTransport !== 'http') return;
    let active = true;
    let handling = false;

    const poll = async () => {
      if (handling) return;
      try {
        const res = await fetch(`./api/transfer/${receiverCode}/folder-bundle`);
        if (!res.ok) {
          if (res.status === 404 && active) {
            setReceiverCode(null);
            setReceiverTransport(null);
          }
          return;
        }
        const data = (await res.json()) as {
          ready?: boolean;
          bundle?: PortableFolderBundle | null;
          received?: boolean;
        };
        if (data.ready && data.bundle && !data.received && active) {
          handling = true;
          const result = await importFolderBundle(data.bundle);
          await fetch(`./api/transfer/${receiverCode}/folder-bundle/ack`, {
            method: 'POST',
          }).catch(() => {});
          await onFoldersChanged();
          if (active) {
            const msg =
              result.createdCount > 0
                ? `${result.createdCount} dossier(s) importé(s) sur cet appareil !`
                : 'Arborescence déjà à jour sur cet appareil (aucun doublon créé).';
            setReceivedSummary(msg);
            onFeedback?.(msg);
          }
        }
      } catch {
        // Retry on next tick
      } finally {
        handling = false;
      }
    };

    poll();
    const timer = setInterval(poll, 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [receiverCode, receiverTransport, onFoldersChanged, onFeedback]);

  const exportBundle = useMemo(
    () =>
      exportFolderBundle(
        allFolders,
        sendScope === 'chantier' && selectedChantier ? selectedChantier.id : undefined
      ),
    [allFolders, sendScope, selectedChantier]
  );

  const exportFolderCount = useMemo(
    () => countPortableNodes(exportBundle.chantiers),
    [exportBundle]
  );

  const applyImportedBundle = async (bundle: PortableFolderBundle, sourceLabel: string) => {
    const result = await importFolderBundle(bundle);
    await onFoldersChanged();
    const msg =
      result.createdCount > 0
        ? `${result.createdCount} dossier(s) créé(s) (${sourceLabel}).`
        : `Tous ces dossiers existaient déjà (${sourceLabel}).`;
    setStatusMessage(msg);
    setErrorMessage(null);
    onFeedback?.(msg);
  };

  const handleImportPcDirectory = async () => {
    setErrorMessage(null);
    setStatusMessage(null);

    if (supportsDirectoryPicker) {
      try {
        setImportingPcDir(true);
        const picker = (
          window as unknown as {
            showDirectoryPicker: (opts?: { mode?: 'read' }) => Promise<DirHandleLike>;
          }
        ).showDirectoryPicker;
        const rootHandle = await picker({ mode: 'read' });
        const paths: string[] = [];
        await collectDirectoryPathsFromHandle(rootHandle, '', paths, 0);
        const bundle = parsePathsToFolderBundle(paths);
        if (bundle.chantiers.length === 0) {
          setErrorMessage('Aucun dossier valide détecté.');
          return;
        }
        await applyImportedBundle(bundle, `dossier « ${rootHandle.name} »`);
      } catch (err) {
        if ((err as Error)?.name !== 'AbortError') {
          setErrorMessage('Impossible de lire ce dossier. Essayez via le sélecteur standard.');
        }
      } finally {
        setImportingPcDir(false);
      }
      return;
    }

    dirInputRef.current?.click();
  };

  const handleDirectoryInputFallback = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) {
      e.target.value = '';
      return;
    }
    setImportingPcDir(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const paths = extractFolderPathsFromFileList(files);
      if (paths.length === 0) {
        setErrorMessage(
          'Aucun sous-dossier contenant un fichier n’a été trouvé. Utilisez la saisie rapide ci-dessous pour des dossiers vides.'
        );
        return;
      }
      const bundle = parsePathsToFolderBundle(paths);
      await applyImportedBundle(bundle, 'dossier PC');
    } finally {
      setImportingPcDir(false);
      e.target.value = '';
    }
  };

  const handleCreateFromQuickText = async (e: React.FormEvent) => {
    e.preventDefault();
    const lines = quickLines
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return;

    setCreatingFromText(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const bundle = parsePathsToFolderBundle(lines);
      if (bundle.chantiers.length === 0) {
        setErrorMessage('Aucun nom de dossier valide détecté.');
        return;
      }
      await applyImportedBundle(bundle, 'saisie rapide');
      setQuickLines('');
    } finally {
      setCreatingFromText(false);
    }
  };

  const handleDownloadModelFile = () => {
    if (exportFolderCount === 0) return;
    const json = JSON.stringify(exportBundle, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const slug =
      sendScope === 'chantier' && selectedChantier
        ? selectedChantier.name
            .trim()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9_-]+/g, '_') || 'Chantier'
        : 'Chantiers';
    a.download = `${slug}_arborescence.chantier.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setErrorMessage(null);
    setStatusMessage(
      `Fichier modèle téléchargé (${exportFolderCount} dossier(s)). Vous pouvez l’importer sur votre téléphone même hors-ligne.`
    );
  };

  const handleSendBundleToPhone = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = targetCode.replace(/\D/g, '');
    if (cleanCode.length !== 6 || exportFolderCount === 0) return;

    setSendingBundle(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      let useHttp = false;
      try {
        const checkRes = await fetch(`./api/transfer/${cleanCode}/status`);
        const contentType = checkRes.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          if (!checkRes.ok) {
            setErrorMessage('Code invalide ou expiré. Générez un nouveau code sur le téléphone.');
            return;
          }
          useHttp = true;
        }
      } catch {
        useHttp = false;
      }

      if (useHttp) {
        const res = await fetch(`./api/transfer/${cleanCode}/folder-bundle`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bundle: exportBundle }),
        });
        if (!res.ok) {
          throw new Error('Impossible d’envoyer les dossiers vers ce code.');
        }
        setStatusMessage(
          `Arborescence envoyée (${exportFolderCount} dossier(s)) ! Elle apparaît sur votre téléphone.`
        );
        onFeedback?.('Arborescence envoyée vers votre téléphone.');
      } else {
        const ack = await sendFolderBundleViaP2P(cleanCode, exportBundle);
        setStatusMessage(
          ack.createdCount > 0
            ? `Reçu sur le téléphone : ${ack.createdCount} nouveau(x) dossier(s) créé(s) !`
            : 'Arborescence envoyée : tous ces dossiers existaient déjà sur le téléphone.'
        );
        onFeedback?.('Dossiers reçus sur le téléphone.');
      }
      setTargetCode('');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Échec de l’envoi vers le téléphone.'
      );
    } finally {
      setSendingBundle(false);
    }
  };

  const handleStartReceiveCode = async () => {
    setCreatingCode(true);
    setErrorMessage(null);
    setStatusMessage(null);
    setReceivedSummary(null);
    p2pReceiverRef.current?.destroy();
    p2pReceiverRef.current = null;

    try {
      const res = await fetch('./api/transfer/create', { method: 'POST' });
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const data = (await res.json()) as { code: string };
        setReceiverTransport('http');
        setReceiverCode(data.code);
        setCreatingCode(false);
        return;
      }
    } catch {
      // Static GitHub Pages hosting -> fall back to PeerJS WebRTC P2P
    }

    setReceiverTransport('p2p');
    const session = startFolderBundleReceiverP2P({
      onReady: (code) => {
        setReceiverCode(code);
        setCreatingCode(false);
      },
      onBundleReceived: async (bundle) => {
        const result = await importFolderBundle(bundle);
        await onFoldersChanged();
        const msg =
          result.createdCount > 0
            ? `${result.createdCount} dossier(s) ajouté(s) depuis votre PC !`
            : 'Arborescence déjà présente sur cet appareil.';
        setReceivedSummary(msg);
        onFeedback?.(msg);
        return result.createdCount;
      },
      onError: (msg) => {
        setErrorMessage(msg);
        setCreatingCode(false);
      },
    });
    p2pReceiverRef.current = session;
  };

  const handleImportModelFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const text = await file.text();
      const bundle = parsePortableFolderBundleText(text);
      await applyImportedBundle(bundle, `fichier « ${file.name} »`);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Impossible de lire ce fichier modèle.'
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-2xl max-h-[92dvh] rounded-t-3xl sm:rounded-2xl bg-white border border-slate-300 flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
              <FolderTree className="w-4.5 h-4.5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-slate-950 truncate">
                Préparer mes dossiers (PC ↔ Téléphone)
              </h2>
              <p className="text-xs text-slate-600 truncate">
                100 % direct, sans quota Firebase · Arborescence réutilisable
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="min-h-[38px] min-w-[38px] rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 flex items-center justify-center shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Switch */}
        <div className="px-4 sm:px-5 pt-3">
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100">
            <button
              type="button"
              onClick={() => {
                setMode('pc');
                setErrorMessage(null);
              }}
              className={`min-h-[42px] px-3 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                mode === 'pc'
                  ? 'bg-white text-slate-950 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Laptop className="w-4 h-4 text-sky-600 shrink-0" />
              <span className="truncate">Préparer / Envoyer (PC)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('phone');
                setErrorMessage(null);
              }}
              className={`min-h-[42px] px-3 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                mode === 'phone'
                  ? 'bg-white text-slate-950 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Smartphone className="w-4 h-4 text-amber-600 shrink-0" />
              <span className="truncate">Recevoir (Téléphone)</span>
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4">
          {errorMessage && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-900">
              {errorMessage}
            </div>
          )}

          {statusMessage && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-medium text-emerald-900 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{statusMessage}</span>
            </div>
          )}

          {mode === 'pc' ? (
            <div className="space-y-4">
              {/* Step 1: Build or import folders on PC */}
              <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-bold text-slate-950">
                      1. Créer ou importer votre arborescence sur ce PC
                    </h3>
                    <p className="text-[11px] text-slate-600">
                      Importez un dossier Windows existant ou tapez vos chemins en une fois.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={importingPcDir}
                    onClick={handleImportPcDirectory}
                    className="min-h-[38px] px-3 rounded-xl border border-slate-300 bg-white text-slate-900 text-xs font-semibold hover:bg-slate-100 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {importingPcDir ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600" />
                    ) : (
                      <FolderInput className="w-3.5 h-3.5 text-amber-600" />
                    )}
                    <span>Importer un dossier PC</span>
                  </button>
                  <input
                    ref={dirInputRef}
                    type="file"
                    multiple
                    {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                    onChange={handleDirectoryInputFallback}
                    className="hidden"
                  />
                </div>

                <form onSubmit={handleCreateFromQuickText} className="space-y-2">
                  <textarea
                    rows={3}
                    value={quickLines}
                    onChange={(e) => setQuickLines(e.target.value)}
                    placeholder={`Saisie rapide (1 chemin par ligne), ex :\nVilla Martin / 01_Gros_Oeuvre\nVilla Martin / 02_Electricite / Tableau\nVilla Martin / 03_Plomberie / Salle de bain`}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs text-slate-950 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-500">
                      Astuce : séparez les niveaux avec « / »
                    </span>
                    <button
                      type="submit"
                      disabled={creatingFromText || !quickLines.trim()}
                      className="min-h-[36px] px-3.5 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-40 inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <ListPlus className="w-3.5 h-3.5" />
                      <span>Créer ces dossiers ici</span>
                    </button>
                  </div>
                </form>
              </section>

              {/* Step 2: Send to Phone or Download Model */}
              <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-bold text-slate-950">
                      2. Envoyer vers votre téléphone ({exportFolderCount} dossier
                      {exportFolderCount > 1 ? 's' : ''})
                    </h3>
                    <p className="text-[11px] text-slate-600">
                      Sur le téléphone, ouvrez cet écran → onglet « Recevoir (Téléphone) » pour afficher le code.
                    </p>
                  </div>

                  {selectedChantier && allFolders.some((f) => f.parentId === 'root' && f.id !== selectedChantier.id) && (
                    <div className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 text-[11px] font-semibold">
                      <button
                        type="button"
                        onClick={() => setSendScope('all')}
                        className={`px-2 py-1 rounded-md cursor-pointer ${
                          sendScope === 'all'
                            ? 'bg-slate-900 text-white'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Tous
                      </button>
                      <button
                        type="button"
                        onClick={() => setSendScope('chantier')}
                        className={`px-2 py-1 rounded-md cursor-pointer max-w-[140px] truncate ${
                          sendScope === 'chantier'
                            ? 'bg-amber-500 text-slate-950'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {selectedChantier.name}
                      </button>
                    </div>
                  )}
                </div>

                <form onSubmit={handleSendBundleToPhone} className="flex flex-col sm:flex-row gap-2.5">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={targetCode}
                    onChange={(e) => setTargetCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="Code à 6 chiffres du téléphone"
                    className="flex-1 min-w-0 min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm font-mono tracking-widest text-slate-950 placeholder:text-slate-400 placeholder:tracking-normal placeholder:font-sans focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <button
                    type="submit"
                    disabled={
                      sendingBundle ||
                      !isOnline ||
                      exportFolderCount === 0 ||
                      targetCode.replace(/\D/g, '').length !== 6
                    }
                    className="min-h-[44px] px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold disabled:opacity-50 inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    {sendingBundle ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    <span>Envoyer les dossiers</span>
                  </button>
                </form>

                <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-500">
                    Pas de téléphone sous la main ? Envoyez-vous le fichier modèle :
                  </span>
                  <button
                    type="button"
                    disabled={exportFolderCount === 0}
                    onClick={handleDownloadModelFile}
                    className="min-h-[38px] px-3 rounded-xl border border-slate-300 bg-white text-slate-900 text-xs font-semibold hover:bg-slate-50 disabled:opacity-40 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-amber-600" />
                    <span>Télécharger fichier modèle (.chantier.json)</span>
                  </button>
                </div>
              </section>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Direct Receive via 6-digit code */}
              <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-bold text-slate-950">
                      1. Recevoir en direct depuis votre PC boulot
                    </h3>
                    <p className="text-[11px] text-slate-600">
                      Générez un code ici puis tapez-le sur votre PC. Vos photos existantes sont conservées.
                    </p>
                  </div>

                  {!receiverCode && (
                    <button
                      type="button"
                      disabled={creatingCode || !isOnline}
                      onClick={handleStartReceiveCode}
                      className="min-h-[42px] px-4 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-50 inline-flex items-center justify-center gap-2 shrink-0 cursor-pointer"
                    >
                      {creatingCode && <Loader2 className="w-4 h-4 animate-spin" />}
                      <span>Générer un code</span>
                    </button>
                  )}
                </div>

                {receiverCode && (
                  <div className="rounded-2xl bg-slate-950 text-white p-4 text-center space-y-2">
                    <div className="text-[11px] text-slate-400">
                      Saisissez ce code sur votre PC (onglet Préparer / Envoyer)
                    </div>
                    <div className="text-3xl sm:text-4xl font-bold font-mono tracking-[0.2em] tabular-nums text-amber-400">
                      {receiverCode}
                    </div>
                    <div className="text-xs text-slate-300">
                      {receivedSummary ? (
                        <span className="text-emerald-400 font-semibold">{receivedSummary}</span>
                      ) : (
                        <span>En attente de l’envoi depuis le PC...</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={handleStartReceiveCode}
                      className="text-[11px] text-slate-400 hover:text-white underline cursor-pointer pt-1"
                    >
                      Générer un nouveau code
                    </button>
                  </div>
                )}
              </section>

              {/* Offline Model Import */}
              <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-xs font-bold text-slate-950">
                    2. Importer un fichier modèle (.chantier.json ou .txt)
                  </h3>
                  <p className="text-[11px] text-slate-600">
                    Fonctionne 100 % hors-ligne à partir d’un fichier reçu par mail ou WhatsApp.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="min-h-[42px] px-4 rounded-xl border border-slate-300 bg-white text-slate-900 text-xs font-semibold hover:bg-slate-100 inline-flex items-center justify-center gap-2 shrink-0 cursor-pointer"
                >
                  <FileUp className="w-4 h-4 text-amber-600" />
                  <span>Choisir un fichier</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,.txt,application/json,text/plain"
                  onChange={handleImportModelFile}
                  className="hidden"
                />
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
