import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FolderInput,
  Loader2,
  MessageSquareText,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import { LocalFolderRecord, QueuedPhoto, TargetFolder } from '../types';
import { formatBytes } from '../lib/storage';
import { downloadBlobFile, sharePhotosNativeOrDownload } from '../lib/share';
import { MovePhotosModal } from './MovePhotosModal';

interface PhotoViewerModalProps {
  photos: QueuedPhoto[];
  initialIndex: number;
  allFolders?: LocalFolderRecord[];
  onClose: () => void;
  onDeletePhoto: (id: string) => Promise<void>;
  onUpdatePhotoNote?: (photoId: string, note: string) => Promise<void>;
  onMovePhoto?: (photoId: string, target: TargetFolder) => Promise<void>;
  onFeedback?: (message: string) => void;
}

export const PhotoViewerModal: React.FC<PhotoViewerModalProps> = ({
  photos,
  initialIndex,
  allFolders,
  onClose,
  onDeletePhoto,
  onUpdatePhotoNote,
  onMovePhoto,
  onFeedback,
}) => {
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(0, initialIndex), Math.max(0, photos.length - 1))
  );
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const touchStartXRef = useRef<number | null>(null);

  const safeIndex = Math.min(Math.max(0, index), Math.max(0, photos.length - 1));
  const currentPhoto = photos[safeIndex];

  useEffect(() => {
    if (photos.length === 0) {
      onClose();
    } else if (index >= photos.length) {
      setIndex(photos.length - 1);
    }
  }, [photos.length, index, onClose]);

  useEffect(() => {
    setConfirmDelete(false);
    setEditingNote(false);
    setNoteDraft(currentPhoto?.note || '');
    if (!currentPhoto) {
      setImageUrl(null);
      return;
    }
    const url = URL.createObjectURL(currentPhoto.blob);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [currentPhoto?.id, currentPhoto?.blob]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft') {
        setIndex((i) => Math.max(0, i - 1));
      } else if (e.key === 'ArrowRight') {
        setIndex((i) => Math.min(photos.length - 1, i + 1));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, photos.length]);

  if (!currentPhoto) return null;

  const canPrev = safeIndex > 0;
  const canNext = safeIndex < photos.length - 1;

  const handlePrev = () => {
    if (canPrev) setIndex(safeIndex - 1);
  };

  const handleNext = () => {
    if (canNext) setIndex(safeIndex + 1);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      touchStartXRef.current = e.touches[0].clientX;
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null || e.changedTouches.length === 0) return;
    const deltaX = e.changedTouches[0].clientX - touchStartXRef.current;
    touchStartXRef.current = null;
    if (Math.abs(deltaX) > 45) {
      if (deltaX < 0) handleNext();
      else handlePrev();
    }
  };

  const handleShare = async () => {
    setSharing(true);
    try {
      const result = await sharePhotosNativeOrDownload(
        [currentPhoto],
        currentPhoto.folderPath
      );
      if (result.status === 'fallback_downloaded') {
        onFeedback?.(
          'Photo téléchargée — partage direct (WhatsApp / Messenger / Outlook) disponible sur smartphone.'
        );
      }
    } finally {
      setSharing(false);
    }
  };

  const handleDeleteCurrent = async () => {
    setDeleting(true);
    try {
      await onDeletePhoto(currentPhoto.id);
      setConfirmDelete(false);
      onFeedback?.('Photo supprimée.');
    } finally {
      setDeleting(false);
    }
  };

  const handleSaveNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onUpdatePhotoNote) return;
    setSavingNote(true);
    try {
      await onUpdatePhotoNote(currentPhoto.id, noteDraft);
      setEditingNote(false);
      onFeedback?.(noteDraft.trim() ? 'Note enregistrée sur la photo.' : 'Note retirée.');
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Aperçu photo ${currentPhoto.filename}`}
      className="fixed inset-0 z-50 bg-slate-950 text-white flex flex-col"
    >
      {/* Top Bar */}
      <header className="px-3 sm:px-5 py-2.5 border-b border-slate-800 flex items-center justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-bold text-amber-400 tabular-nums">
            <span>
              {safeIndex + 1} / {photos.length}
            </span>
            <span aria-hidden="true">·</span>
            <span className="truncate text-slate-200 font-medium">
              {currentPhoto.folderPath}
            </span>
          </div>
          <div className="text-[11px] font-mono text-slate-400 truncate tabular-nums">
            {currentPhoto.filename} · {formatBytes(currentPhoto.size)} ·{' '}
            {new Date(currentPhoto.capturedAt).toLocaleString('fr-FR', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer l’aperçu"
          className="min-h-[44px] min-w-[44px] rounded-xl bg-slate-900 border border-slate-700 text-white hover:bg-slate-800 flex items-center justify-center shrink-0 cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </header>

      {/* Main Photo Viewport with Swipe & Prev/Next Controls */}
      <div
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className="flex-1 relative min-h-0 flex items-center justify-center p-2 sm:p-6 overflow-hidden select-none"
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={currentPhoto.filename}
            className="max-w-full max-h-full object-contain rounded-lg"
          />
        ) : (
          <Loader2 className="w-7 h-7 animate-spin text-amber-400" />
        )}

        {canPrev && (
          <button
            type="button"
            onClick={handlePrev}
            aria-label="Photo précédente"
            className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 min-h-[48px] min-w-[48px] rounded-full bg-slate-950/75 border border-white/20 text-white hover:bg-slate-900 flex items-center justify-center cursor-pointer"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}

        {canNext && (
          <button
            type="button"
            onClick={handleNext}
            aria-label="Photo suivante"
            className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 min-h-[48px] min-w-[48px] rounded-full bg-slate-950/75 border border-white/20 text-white hover:bg-slate-900 flex items-center justify-center cursor-pointer"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        )}
      </div>

      {/* Photo Note Strip (if present or editing) */}
      {(currentPhoto.note || editingNote) && (
        <div className="border-t border-slate-800 bg-slate-900/95 px-3 sm:px-5 py-2.5 shrink-0">
          {editingNote ? (
            <form onSubmit={handleSaveNote} className="mx-auto max-w-xl flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                maxLength={300}
                autoFocus
                placeholder="Note pour cette photo (exportée dans notes.txt)..."
                className="flex-1 min-w-0 min-h-[40px] px-3 rounded-xl border border-slate-700 bg-slate-950 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="submit"
                  disabled={savingNote}
                  className="min-h-[40px] px-3.5 rounded-xl bg-amber-500 text-slate-950 text-xs font-bold hover:bg-amber-400 cursor-pointer disabled:opacity-60"
                >
                  {savingNote ? 'Enreg...' : 'Enregistrer'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingNote(false);
                    setNoteDraft(currentPhoto.note || '');
                  }}
                  className="min-h-[40px] px-3 rounded-xl border border-slate-700 bg-slate-800 text-slate-200 text-xs font-medium hover:bg-slate-700 cursor-pointer"
                >
                  Annuler
                </button>
              </div>
            </form>
          ) : (
            <div className="mx-auto max-w-xl flex items-center justify-between gap-3 text-xs">
              <div className="min-w-0 flex items-start gap-2 text-slate-200">
                <MessageSquareText className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span className="break-words">{currentPhoto.note}</span>
              </div>
              {onUpdatePhotoNote && (
                <button
                  type="button"
                  onClick={() => {
                    setNoteDraft(currentPhoto.note || '');
                    setEditingNote(true);
                  }}
                  className="text-amber-400 font-semibold hover:underline shrink-0 cursor-pointer"
                >
                  Modifier
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Bottom Thumb-Zone Action Bar */}
      <footer className="border-t border-slate-800 bg-slate-950/95 px-3 sm:px-5 py-3 pb-safe shrink-0">
        {confirmDelete ? (
          <div className="mx-auto max-w-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <span className="text-xs font-medium text-red-200">
              Supprimer définitivement cette photo ?
            </span>
            <div className="grid grid-cols-2 sm:flex items-center gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={handleDeleteCurrent}
                className="min-h-[44px] px-4 rounded-xl bg-red-600 text-white text-xs font-bold hover:bg-red-700 disabled:opacity-50 cursor-pointer"
              >
                {deleting ? 'Suppression...' : 'Oui, supprimer'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="min-h-[44px] px-4 rounded-xl border border-slate-700 bg-slate-900 text-slate-200 text-xs font-semibold hover:bg-slate-800 cursor-pointer"
              >
                Annuler
              </button>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              disabled={sharing}
              onClick={handleShare}
              className="flex-1 min-w-[96px] min-h-[46px] px-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
              title="Partager vers WhatsApp, Messenger, Outlook..."
            >
              {sharing ? (
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              ) : (
                <Share2 className="w-4 h-4 shrink-0" />
              )}
              <span className="truncate">Partager</span>
            </button>

            {onUpdatePhotoNote && (
              <button
                type="button"
                onClick={() => {
                  setNoteDraft(currentPhoto.note || '');
                  setEditingNote((v) => !v);
                }}
                className="flex-1 min-w-[84px] min-h-[46px] px-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <MessageSquareText className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="truncate">Note</span>
              </button>
            )}

            {onMovePhoto && allFolders && allFolders.length > 1 && (
              <button
                type="button"
                onClick={() => setShowMoveModal(true)}
                className="flex-1 min-w-[92px] min-h-[46px] px-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <FolderInput className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="truncate">Déplacer</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => downloadBlobFile(currentPhoto.blob, currentPhoto.filename)}
              className="flex-1 min-w-[92px] min-h-[46px] px-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Download className="w-4 h-4 shrink-0" />
              <span className="truncate">Enregistrer</span>
            </button>

            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="min-h-[46px] px-3 rounded-xl bg-red-950/70 border border-red-500/40 hover:bg-red-900/70 text-red-200 text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
              aria-label="Supprimer cette photo"
            >
              <Trash2 className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">Supprimer</span>
            </button>
          </div>
        )}
      </footer>

      {showMoveModal && allFolders && onMovePhoto && (
        <MovePhotosModal
          photoCount={1}
          allFolders={allFolders}
          currentFolderId={currentPhoto.folderId}
          onSelectDestination={async (target) => {
            await onMovePhoto(currentPhoto.id, target);
            setShowMoveModal(false);
          }}
          onClose={() => setShowMoveModal(false)}
        />
      )}
    </div>
  );
};
