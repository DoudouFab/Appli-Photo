import React, { useState } from 'react';
import { Check, Copy, ExternalLink, X } from 'lucide-react';

interface OneDriveSetupModalProps {
  open: boolean;
  redirectUri: string;
  onClose: () => void;
}

export const OneDriveSetupModal: React.FC<OneDriveSetupModalProps> = ({
  open,
  redirectUri,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback ignored
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl bg-white border border-slate-200 shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="w-10 h-1.5 bg-slate-200 rounded-full mx-auto mb-4 sm:hidden" />
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              Connecter votre compte Microsoft OneDrive
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Pour autoriser l'envoi direct dans vos dossiers OneDrive, créez une application Azure Entra ID (gratuit) et ajoutez les secrets serveur.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer shrink-0"
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <ol className="mt-5 space-y-4 text-sm text-slate-700">
          <li>
            <span className="font-semibold text-slate-900">1. Ouvrir ou créer votre annuaire Microsoft Entra</span>
            <p className="mt-1 text-slate-600">
              Avec un compte Microsoft personnel sans abonnement Azure, l’accès direct aux inscriptions d’applications renvoie souvent une erreur <strong>401</strong> (annuaire par défaut « Microsoft Services » restreint).
            </p>
            <p className="mt-1 text-slate-600">
              Créez d’abord un compte Azure gratuit (ou un locataire Entra ID depuis le portail), puis ouvrez <strong>Microsoft Entra ID &rarr; Inscriptions d’applications</strong> (« Comptes dans tout annuaire organisationnel et comptes Microsoft personnels »).
            </p>
            <div className="mt-2 flex flex-wrap gap-3">
              <a
                href="https://azure.microsoft.com/fr-fr/free/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sky-700 font-medium hover:underline"
              >
                <span>Créer un compte Azure gratuit</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <a
                href="https://entra.microsoft.com"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sky-700 font-medium hover:underline"
              >
                <span>Ouvrir Microsoft Entra</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </li>

          <li>
            <span className="font-semibold text-slate-900">2. Ajouter l'URL de redirection Web</span>
            <p className="mt-1 text-slate-600">
              Dans <strong>Authentication &rarr; Web &rarr; Redirect URIs</strong>, collez exactement cette adresse :
            </p>
            <div className="mt-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
              <code className="flex-1 text-xs font-mono text-slate-800 break-all">
                {redirectUri}
              </code>
              <button
                type="button"
                onClick={handleCopy}
                className="min-h-[36px] px-3 rounded-lg bg-white border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-100 inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copié' : 'Copier'}</span>
              </button>
            </div>
          </li>

          <li>
            <span className="font-semibold text-slate-900">3. Permissions &amp; Secrets AI Studio</span>
            <p className="mt-1 text-slate-600">
              Ajoutez la permission déléguée Microsoft Graph <code className="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded">Files.ReadWrite</code> et <code className="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded">User.Read</code>, puis renseignez dans les secrets :
            </p>
            <div className="mt-2 space-y-1 text-xs font-mono text-slate-800 bg-slate-50 border border-slate-200 rounded-xl p-3">
              <div>MICROSOFT_CLIENT_ID</div>
              <div>MICROSOFT_CLIENT_SECRET</div>
            </div>
          </li>
        </ol>

        <div className="mt-6 flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-[48px] rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Continuer en mode dossiers locaux
          </button>
        </div>
      </div>
    </div>
  );
};
