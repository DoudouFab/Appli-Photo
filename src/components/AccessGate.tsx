import React, { useState } from 'react';
import { User, signInWithPopup, signOut } from 'firebase/auth';
import { doc, getDocFromServer } from 'firebase/firestore';
import {
  Clock,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { auth, db, googleProvider } from '../lib/firebase';
import {
  AccessUserRecord,
  ADMIN_EMAIL,
  clearCachedApproval,
  saveCachedApproval,
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
  const [authError, setAuthError] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setSigningIn(true);
    setAuthError(null);
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
    await signOut(auth);
  };

  const handleCheckStatus = async () => {
    if (!user) return;
    setRefreshing(true);
    setAuthError(null);
    try {
      const snap = await getDocFromServer(doc(db, 'access_users', user.uid));
      if (snap.exists()) {
        const rec = snap.data() as AccessUserRecord;
        saveCachedApproval({
          uid: rec.uid,
          email: rec.email,
          role: rec.role,
          status: rec.status,
        });
        onManualAccessRefresh(rec);
      }
    } catch (err) {
      setAuthError(
        err instanceof Error && err.message.includes('offline')
          ? 'Aucune connexion internet pour vérifier l’autorisation.'
          : 'Impossible de vérifier le statut pour le moment.'
      );
    } finally {
      setRefreshing(false);
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
                Connectez-vous <strong>une seule fois</strong> sur ce téléphone ou PC. Votre session reste mémorisée à chaque ouverture. Tout nouvel utilisateur doit être autorisé par{' '}
                <strong>Fabien Pirquin</strong> avant d’accéder à l’application.
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

        {/* Signed In -> Offline Blocked (never approved offline) */}
        {user && offlineBlockedMessage && (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-2 text-xs text-slate-900">
              <div className="font-bold text-sm">Connexion internet requise la 1re fois</div>
              <p>{offlineBlockedMessage}</p>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={handleCheckStatus}
                className="min-h-[46px] px-3 rounded-xl bg-slate-950 text-white text-xs font-semibold hover:bg-slate-800 inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
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

        {/* Signed In -> Pending Admin Approval */}
        {user && !offlineBlockedMessage && (!accessRecord || accessRecord.status === 'pending') && (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-950">
                <Clock className="w-5 h-5 text-amber-600 shrink-0" />
                <span>En attente d’autorisation</span>
              </div>
              <p className="text-xs leading-relaxed text-slate-800">
                Votre demande a bien été enregistrée pour{' '}
                <strong>{user.email}</strong>. Demandez à{' '}
                <strong>{ADMIN_EMAIL}</strong> d’activer votre accès depuis son application.
              </p>
              <p className="text-[11px] text-slate-700">
                Dès que l’accès est validé, cet écran se débloque automatiquement sans avoir à vous reconnecter.
              </p>
            </div>

            {authError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-900">
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
                <span>Actualiser</span>
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

        {/* Signed In -> Revoked / Denied */}
        {user && !offlineBlockedMessage && accessRecord?.status === 'revoked' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-bold text-red-950">
                <ShieldAlert className="w-5 h-5 text-red-600 shrink-0" />
                <span>Accès non autorisé</span>
              </div>
              <p className="text-xs leading-relaxed text-red-900">
                L’accès pour <strong>{user.email}</strong> a été suspendu ou refusé par l’administrateur ({ADMIN_EMAIL}).
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
