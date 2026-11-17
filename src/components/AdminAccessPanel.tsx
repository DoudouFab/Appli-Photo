import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Loader2,
  LogOut,
  MailPlus,
  ShieldCheck,
  ShieldOff,
  Trash2,
  UserCheck,
  UserX,
} from 'lucide-react';
import {
  AccessUserRecord,
  ADMIN_EMAIL,
  adminAddPreauthorizedEmail,
  adminDeleteAccessUser,
  adminRemovePreauthorizedEmail,
  adminUpdateUserStatus,
  extractFirestoreErrorReason,
  PreauthorizedEmailRecord,
  subscribeToAllAccessUsers,
  subscribeToPreauthorizedEmails,
} from '../lib/accessControl';

interface AdminAccessPanelProps {
  adminUid: string;
  currentEmail: string;
  onSignOut: () => Promise<void>;
  onFeedback?: (msg: string) => void;
}

export const AdminAccessPanel: React.FC<AdminAccessPanelProps> = ({
  adminUid,
  currentEmail,
  onSignOut,
  onFeedback,
}) => {
  const [users, setUsers] = useState<AccessUserRecord[]>([]);
  const [preauthEmails, setPreauthEmails] = useState<PreauthorizedEmailRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteUid, setConfirmDeleteUid] = useState<string | null>(null);
  const [newPreauthEmail, setNewPreauthEmail] = useState('');
  const [newPreauthNote, setNewPreauthNote] = useState('');
  const [addingPreauth, setAddingPreauth] = useState(false);

  useEffect(() => {
    setLoading(true);
    const unsubUsers = subscribeToAllAccessUsers(
      (list) => {
        setUsers(list);
        setLoading(false);
        setError(null);
      },
      (err) => {
        const reason = extractFirestoreErrorReason(err);
        setError(
          reason.toLowerCase().includes('quota')
            ? 'Quota gratuit Firestore atteint pour aujourd’hui : il sera réinitialisé automatiquement demain.'
            : reason
        );
        setLoading(false);
      }
    );
    const unsubPreauth = subscribeToPreauthorizedEmails(
      (items) => {
        setPreauthEmails(items);
      },
      () => {}
    );
    return () => {
      unsubUsers();
      unsubPreauth();
    };
  }, []);

  const pendingUsers = useMemo(
    () => users.filter((u) => u.status === 'pending' && u.role !== 'admin'),
    [users]
  );
  const approvedUsers = useMemo(
    () => users.filter((u) => u.status === 'approved' && u.role !== 'admin'),
    [users]
  );
  const revokedUsers = useMemo(
    () => users.filter((u) => u.status === 'revoked' && u.role !== 'admin'),
    [users]
  );

  const handleSetStatus = async (
    uid: string,
    status: 'approved' | 'revoked' | 'pending',
    label: string
  ) => {
    setBusyUid(uid);
    try {
      await adminUpdateUserStatus(uid, status);
      onFeedback?.(label);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la mise à jour.');
    } finally {
      setBusyUid(null);
    }
  };

  const handleDelete = async (uid: string) => {
    setBusyUid(uid);
    try {
      await adminDeleteAccessUser(uid);
      setConfirmDeleteUid(null);
      onFeedback?.('Compte retiré de la liste.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la suppression.');
    } finally {
      setBusyUid(null);
    }
  };

  const handleAddPreauth = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = newPreauthEmail.trim().toLowerCase();
    if (!cleanEmail) return;
    setAddingPreauth(true);
    setError(null);
    try {
      await adminAddPreauthorizedEmail(cleanEmail, newPreauthNote, adminUid);
      const existingMatching = users.find(
        (u) => u.email.trim().toLowerCase() === cleanEmail && u.role !== 'admin' && u.status !== 'approved'
      );
      if (existingMatching) {
        await adminUpdateUserStatus(existingMatching.uid, 'approved', newPreauthNote.trim() || undefined);
      }
      setNewPreauthEmail('');
      setNewPreauthNote('');
      onFeedback?.(
        existingMatching
          ? `${cleanEmail} pré-autorisé et activé immédiatement.`
          : `${cleanEmail} pré-autorisé : il entrera directement dès sa première connexion.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible d’ajouter cet e-mail.');
    } finally {
      setAddingPreauth(false);
    }
  };

  const handleRemovePreauth = async (item: PreauthorizedEmailRecord) => {
    setBusyUid(item.id);
    try {
      await adminRemovePreauthorizedEmail(item.id);
      onFeedback?.(`Pré-autorisation retirée pour ${item.email}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors du retrait.');
    } finally {
      setBusyUid(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-3 sm:px-6 py-4 sm:py-6 space-y-5">
      {/* Header Card */}
      <section className="rounded-2xl border border-slate-300 bg-white p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-amber-700">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>Administrateur unique : {ADMIN_EMAIL}</span>
          </div>
          <h1 className="text-lg sm:text-xl font-bold text-slate-950 font-display">
            Contrôle des accès collègues
          </h1>
          <p className="text-xs text-slate-700">
            Si un collègue partage le lien de l’appli, toute nouvelle personne reste bloquée en attente tant que vous ne l’autorisez pas ici.
          </p>
        </div>

        <button
          type="button"
          onClick={onSignOut}
          className="min-h-[42px] px-3.5 rounded-xl border border-slate-300 bg-white text-slate-800 text-xs font-semibold hover:bg-slate-50 inline-flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          <span>Déconnexion ({currentEmail.split('@')[0]})</span>
        </button>
      </section>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-900">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-slate-300 bg-white p-8 text-center space-y-2">
          <Loader2 className="w-6 h-6 animate-spin text-amber-600 mx-auto" />
          <p className="text-xs text-slate-700">Chargement des demandes d’accès...</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Pre-authorize colleague by email */}
          <section className="rounded-2xl border border-slate-300 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-950">
                <MailPlus className="w-4 h-4 text-amber-600" />
                <span>Pré-autoriser un collègue par e-mail ({preauthEmails.length})</span>
              </div>
            </div>

            <div className="p-4 space-y-3">
              <p className="text-xs text-slate-700">
                Ajoutez l’adresse Google d’un collègue à l’avance : il accèdera à l’application directement dès sa première connexion sans attendre votre validation.
              </p>

              <form onSubmit={handleAddPreauth} className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                <input
                  type="email"
                  required
                  value={newPreauthEmail}
                  onChange={(e) => setNewPreauthEmail(e.target.value)}
                  placeholder="collegue@gmail.com"
                  className="sm:col-span-5 min-h-[42px] px-3 rounded-xl border border-slate-300 text-sm text-slate-950 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <input
                  type="text"
                  value={newPreauthNote}
                  onChange={(e) => setNewPreauthNote(e.target.value)}
                  placeholder="Nom / équipe (optionnel)"
                  maxLength={120}
                  className="sm:col-span-4 min-h-[42px] px-3 rounded-xl border border-slate-300 text-sm text-slate-950 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <button
                  type="submit"
                  disabled={addingPreauth || !newPreauthEmail.trim()}
                  className="sm:col-span-3 min-h-[42px] px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap"
                >
                  {addingPreauth ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <MailPlus className="w-4 h-4" />
                  )}
                  <span>Pré-autoriser</span>
                </button>
              </form>

              {preauthEmails.length > 0 && (
                <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 overflow-hidden">
                  {preauthEmails.map((item) => (
                    <li
                      key={item.id}
                      className="px-3.5 py-2.5 bg-slate-50 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-950 truncate">
                          {item.email}
                        </div>
                        {item.note && (
                          <div className="text-[11px] text-slate-600 truncate">{item.note}</div>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={busyUid === item.id}
                        onClick={() => handleRemovePreauth(item)}
                        className="min-h-[34px] px-2.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:text-red-600 hover:bg-red-50 text-xs font-medium inline-flex items-center gap-1 shrink-0 cursor-pointer disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Retirer</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* Pending Requests */}
          <section className="rounded-2xl border border-slate-300 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-950">
                <Clock className="w-4 h-4 text-amber-600" />
                <span>Demandes en attente ({pendingUsers.length})</span>
              </div>
            </div>

            {pendingUsers.length === 0 ? (
              <div className="p-5 text-xs text-slate-600 text-center">
                Aucune demande d’accès en attente.
              </div>
            ) : (
              <ul className="divide-y divide-slate-200">
                {pendingUsers.map((u) => (
                  <li
                    key={u.uid}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="text-sm font-bold text-slate-950 truncate">
                        {u.displayName}
                      </div>
                      <div className="text-xs text-slate-700 truncate">{u.email}</div>
                      {u.deviceHint && (
                        <div className="text-[11px] text-slate-600">{u.deviceHint}</div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={busyUid === u.uid}
                        onClick={() =>
                          handleSetStatus(
                            u.uid,
                            'approved',
                            `Accès autorisé pour ${u.displayName}.`
                          )
                        }
                        className="min-h-[42px] px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <UserCheck className="w-4 h-4" />
                        <span>Autoriser</span>
                      </button>

                      <button
                        type="button"
                        disabled={busyUid === u.uid}
                        onClick={() =>
                          handleSetStatus(
                            u.uid,
                            'revoked',
                            `Demande refusée pour ${u.displayName}.`
                          )
                        }
                        className="min-h-[42px] px-3 rounded-xl border border-red-200 bg-white text-red-600 hover:bg-red-50 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <UserX className="w-4 h-4" />
                        <span>Refuser</span>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Approved Colleagues */}
          <section className="rounded-2xl border border-slate-300 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 text-sm font-bold text-slate-950">
              <CheckCircle2 className="w-4 h-4 text-emerald-700" />
              <span>Collègues autorisés ({approvedUsers.length})</span>
            </div>

            {approvedUsers.length === 0 ? (
              <div className="p-5 text-xs text-slate-600 text-center">
                Aucun collègue autorisé pour le moment. Partagez le lien à un collègue : dès sa connexion Google unique, il apparaîtra ci-dessus pour validation.
              </div>
            ) : (
              <ul className="divide-y divide-slate-200">
                {approvedUsers.map((u) => (
                  <li
                    key={u.uid}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="text-sm font-bold text-slate-950 truncate">
                        {u.displayName}
                      </div>
                      <div className="text-xs text-slate-700 truncate">
                        {u.email}
                        {u.deviceHint ? ` · ${u.deviceHint}` : ''}
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={busyUid === u.uid}
                      onClick={() =>
                        handleSetStatus(
                          u.uid,
                          'revoked',
                          `Accès révoqué pour ${u.displayName}.`
                        )
                      }
                      className="min-h-[40px] px-3.5 rounded-xl border border-red-200 bg-white text-red-600 hover:bg-red-50 text-xs font-semibold inline-flex items-center justify-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-50"
                    >
                      <ShieldOff className="w-4 h-4" />
                      <span>Révoquer l’accès</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Revoked / Blocked */}
          {revokedUsers.length > 0 && (
            <section className="rounded-2xl border border-slate-300 bg-white overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 text-sm font-bold text-slate-950">
                <ShieldOff className="w-4 h-4 text-red-600" />
                <span>Comptes bloqués ({revokedUsers.length})</span>
              </div>

              <ul className="divide-y divide-slate-200">
                {revokedUsers.map((u) => (
                  <li
                    key={u.uid}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="text-sm font-semibold text-slate-900 truncate">
                        {u.displayName}
                      </div>
                      <div className="text-xs text-slate-600 truncate">{u.email}</div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={busyUid === u.uid}
                        onClick={() =>
                          handleSetStatus(
                            u.uid,
                            'approved',
                            `Accès ré-autorisé pour ${u.displayName}.`
                          )
                        }
                        className="min-h-[40px] px-3 rounded-xl border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <UserCheck className="w-4 h-4 text-emerald-700" />
                        <span>Ré-autoriser</span>
                      </button>

                      {confirmDeleteUid === u.uid ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleDelete(u.uid)}
                            className="min-h-[40px] px-3 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700 cursor-pointer"
                          >
                            Confirmer
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteUid(null)}
                            className="min-h-[40px] px-2.5 rounded-xl border border-slate-300 bg-white text-slate-700 text-xs cursor-pointer"
                          >
                            Annuler
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteUid(u.uid)}
                          className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                          aria-label={`Supprimer ${u.displayName}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
};
