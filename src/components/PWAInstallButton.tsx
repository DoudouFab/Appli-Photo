import React, { useState } from 'react';
import { Download, MoreVertical, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) return null;

  const handleClick = async () => {
    if (isInstallable) {
      const accepted = await install();
      if (!accepted) {
        setShowGuide(true);
      }
      return;
    }
    setShowGuide(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex items-center gap-1.5 min-h-[40px] px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-900 text-xs font-semibold hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
      >
        {isIOS && !isInstallable ? (
          <Share className="w-3.5 h-3.5 text-amber-600" />
        ) : (
          <Download className="w-3.5 h-3.5 text-amber-600" />
        )}
        <span>Installer l’appli</span>
      </button>

      {showGuide && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 border border-slate-200 shadow-xl space-y-4">
            <div className="flex items-start justify-between gap-4">
              <h3 className="text-lg font-semibold text-slate-900">
                {isIOS ? 'Installer sur iPhone / iPad' : 'Installer sur votre téléphone'}
              </h3>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
                aria-label="Fermer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {isIOS ? (
              <ol className="space-y-2.5 text-sm text-slate-600 list-decimal list-inside">
                <li>
                  Ouvrez ce lien dans <strong>Safari</strong>.
                </li>
                <li>
                  Appuyez sur le bouton <strong>Partager</strong> dans la barre du bas.
                </li>
                <li>
                  Choisissez <strong>Sur l’écran d’accueil</strong> puis validez.
                </li>
              </ol>
            ) : (
              <ol className="space-y-2.5 text-sm text-slate-600 list-decimal list-inside">
                <li>
                  Si vous avez ouvert le lien depuis WhatsApp, Messenger ou un e-mail, appuyez d’abord sur <strong>Ouvrir dans Chrome</strong> (ou Samsung Internet).
                </li>
                <li>
                  Appuyez sur le menu{' '}
                  <span className="inline-flex items-center align-middle px-1.5 py-0.5 rounded bg-slate-100 text-slate-900 font-semibold">
                    <MoreVertical className="w-3.5 h-3.5" />
                  </span>{' '}
                  en haut à droite du navigateur.
                </li>
                <li>
                  Sélectionnez <strong>Installer l’application</strong> ou{' '}
                  <strong>Ajouter à l’écran d’accueil</strong>.
                </li>
              </ol>
            )}

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full min-h-[44px] rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Compris
            </button>
          </div>
        </div>
      )}
    </>
  );
};
