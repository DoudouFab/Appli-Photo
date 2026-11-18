import React, { useState } from 'react';
import {
  User,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  Clock,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  MailCheck,
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
  onEmailVerified?: () => void;
}

export const AccessGate: React.FC<AccessGateProps> = ({
  authLoading,
  user,
  accessRecord,
  checkingAccess,
  offlineBlockedMessage,
  onManualAccessRefresh,
  onEmailVerified,
}) => {
  const [authMethod, setAuthMethod] = useState<'google' | 'email'>('google');
  const [emailMode, setEmailMode] = useState<'signin' | 'signup'>('signup');
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');

  const [signingIn, setSigningIn] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [requestingAccess, setRequestingAccess] = useState(false);
  const [resendingEmail, setResendingEmail] = useState(false);
  const [checkingEmailVerified, setCheckingEmailVerified] = useState(false);
  const [personalCode, setPersonalCode] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const isGoogleUser = Boolean(
    user?.providerData?.some((p) => p.providerId === 'google.com')
  );
  const needsEmailVerification = Boolean(
    user && !isGoogleUser && !user.emailVerified
  );

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

  const mapEmailAuthError = (err: unknown): string => {
    const code = (err as { code?: string })?.code || '';
    if (code === 'auth/operation-not-allowed') {
      return 'La connexion par e-mail n’est pas encore activée dans Firebase Console (Authentication → Sign-in method → Adresse e-mail/Mot de passe).';
    }
    if (code === 'auth/email-already-in-use') {
      return 'Un compte existe déjà avec cette adresse e-mail. Cliquez sur « Déjà inscrit » pour vous connecter.';
    }
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
      return 'Adresse e-mail ou mot de passe incorrect.';
    }
    if (code === 'auth/weak-password') {
      return 'Le mot de passe doit contenir au moins 6 caractères.';
    }
    if (code === 'auth/invalid-email') {
      return 'Adresse e-mail invalide.';
    }
    if (code === 'auth/too-many-requests') {
      return 'Trop de tentatives. Patientez quelques instants avant de réessayer.';
    }
    return err instanceof Error
      ? err.message
      : 'Impossible de se connecter avec cette adresse e-mail.';
  };

  const handleEmailAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = emailInput.trim();
    if (!cleanEmail || !passwordInput) return;

    setSigningIn(true);
    setAuthError(null);
    setInfoMessage(null);
    try {
      if (emailMode === 'signup') {
        const cred = await createUserWithEmailAndPassword(auth, cleanEmail, passwordInput);
        await sendEmailVerification(cred.user).catch(() => {});
      } else {
        await signInWithEmailAndPassword(auth, cleanEmail, passwordInput);
      }
    } catch (err) {
      setAuthError(mapEmailAuthError(err));
    } finally {
      setSigningIn(false);
    }
  };

  const handleResetPassword = async () => {
    const cleanEmail = emailInput.trim();
    if (!cleanEmail) {
      setAuthError('Saisissez d’abord votre adresse e-mail professionnelle ci-dessus.');
      return;
    }
    setAuthError(null);
    setInfoMessage(null);
    try {
      await sendPasswordResetEmail(auth, cleanEmail);
      setInfoMessage(`Un e-mail de réinitialisation vient d’être envoyé à ${cleanEmail}.`);
    } catch (err) {
      setAuthError(mapEmailAuthError(err));
    }
  };

  const handleCheckEmailVerified = async () => {
    if (!user) return;
    setCheckingEmailVerified(true);
    setAuthError(null);
    setInfoMessage(null);
    try {
      await user.reload();
      if (auth.currentUser?.emailVerified) {
        onEmailVerified?.();
      } else {
        setAuthError(
          'Adresse pas encore confirmée. Ouvrez le mail reçu dans votre boîte pro (ou spams) puis cliquez sur le lien avant de réessayer.'
        );
      }
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Impossible de vérifier votre e-mail.'
      );
    } finally {
      setCheckingEmailVerified(false);
    }
  };

  const handleResendVerification = async () => {
    if (!user) return;
    setResendingEmail(true);
    setAuthError(null);
    setInfoMessage(null);
    try {
      await sendEmailVerification(user);
      setInfoMessage(`E-mail de confirmation renvoyé à ${user.email}.`);
    } catch (err) {
      setAuthError(mapEmailAuthError(err));
    } finally {
      setResendingEmail(false);
    }
  };

  const handleSwitchAccount = async () => {
    clearCachedApproval();
    setPersonalCode('');
    setPasswordInput('');
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

  if (authLoading || (user && !needsEmailVerification && checkingAccess && !accessRecord)) {
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
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 space-y-1.5 text-sm text-slate-800">
              <div className="flex items-center gap-2 font-bold text-slate-950 text-xs">
                <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Connexion unique par appareil</span>
              </div>
              <p className="text-xs leading-relaxed text-slate-700">
                Connectez-vous <strong>une seule fois</strong> (compte Google ou e-mail pro{' '}
                <span className="font-mono">@insaep.be</span>), puis saisissez le code personnel fourni par{' '}
                <strong>Fabien Pirquin</strong>.
              </p>
            </div>

            {/* Method Toggle: Google vs Work Email */}
            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100">
              <button
                type="button"
                onClick={() => {
                  setAuthMethod('google');
                  setAuthError(null);
                  setInfoMessage(null);
                }}
                className={`min-h-[40px] px-2.5 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                  authMethod === 'google'
                    ? 'bg-white text-slate-950 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <LogIn className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>Compte Google</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMethod('email');
                  setAuthError(null);
                  setInfoMessage(null);
                }}
                className={`min-h-[40px] px-2.5 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                  authMethod === 'email'
                    ? 'bg-white text-slate-950 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Mail className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                <span>E-mail pro</span>
              </button>
            </div>

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

            {authMethod === 'google' ? (
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
            ) : (
              <form onSubmit={handleEmailAuthSubmit} className="space-y-3">
                <div className="grid grid-cols-2 gap-1.5 text-[11px] font-semibold">
                  <button
                    type="button"
                    onClick={() => {
                      setEmailMode('signup');
                      setAuthError(null);
                      setInfoMessage(null);
                    }}
                    className={`min-h-[34px] rounded-lg border cursor-pointer transition-colors ${
                      emailMode === 'signup'
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    1re connexion
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEmailMode('signin');
                      setAuthError(null);
                      setInfoMessage(null);
                    }}
                    className={`min-h-[34px] rounded-lg border cursor-pointer transition-colors ${
                      emailMode === 'signin'
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Déjà inscrit
                  </button>
                </div>

                <div className="space-y-2">
                  <input
                    type="email"
                    required
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="prenom.nom@insaep.be"
                    autoComplete="email"
                    className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm text-slate-950 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    placeholder={
                      emailMode === 'signup'
                        ? 'Choisissez un mot de passe (min. 6 caractères)'
                        : 'Votre mot de passe'
                    }
                    autoComplete={emailMode === 'signup' ? 'new-password' : 'current-password'}
                    className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm text-slate-950 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <button
                  type="submit"
                  disabled={signingIn || !emailInput.trim() || passwordInput.length < 6}
                  className="w-full min-h-[48px] px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {signingIn ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Mail className="w-4 h-4" />
                  )}
                  <span>
                    {signingIn
                      ? 'Connexion...'
                      : emailMode === 'signup'
                      ? 'Créer mon accès pro'
                      : 'Se connecter'}
                  </span>
                </button>

                {emailMode === 'signin' && (
                  <button
                    type="button"
                    onClick={handleResetPassword}
                    className="w-full text-center text-xs text-slate-600 hover:text-slate-950 underline cursor-pointer"
                  >
                    Mot de passe oublié ?
                  </button>
                )}
              </form>
            )}
          </div>
        )}

        {/* Signed In via Email/Password -> Verify Work Email Inbox */}
        {user && needsEmailVerification && (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-2 text-xs text-slate-900">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-950">
                <MailCheck className="w-5 h-5 text-amber-600 shrink-0" />
                <span>Confirmez votre e-mail pro</span>
              </div>
              <p className="leading-relaxed">
                Un lien de confirmation a été envoyé à <strong>{user.email}</strong> (vérifiez aussi vos spams/indésirables). Cliquez sur le lien dans votre boîte mail, puis appuyez ci-dessous :
              </p>
            </div>

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

            <button
              type="button"
              disabled={checkingEmailVerified}
              onClick={handleCheckEmailVerified}
              className="w-full min-h-[48px] px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {checkingEmailVerified ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              <span>J’ai cliqué sur le lien — Continuer</span>
            </button>

            <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
              <button
                type="button"
                disabled={resendingEmail}
                onClick={handleResendVerification}
                className="text-xs font-medium text-slate-700 hover:text-slate-950 underline cursor-pointer disabled:opacity-50"
              >
                {resendingEmail ? 'Envoi...' : 'Renvoyer l’e-mail'}
              </button>
              <button
                type="button"
                onClick={handleSwitchAccount}
                className="min-h-[38px] px-3 rounded-xl border border-slate-300 bg-white text-slate-800 text-xs font-semibold hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Autre compte</span>
              </button>
            </div>
          </div>
        )}

        {/* Signed In & Verified -> Error / Offline Blocked */}
        {user && !needsEmailVerification && offlineBlockedMessage && (
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

        {/* Signed In & Verified -> Enter Personal Access Code (or Pending Status) */}
        {user && !needsEmailVerification && !offlineBlockedMessage && (!accessRecord || accessRecord.status === 'pending') && (
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

        {/* Signed In & Verified -> Revoked / Denied */}
        {user && !needsEmailVerification && !offlineBlockedMessage && accessRecord?.status === 'revoked' && (
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
              <span>Changer de compte</span>
            </button>
          </div>
        )}
      </div>

      <footer className="mt-4 text-xs text-slate-500">ChantierShot · F.Pirquin</footer>
    </div>
  );
};
