import React, { useState } from 'react';
import { User, signInWithPopup, signOut } from 'firebase/auth';
import {
  Clock,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { auth, googleProvider } from '../lib/firebase';
import {
  AccessUserRecord,
  checkOwnAccessRecord,
  clearCachedApproval,
  extractFirestoreErrorReason,
  isOfflineFirestoreError,
  submitPendingAccessRequest,
  verifyPersonalCodeAndActivate,
} from '../lib/accessControl';

interface AccessGateProps {
  authLoading: boolean;
  user: User | null;
  accessRecord: AccessUserRecord | null;
  checkingAccess: boolean;
  offlineBlockedMessage: string | null;
  onManualAccessRefresh: (record: AccessUserRecord | null) => void;
}

export const AccessGate: React.FC<AccessGateProps> = ({
  authLoading,
  user,
  accessRecord,
  checkingAccess,
  offlineBlockedMessage,
  onManualAccessRefresh,
}) => {
  const [signingIn, setSigningIn] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [requestingAccess, setRequestingAccess] = useState(false);
  const [personalCode, setPersonalCode] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setSigningIn(true);
    setAuthError(null);
    setInfoMessage(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/popup-closed-by-user') {
        setAuthError(null);
      } else if (code === 'auth/unauthorized-domain') {
        setAuthError(
          `Domaine « ${window.location.hostname} » non autorisé dans Firebase Auth. Ajoutez-le dans Firebase Console → Authentication → Settings → Authorized domains.`
        );
      } else if (code === 'auth/popup-blocked') {
        setAuthError(
          'La fenêtre de connexion Google a été bloquée par le navigateur. Autorisez les popups pour ce site puis réessayez.'
        );
      } else {
        setAuthError(
          err instanceof Error
            ? err.message
            : 'Impossible de se connecter avec Google pour le moment.'
        );
      }
    } finally {
      setSigningIn(false);
    }
  };

  const handleSwitchAccount = async () => {
    clearCachedApproval();
    setPersonalCode('');
    setAuthError(null);
    setInfoMessage(null);
    await signOut(auth);
  };

  const handleCheckStatus = async () => {
    if (!user) return;
    setRefreshing(true);
    setAuthError(null);
    setInfoMessage(null);
    try {
      const rec = await checkOwnAccessRecord(user);
      onManualAccessRefresh(rec);
    } catch (err) {
      if (isOfflineFirestoreError(err)) {
        setAuthError('Aucune connexion internet pour vérifier l’autorisation.');
      } else {
        setAuthError(extractFirestoreErrorReason(err));
      }
    } finally {
      setRefreshing(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !personalCode.trim()) return;
    setVerifyingCode(true);
    setAuthError(null);
    setInfoMessage(null);
    try {
      const approved = await verifyPersonalCodeAndActivate(user, personalCode);
      onManualAccessRefresh(approved);
    } catch (err) {
      if (isOfflineFirestoreError(err)) {
        setAuthError('Connexion internet requise pour valider votre code personnel.');
      } else {
        setAuthError(extractFirestoreErrorReason(err));
      }
    } finally {
      setVerifyingCode(false);
    }
  };

  const handleRequestAccessWithoutCode = async () => {
    if (!user) return;
    setRequestingAccess(true);
    setAuthError(null);
    setInfoMessage(null);
    try {
      const rec = await submitPendingAccessRequest(user);
      onManualAccessRefresh(rec);
      setInfoMessage('Demande envoyée à Fabien Pirquin.');
    } catch (err) {
      if (isOfflineFirestoreError(err)) {
        setAuthError('Connexion internet requise pour envoyer la demande.');
      } else {
        setAuthError(extractFirestoreErrorReason(err));
      }
    } finally {
      setRequestingAccess(false);
    }
  };

  if (authLoading || (user && checkingAccess && !accessRecord)) {
    return (
      <div className="min-h-[100dvh] bg-slate-100 text-slate-950 flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl border border-slate-300 bg-white p-6 text-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-amber-600 mx-auto" />
          <div className="text-sm font-semibold text-slate-950">
            Vérification de votre accès ChantierShot...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-slate-100 text-slate-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-300 bg-white p-5 sm:p-7 space-y-5">
        {/* Brand Header */}
        <div className="flex items-center gap-3">
          <svg viewBox="0 0 32 32" fill="none" className="w-10 h-10 shrink-0" aria-hidden="true">
            <rect width="32" height="32" rx="8" fill="#0F172A" />
            <path
              d="M6.5 10.5C6.5 9.67157 7.17157 9 8 9H12.8L14.5 10.7H24C24.8284 10.7 25.5 11.3716 25.5 12.2V22C25.5 22.8284 24.8284 23.5 24 23.5H8C7.17157 23.5 6.5 22.8284 6.5 22V10.5Z"
              fill="#1E293B"
              stroke="#475569"
              strokeWidth="1.2"
            />
            <circle cx="16" cy="17.2" r="4.3" fill="#0F172A" stroke="#F59E0B" strokeWidth="1.7" />
            <circle cx="16" cy="17.2" r="1.7" fill="#F59E0B" />
          </svg>
          <div>
            <h1 className="text-xl font-bold text-slate-950 font-display">ChantierShot</h1>
            <p className="text-xs font-medium text-slate-700">
              Accès privé · Contrôlé par F.Pirquin
            </p>
          </div>
        </div>

        {/* Not Signed In */}
        {!user && (
          <div className="space-y-4">
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-2 text-sm text-slate-800">
              <div className="flex items-center gap-2 font-bold text-slate-950">
                <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Connexion unique par appareil</span>
              </div>
              <p className="text-xs leading-relaxed text-slate-700">
                Connectez-vous <strong>une seule fois</strong> avec votre adresse Google, puis saisissez le code personnel fourni par{' '}
                <strong>Fabien Pirquin</strong>. Votre session reste ensuite mémorisée sur cet appareil.
              </p>
            </div>

            {authError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-900">
                {authError}
              </div>
            )}

            <button
              type="button"
              disabled={signingIn}
              onClick={handleGoogleSignIn}
              className="w-full min-h-[52px] px-4 rounded-xl bg-amber-500 hover:bg-amber-400 active:scale-[0.99] text-slate-950 text-sm font-bold inline-flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-60"
            >
              {signingIn ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <LogIn className="w-5 h-5" />
              )}
              <span>{signingIn ? 'Connexion en cours...' : 'Se connecter avec Google'}</span>
            </button>
          </div>
        )}

        {/* Signed In -> Error / Offline Blocked */}
        {user && offlineBlockedMessage && (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-2 text-xs text-slate-900">
              <div className="font-bold text-sm">
                {offlineBlockedMessage.toLowerCase().includes('internet')
                  ? 'Connexion internet requise la 1re fois'
                  : 'Vérification d’accès impossible'}
              </div>
              <p className="break-words">{offlineBlockedMessage}</p>
            </div>
            {authError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-900 break-words">
                {authError}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={refreshing}
                onClick={handleCheckStatus}
                className="min-h-[46px] px-3 rounded-xl bg-slate-950 text-white text-xs font-semibold hover:bg-slate-800 inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                {refreshing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                <span>Réessayer</span>
              </button>
              <button
                type="button"
                onClick={handleSwitchAccount}
                className="min-h-[46px] px-3 rounded-xl border border-slate-300 bg-white text-slate-800 text-xs font-semibold hover:bg-slate-50 inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>Autre compte</span>
              </button>
            </div>
          </div>
        )}

        {/* Signed In -> Enter Personal Access Code (or Pending Status) */}
        {user && !offlineBlockedMessage && (!accessRecord || accessRecord.status === 'pending') && (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-800">
              Compte connecté : <strong className="text-slate-950">{user.email}</strong>
            </div>

            <form onSubmit={handleVerifyCode} className="space-y-3">
              <label className="block space-y-1.5">
                <span className="flex items-center gap-1.5 text-xs font-bold text-slate-950">
                  <KeyRound className="w-4 h-4 text-amber-600" />
                  <span>Code personnel d’accès</span>
                </span>
                <input
                  type="text"
                  required
                  value={personalCode}
                  onChange={(e) => setPersonalCode(e.target.value)}
                  placeholder="Saisissez le code donné par Fabien Pirquin"
                  autoComplete="one-time-code"
                  className="w-full min-h-[48px] px-3.5 rounded-xl border border-slate-300 bg-white text-sm font-mono tracking-wider text-slate-950 placeholder:font-sans placeholder:tracking-normal placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </label>

              <button
                type="submit"
                disabled={verifyingCode || !personalCode.trim()}
                className="w-full min-h-[48px] px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {verifyingCode ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <KeyRound className="w-4 h-4" />
                )}
                <span>{verifyingCode ? 'Vérification...' : 'Valider mon code d’accès'}</span>
              </button>
            </form>

            {accessRecord?.status === 'pending' && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3.5 space-y-1.5 text-xs text-slate-900">
                <div className="flex items-center gap-1.5 font-bold">
                  <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Demande déjà enregistrée</span>
                </div>
                <p className="text-[11px] text-slate-700">
                  Vous pouvez soit saisir votre code personnel ci-dessus, soit attendre que Fabien Pirquin valide votre accès puis cliquer sur Actualiser.
                </p>
              </div>
            )}

            {infoMessage && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-900">
                {infoMessage}
              </div>
            )}

            {authError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-900 break-words">
                {authError}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100">
              {accessRecord?.status === 'pending' ? (
                <button
                  type="button"
                  disabled={refreshing}
                  onClick={handleCheckStatus}
                  className="min-h-[40px] px-3 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  {refreshing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  <span>Actualiser</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={requestingAccess}
                  onClick={handleRequestAccessWithoutCode}
                  className="text-xs font-medium text-slate-600 hover:text-slate-950 underline cursor-pointer disabled:opacity-50"
                >
                  {requestingAccess
                    ? 'Envoi de la demande...'
                    : 'Pas encore de code ? Demander l’accès'}
                </button>
              )}

              <button
                type="button"
                onClick={handleSwitchAccount}
                className="min-h-[40px] px-3 rounded-xl border border-slate-300 bg-white text-slate-800 text-xs font-semibold hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Autre compte</span>
              </button>
            </div>
          </div>
        )}

        {/* Signed In -> Revoked / Denied */}
        {user && !offlineBlockedMessage && accessRecord?.status === 'revoked' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-bold text-red-950">
                <ShieldAlert className="w-5 h-5 text-red-600 shrink-0" />
                <span>Accès non autorisé</span>
              </div>
              <p className="text-xs leading-relaxed text-red-900">
                L’accès pour <strong>{user.email}</strong> a été suspendu ou supprimé par l’administrateur (Fabien Pirquin).
              </p>
            </div>

            <button
              type="button"
              onClick={handleSwitchAccount}
              className="w-full min-h-[46px] px-4 rounded-xl border border-slate-300 bg-white text-slate-900 text-xs font-semibold hover:bg-slate-50 inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Changer de compte Google</span>
            </button>
          </div>
        )}
      </div>

      <footer className="mt-4 text-xs text-slate-500">ChantierShot · F.Pirquin</footer>
    </div>
  );
};
