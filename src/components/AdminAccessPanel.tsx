import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Clock,
  Copy,
  KeyRound,
  Loader2,
  LogOut,
  MailPlus,
  Pencil,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Trash2,
  UserCheck,
  UserX,
} from 'lucide-react';
import {
  AccessUserRecord,
  ADMIN_EMAIL,
  adminDeleteAccessUser,
  adminDeleteAuthorizedEmailAndUsers,
  adminSaveAuthorizedEmailCode,
  adminUpdateUserStatus,
  extractFirestoreErrorReason,
  fetchAdminAccessData,
  generatePersonalAccessCode,
  PreauthorizedEmailRecord,
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
  const [refreshing, setRefreshing] = useState(false);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Add / update colleague email + personal code
  const [newEmail, setNewEmail] = useState('');
  const [newCode, setNewCode] = useState(() => generatePersonalAccessCode());
  const [newNote, setNewNote] = useState('');
  const [savingAccess, setSavingAccess] = useState(false);

  const [editingEmailId, setEditingEmailId] = useState<string | null>(null);
  const [editCodeDraft, setEditCodeDraft] = useState('');
  const [editNoteDraft, setEditNoteDraft] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmDeleteEmailId, setConfirmDeleteEmailId] = useState<string | null>(null);
  const [confirmDeleteUid, setConfirmDeleteUid] = useState<string | null>(null);

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await fetchAdminAccessData();
      setUsers(data.users);
      setPreauthEmails(data.preauthEmails);
      setError(null);
    } catch (err) {
      setError(extractFirestoreErrorReason(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData(false);
  }, [loadData]);

  const usersByEmail = useMemo(() => {
    const map = new Map<string, AccessUserRecord[]>();
    for (const u of users) {
      if (u.role === 'admin') continue;
      const key = u.email.trim().toLowerCase();
      const arr = map.get(key) || [];
      arr.push(u);
      map.set(key, arr);
    }
    return map;
  }, [users]);

  const pendingUsers = useMemo(
    () => users.filter((u) => u.status === 'pending' && u.role !== 'admin'),
    [users]
  );

  // Users approved without a preauthorized email entry (legacy manual approvals)
  const preauthEmailSet = useMemo(
    () => new Set(preauthEmails.map((p) => p.email.trim().toLowerCase())),
    [preauthEmails]
  );
  const extraConnectedUsers = useMemo(
    () =>
      users.filter(
        (u) =>
          u.role !== 'admin' &&
          u.status !== 'pending' &&
          !preauthEmailSet.has(u.email.trim().toLowerCase())
      ),
    [users, preauthEmailSet]
  );

  const handleCreateAuthorizedEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = newEmail.trim().toLowerCase();
    const cleanCode = newCode.trim();
    if (!cleanEmail || !cleanCode) return;

    setSavingAccess(true);
    setError(null);
    try {
      const saved = await adminSaveAuthorizedEmailCode(
        cleanEmail,
        cleanCode,
        newNote,
        adminUid
      );

      // If this colleague already had a pending or revoked request, approve it immediately
      const matching = usersByEmail.get(cleanEmail) || [];
      for (const u of matching) {
        if (u.status !== 'approved') {
          await adminUpdateUserStatus(u.uid, 'approved', newNote.trim() || undefined);
        }
      }

      setPreauthEmails((prev) => {
        const filtered = prev.filter((p) => p.id !== saved.id);
        return [...filtered, saved].sort((a, b) =>
          a.email.localeCompare(b.email, 'fr', { sensitivity: 'base' })
        );
      });
      if (matching.length > 0) {
        setUsers((prev) =>
          prev.map((u) =>
            u.email.trim().toLowerCase() === cleanEmail ? { ...u, status: 'approved' } : u
          )
        );
      }

      setNewEmail('');
      setNewNote('');
      setNewCode(generatePersonalAccessCode());
      onFeedback?.(`Accès créé pour ${cleanEmail} (code : ${cleanCode}).`);
    } catch (err) {
      setError(extractFirestoreErrorReason(err));
    } finally {
      setSavingAccess(false);
    }
  };

  const handleSaveEditedCode = async (item: PreauthorizedEmailRecord) => {
    if (!editCodeDraft.trim()) return;
    setBusyUid(item.id);
    setError(null);
    try {
      const saved = await adminSaveAuthorizedEmailCode(
        item.email,
        editCodeDraft,
        editNoteDraft,
        adminUid
      );
      setPreauthEmails((prev) =>
        prev.map((p) => (p.id === item.id ? { ...p, ...saved } : p))
      );
      setEditingEmailId(null);
      onFeedback?.(`Code mis à jour pour ${item.email}.`);
    } catch (err) {
      setError(extractFirestoreErrorReason(err));
    } finally {
      setBusyUid(null);
    }
  };

  const handleDeleteAuthorizedEmail = async (item: PreauthorizedEmailRecord) => {
    setBusyUid(item.id);
    setError(null);
    try {
      const matching = usersByEmail.get(item.email.trim().toLowerCase()) || [];
      await adminDeleteAuthorizedEmailAndUsers(item, matching);
      setPreauthEmails((prev) => prev.filter((p) => p.id !== item.id));
      const deletedUids = new Set(matching.map((u) => u.uid));
      setUsers((prev) => prev.filter((u) => !deletedUids.has(u.uid)));
      setConfirmDeleteEmailId(null);
      onFeedback?.(`Accès supprimé pour ${item.email}.`);
    } catch (err) {
      setError(extractFirestoreErrorReason(err));
    } finally {
      setBusyUid(null);
    }
  };

  const handleCopyCredentials = async (item: PreauthorizedEmailRecord) => {
    const codePart = item.accessCode ? `\nCode personnel : ${item.accessCode}` : '';
    const text = `Accès ChantierShot\nAdresse Google : ${item.email}${codePart}\nLien : ${window.location.origin}${window.location.pathname}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId((c) => (c === item.id ? null : c)), 2000);
      onFeedback?.('E-mail et code copiés.');
    } catch {
      onFeedback?.(`E-mail : ${item.email} · Code : ${item.accessCode || '—'}`);
    }
  };

  const handleSetUserStatus = async (
    uid: string,
    status: 'approved' | 'revoked' | 'pending',
    label: string
  ) => {
    setBusyUid(uid);
    setError(null);
    try {
      await adminUpdateUserStatus(uid, status);
      setUsers((prev) => prev.map((u) => (u.uid === uid ? { ...u, status } : u)));
      onFeedback?.(label);
    } catch (err) {
      setError(extractFirestoreErrorReason(err));
    } finally {
      setBusyUid(null);
    }
  };

  const handleDeleteUser = async (uid: string) => {
    setBusyUid(uid);
    setError(null);
    try {
      await adminDeleteAccessUser(uid);
      setUsers((prev) => prev.filter((u) => u.uid !== uid));
      setConfirmDeleteUid(null);
      onFeedback?.('Appareil supprimé de la liste.');
    } catch (err) {
      setError(extractFirestoreErrorReason(err));
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
            Gestion des accès & codes collègues
          </h1>
          <p className="text-xs text-slate-700">
            Attribuez un e-mail Google et son code personnel à chaque collègue. Mode ultra-économe : aucune écoute en arrière-plan.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={refreshing || loading}
            onClick={() => loadData(true)}
            className="min-h-[42px] px-3 rounded-xl border border-slate-300 bg-white text-slate-800 text-xs font-semibold hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Actualiser</span>
          </button>

          <button
            type="button"
            onClick={onSignOut}
            className="min-h-[42px] px-3.5 rounded-xl border border-slate-300 bg-white text-slate-800 text-xs font-semibold hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Déconnexion ({currentEmail.split('@')[0]})</span>
          </button>
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-900">
          {error}
        </div>
      )}

      {/* Encode Email + Personal Code Form */}
      <section className="rounded-2xl border border-slate-300 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 text-sm font-bold text-slate-950">
          <MailPlus className="w-4 h-4 text-amber-600" />
          <span>Ajouter un collègue (e-mail + code personnel)</span>
        </div>

        <form onSubmit={handleCreateAuthorizedEmail} className="p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
            <div className="sm:col-span-5 space-y-1">
              <label className="block text-[11px] font-semibold text-slate-700">
                Adresse e-mail Google du collègue
              </label>
              <input
                type="email"
                required
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="collegue@gmail.com"
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 text-sm text-slate-950 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="sm:col-span-4 space-y-1">
              <label className="block text-[11px] font-semibold text-slate-700">
                Code personnel (min. 3 caractères)
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  required
                  minLength={3}
                  maxLength={32}
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  placeholder="ex: 482915"
                  className="flex-1 min-w-0 min-h-[42px] px-3 rounded-xl border border-slate-300 font-mono text-sm text-slate-950 placeholder:font-sans placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <button
                  type="button"
                  onClick={() => setNewCode(generatePersonalAccessCode())}
                  title="Générer un nouveau code aléatoire"
                  className="min-h-[42px] px-2.5 rounded-xl border border-slate-300 bg-slate-50 text-slate-800 hover:bg-slate-100 text-xs font-semibold inline-flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                  <span>Générer</span>
                </button>
              </div>
            </div>

            <div className="sm:col-span-3 space-y-1">
              <label className="block text-[11px] font-semibold text-slate-700">
                Nom / équipe (optionnel)
              </label>
              <input
                type="text"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Ex : Marc · Élec"
                maxLength={120}
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-300 text-sm text-slate-950 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <span className="text-[11px] text-slate-600">
              Le collègue se connectera 1 fois avec cet e-mail Google puis saisira ce code personnel.
            </span>
            <button
              type="submit"
              disabled={savingAccess || !newEmail.trim() || newCode.trim().length < 3}
              className="min-h-[44px] px-5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {savingAccess ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <KeyRound className="w-4 h-4" />
              )}
              <span>Enregistrer l’accès</span>
            </button>
          </div>
        </form>
      </section>

      {loading ? (
        <div className="rounded-2xl border border-slate-300 bg-white p-8 text-center space-y-2">
          <Loader2 className="w-6 h-6 animate-spin text-amber-600 mx-auto" />
          <p className="text-xs text-slate-700">Chargement des accès...</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Authorized Email + Code List */}
          <section className="rounded-2xl border border-slate-300 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-950">
                <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                <span>Accès configurés ({preauthEmails.length})</span>
              </div>
            </div>

            {preauthEmails.length === 0 ? (
              <div className="p-6 text-xs text-slate-600 text-center">
                Aucun collègue encodé pour l’instant. Ajoutez une adresse e-mail et son code ci-dessus.
              </div>
            ) : (
              <ul className="divide-y divide-slate-200">
                {preauthEmails.map((item) => {
                  const linkedUsers =
                    usersByEmail.get(item.email.trim().toLowerCase()) || [];
                  const activeDevice = linkedUsers.find((u) => u.status === 'approved');
                  const isEditing = editingEmailId === item.id;
                  const isConfirmDelete = confirmDeleteEmailId === item.id;

                  return (
                    <li key={item.id} className="p-4 space-y-2.5">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-bold text-slate-950 truncate">
                              {item.email}
                            </span>
                            {activeDevice ? (
                              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200">
                                Connecté ({activeDevice.deviceHint || 'Appareil'})
                              </span>
                            ) : (
                              <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">
                                En attente de 1re connexion
                              </span>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-slate-950 font-mono font-bold">
                              <KeyRound className="w-3 h-3 text-amber-600" />
                              <span>{item.accessCode || 'Sans code'}</span>
                            </span>
                            {item.note && (
                              <span className="text-slate-600 truncate">· {item.note}</span>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleCopyCredentials(item)}
                            className="min-h-[38px] px-2.5 rounded-xl border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            {copiedId === item.id ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5 text-amber-600" />
                            )}
                            <span>{copiedId === item.id ? 'Copié' : 'Copier'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              if (isEditing) {
                                setEditingEmailId(null);
                              } else {
                                setEditingEmailId(item.id);
                                setEditCodeDraft(
                                  item.accessCode || generatePersonalAccessCode()
                                );
                                setEditNoteDraft(item.note || '');
                              }
                            }}
                            className="min-h-[38px] px-2.5 rounded-xl border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            <span>Code</span>
                          </button>

                          {!isConfirmDelete ? (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteEmailId(item.id)}
                              className="min-h-[38px] px-3 rounded-xl border border-red-200 bg-white text-red-600 hover:bg-red-50 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Supprimer</span>
                            </button>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                disabled={busyUid === item.id}
                                onClick={() => handleDeleteAuthorizedEmail(item)}
                                className="min-h-[38px] px-3 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700 cursor-pointer disabled:opacity-50"
                              >
                                Confirmer
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteEmailId(null)}
                                className="min-h-[38px] px-2.5 rounded-xl border border-slate-300 bg-white text-slate-700 text-xs cursor-pointer"
                              >
                                Annuler
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {isEditing && (
                        <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row gap-2">
                          <input
                            type="text"
                            minLength={3}
                            maxLength={32}
                            value={editCodeDraft}
                            onChange={(e) => setEditCodeDraft(e.target.value)}
                            placeholder="Nouveau code personnel"
                            className="sm:w-44 min-h-[38px] px-3 rounded-lg border border-slate-300 font-mono text-xs text-slate-950 focus:outline-none focus:ring-2 focus:ring-amber-500"
                          />
                          <input
                            type="text"
                            maxLength={120}
                            value={editNoteDraft}
                            onChange={(e) => setEditNoteDraft(e.target.value)}
                            placeholder="Nom / équipe (optionnel)"
                            className="flex-1 min-h-[38px] px-3 rounded-lg border border-slate-300 text-xs text-slate-950 focus:outline-none focus:ring-2 focus:ring-amber-500"
                          />
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={busyUid === item.id || editCodeDraft.trim().length < 3}
                              onClick={() => handleSaveEditedCode(item)}
                              className="min-h-[38px] px-3 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 cursor-pointer disabled:opacity-50"
                            >
                              Enregistrer
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingEmailId(null)}
                              className="min-h-[38px] px-2.5 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs cursor-pointer"
                            >
                              Annuler
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Optional Pending Requests (colleagues who clicked "Demander l'accès" without a code) */}
          {pendingUsers.length > 0 && (
            <section className="rounded-2xl border border-slate-300 bg-white overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 text-sm font-bold text-slate-950">
                <Clock className="w-4 h-4 text-amber-600" />
                <span>Demandes en attente sans code ({pendingUsers.length})</span>
              </div>

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
                          handleSetUserStatus(
                            u.uid,
                            'approved',
                            `Accès autorisé pour ${u.displayName}.`
                          )
                        }
                        className="min-h-[40px] px-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <UserCheck className="w-4 h-4" />
                        <span>Autoriser</span>
                      </button>

                      <button
                        type="button"
                        disabled={busyUid === u.uid}
                        onClick={() => handleDeleteUser(u.uid)}
                        className="min-h-[40px] px-3 rounded-xl border border-red-200 bg-white text-red-600 hover:bg-red-50 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <UserX className="w-4 h-4" />
                        <span>Refuser</span>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Any extra devices approved outside the email+code list */}
          {extraConnectedUsers.length > 0 && (
            <section className="rounded-2xl border border-slate-300 bg-white overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 text-sm font-bold text-slate-950">
                <ShieldOff className="w-4 h-4 text-slate-700" />
                <span>Autres appareils enregistrés ({extraConnectedUsers.length})</span>
              </div>

              <ul className="divide-y divide-slate-200">
                {extraConnectedUsers.map((u) => (
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
                        {u.status === 'revoked' ? ' · Bloqué' : ''}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {u.status === 'approved' ? (
                        <button
                          type="button"
                          disabled={busyUid === u.uid}
                          onClick={() =>
                            handleSetUserStatus(
                              u.uid,
                              'revoked',
                              `Accès révoqué pour ${u.displayName}.`
                            )
                          }
                          className="min-h-[38px] px-3 rounded-xl border border-red-200 bg-white text-red-600 hover:bg-red-50 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          <ShieldOff className="w-4 h-4" />
                          <span>Révoquer</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busyUid === u.uid}
                          onClick={() =>
                            handleSetUserStatus(
                              u.uid,
                              'approved',
                              `Accès réactivé pour ${u.displayName}.`
                            )
                          }
                          className="min-h-[38px] px-3 rounded-xl border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          <UserCheck className="w-4 h-4 text-emerald-700" />
                          <span>Réactiver</span>
                        </button>
                      )}

                      {confirmDeleteUid === u.uid ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleDeleteUser(u.uid)}
                            className="min-h-[38px] px-3 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700 cursor-pointer"
                          >
                            Confirmer
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteUid(null)}
                            className="min-h-[38px] px-2.5 rounded-xl border border-slate-300 bg-white text-slate-700 text-xs cursor-pointer"
                          >
                            Annuler
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteUid(u.uid)}
                          className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:text-red-600 hover:bg-red-50 cursor-pointer"
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
