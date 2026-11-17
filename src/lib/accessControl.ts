import { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocsFromServer,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';

export const ADMIN_EMAIL = 'pirquinfabien@gmail.com';
const ACCESS_CACHE_KEY = 'chantiershot_access_cache_v1';

export type AccessStatus = 'pending' | 'approved' | 'revoked';
export type AccessRole = 'admin' | 'user';

export interface AccessUserRecord {
  uid: string;
  email: string;
  displayName: string;
  role: AccessRole;
  status: AccessStatus;
  deviceHint?: string;
  note?: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface PreauthorizedEmailRecord {
  id: string;
  email: string;
  accessCode?: string;
  note?: string;
  createdBy: string;
  createdAt?: Timestamp | null;
}

export function emailToSafeDocId(email: string): string {
  return email
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '_')
    .slice(0, 128);
}

export function generatePersonalAccessCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

interface CachedAccessApproval {
  uid: string;
  email: string;
  role: AccessRole;
  status: AccessStatus;
  cachedAt: number;
}

export function isAdminEmail(email?: string | null, emailVerified?: boolean): boolean {
  return Boolean(
    email &&
      emailVerified &&
      email.trim().toLowerCase() === ADMIN_EMAIL.toLowerCase()
  );
}

export function detectDeviceHint(): string {
  if (typeof navigator === 'undefined') return 'Appareil inconnu';
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'Smartphone Android';
  if (/iphone/i.test(ua)) return 'iPhone';
  if (/ipad/i.test(ua)) return 'iPad';
  if (/windows/i.test(ua)) return 'PC Windows';
  if (/macintosh|mac os x/i.test(ua)) return 'Mac';
  return 'Navigateur web';
}

export function loadCachedApproval(uid: string): CachedAccessApproval | null {
  try {
    const raw = localStorage.getItem(ACCESS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedAccessApproval;
    if (parsed.uid !== uid) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveCachedApproval(record: {
  uid: string;
  email: string;
  role: AccessRole;
  status: AccessStatus;
}): void {
  if (record.status !== 'approved') {
    localStorage.removeItem(ACCESS_CACHE_KEY);
    return;
  }
  const payload: CachedAccessApproval = {
    ...record,
    cachedAt: Date.now(),
  };
  localStorage.setItem(ACCESS_CACHE_KEY, JSON.stringify(payload));
}

export function clearCachedApproval(): void {
  localStorage.removeItem(ACCESS_CACHE_KEY);
}

export function extractFirestoreErrorReason(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  let extracted = raw;
  try {
    const parsed = JSON.parse(raw) as { error?: string };
    if (parsed && typeof parsed.error === 'string') {
      extracted = parsed.error;
    }
  } catch {
    // Plain error string
  }
  if (extracted.toLowerCase().includes('quota')) {
    return 'Quota gratuit Firestore atteint pour aujourd’hui : il sera réinitialisé automatiquement demain.';
  }
  return extracted;
}

export function isOfflineFirestoreError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return true;
  }
  const msg = extractFirestoreErrorReason(err).toLowerCase();
  return (
    msg.includes('offline') ||
    msg.includes('unavailable') ||
    msg.includes('network') ||
    msg.includes('failed to fetch')
  );
}

function getCleanUserFields(user: User) {
  const rawEmail = user.email || user.providerData?.find((p) => p.email)?.email || '';
  const cleanEmail = rawEmail.trim().slice(0, 254);
  if (cleanEmail.length < 3) {
    throw new Error('Adresse e-mail Google introuvable sur ce compte.');
  }
  const cleanName = (user.displayName || cleanEmail.split('@')[0] || 'Utilisateur')
    .trim()
    .slice(0, 120);
  const deviceHint = detectDeviceHint().slice(0, 120);
  return { cleanEmail, cleanName: cleanName || 'Utilisateur', deviceHint };
}

/**
 * Ultra-lightweight startup check (1 single getDocFromServer read, zero onSnapshot listeners).
 * Returns null if the user has no access record yet (will be prompted for personal code).
 */
export async function checkOwnAccessRecord(user: User): Promise<AccessUserRecord | null> {
  const path = `access_users/${user.uid}`;
  let snap;
  try {
    snap = await getDocFromServer(doc(db, 'access_users', user.uid));
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }

  if (!snap.exists()) {
    clearCachedApproval();
    return null;
  }

  const rec = snap.data() as AccessUserRecord;
  saveCachedApproval({
    uid: rec.uid,
    email: rec.email,
    role: rec.role,
    status: rec.status,
  });

  // Update device metadata only if it actually changed
  const { cleanName, deviceHint } = getCleanUserFields(user);
  if (rec.displayName !== cleanName || rec.deviceHint !== deviceHint) {
    try {
      await updateDoc(doc(db, 'access_users', user.uid), {
        displayName: cleanName,
        deviceHint,
        updatedAt: serverTimestamp(),
      });
    } catch {
      // Non-critical metadata update
    }
  }

  return rec;
}

/**
 * Verifies the colleague's Google email + personal code configured by Admin in `preauthorized_emails`
 * and activates `access_users/{uid}` as approved.
 */
export async function verifyPersonalCodeAndActivate(
  user: User,
  enteredCode: string
): Promise<AccessUserRecord> {
  const { cleanEmail, cleanName, deviceHint } = getCleanUserFields(user);
  const preauthId = emailToSafeDocId(cleanEmail);
  if (preauthId.length < 3) {
    throw new Error('Adresse e-mail invalide.');
  }

  const preauthPath = `preauthorized_emails/${preauthId}`;
  let preauthSnap;
  try {
    preauthSnap = await getDocFromServer(doc(db, 'preauthorized_emails', preauthId));
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, preauthPath);
  }

  if (!preauthSnap.exists()) {
    throw new Error(
      `L’adresse « ${cleanEmail} » n’a pas encore été ajoutée par Fabien Pirquin.`
    );
  }

  const preauth = preauthSnap.data() as PreauthorizedEmailRecord;
  if (preauth.email?.trim().toLowerCase() !== cleanEmail.toLowerCase()) {
    throw new Error(`L’adresse « ${cleanEmail} » ne correspond pas à cet accès.`);
  }

  const expectedCode = (preauth.accessCode || '').trim();
  if (expectedCode) {
    const cleanInput = enteredCode.trim();
    if (!cleanInput) {
      throw new Error('Saisissez le code personnel fourni par Fabien Pirquin.');
    }
    if (cleanInput.toLowerCase() !== expectedCode.toLowerCase()) {
      throw new Error('Code personnel incorrect. Vérifiez auprès de Fabien Pirquin.');
    }
  }

  const userPath = `access_users/${user.uid}`;
  let existingSnap;
  try {
    existingSnap = await getDocFromServer(doc(db, 'access_users', user.uid));
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, userPath);
  }

  if (!existingSnap.exists()) {
    try {
      await setDoc(doc(db, 'access_users', user.uid), {
        uid: user.uid,
        email: cleanEmail,
        displayName: cleanName,
        role: 'user',
        status: 'approved',
        deviceHint,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, userPath);
    }
  } else {
    const existing = existingSnap.data() as AccessUserRecord;
    if (existing.status === 'revoked') {
      throw new Error(
        'Votre accès a été suspendu par l’administrateur. Demandez-lui de le réactiver.'
      );
    }
    if (existing.status === 'pending') {
      try {
        await updateDoc(doc(db, 'access_users', user.uid), {
          status: 'approved',
          displayName: cleanName,
          deviceHint,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, userPath);
      }
    }
  }

  const finalRecord: AccessUserRecord = {
    uid: user.uid,
    email: cleanEmail,
    displayName: cleanName,
    role: 'user',
    status: 'approved',
    deviceHint,
  };
  saveCachedApproval(finalRecord);
  return finalRecord;
}

/**
 * Optional fallback: allows a colleague without a code to register a pending access request.
 */
export async function submitPendingAccessRequest(user: User): Promise<AccessUserRecord> {
  const { cleanEmail, cleanName, deviceHint } = getCleanUserFields(user);
  const path = `access_users/${user.uid}`;

  let existingSnap;
  try {
    existingSnap = await getDocFromServer(doc(db, 'access_users', user.uid));
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }

  if (existingSnap.exists()) {
    const existing = existingSnap.data() as AccessUserRecord;
    saveCachedApproval(existing);
    return existing;
  }

  try {
    await setDoc(doc(db, 'access_users', user.uid), {
      uid: user.uid,
      email: cleanEmail,
      displayName: cleanName,
      role: 'user',
      status: 'pending',
      deviceHint,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }

  return {
    uid: user.uid,
    email: cleanEmail,
    displayName: cleanName,
    role: 'user',
    status: 'pending',
    deviceHint,
  };
}

/**
 * One-shot admin fetch (no background onSnapshot listeners).
 */
export async function fetchAdminAccessData(): Promise<{
  users: AccessUserRecord[];
  preauthEmails: PreauthorizedEmailRecord[];
}> {
  let usersSnap;
  try {
    usersSnap = await getDocsFromServer(collection(db, 'access_users'));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'access_users');
  }

  let preauthSnap;
  try {
    preauthSnap = await getDocsFromServer(collection(db, 'preauthorized_emails'));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'preauthorized_emails');
  }

  const users = usersSnap.docs.map((d) => d.data() as AccessUserRecord);
  const orderRank: Record<AccessStatus, number> = {
    pending: 0,
    approved: 1,
    revoked: 2,
  };
  users.sort((a, b) => {
    if (a.role === 'admin' && b.role !== 'admin') return -1;
    if (b.role === 'admin' && a.role !== 'admin') return 1;
    const rankDiff = (orderRank[a.status] ?? 9) - (orderRank[b.status] ?? 9);
    if (rankDiff !== 0) return rankDiff;
    return a.displayName.localeCompare(b.displayName, 'fr', { sensitivity: 'base' });
  });

  const preauthEmails = preauthSnap.docs.map((d) => d.data() as PreauthorizedEmailRecord);
  preauthEmails.sort((a, b) => a.email.localeCompare(b.email, 'fr', { sensitivity: 'base' }));

  return { users, preauthEmails };
}

export async function adminUpdateUserStatus(
  uid: string,
  status: AccessStatus,
  note?: string
): Promise<void> {
  const path = `access_users/${uid}`;
  const payload: Record<string, unknown> = {
    status,
    updatedAt: serverTimestamp(),
  };
  if (typeof note === 'string') {
    payload.note = note.trim().slice(0, 200);
  }
  try {
    await updateDoc(doc(db, 'access_users', uid), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function adminDeleteAccessUser(uid: string): Promise<void> {
  const path = `access_users/${uid}`;
  try {
    await deleteDoc(doc(db, 'access_users', uid));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function adminSaveAuthorizedEmailCode(
  email: string,
  accessCode: string,
  note: string,
  adminUid: string
): Promise<PreauthorizedEmailRecord> {
  const cleanEmail = email.trim().toLowerCase().slice(0, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || cleanEmail.length < 3) {
    throw new Error('Adresse e-mail invalide.');
  }

  const cleanCode = accessCode.trim().slice(0, 32);
  if (cleanCode.length < 3) {
    throw new Error('Le code personnel doit contenir au moins 3 caractères.');
  }

  const emailId = emailToSafeDocId(cleanEmail);
  if (emailId.length < 3) {
    throw new Error('Adresse e-mail invalide.');
  }

  const path = `preauthorized_emails/${emailId}`;
  const cleanNote = note.trim().slice(0, 200);

  let existingSnap;
  try {
    existingSnap = await getDocFromServer(doc(db, 'preauthorized_emails', emailId));
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }

  if (existingSnap.exists()) {
    const updatePayload: Record<string, unknown> = {
      accessCode: cleanCode,
      note: cleanNote,
    };
    try {
      await updateDoc(doc(db, 'preauthorized_emails', emailId), updatePayload);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  } else {
    const payload: Record<string, unknown> = {
      id: emailId,
      email: cleanEmail,
      accessCode: cleanCode,
      createdBy: adminUid,
      createdAt: serverTimestamp(),
    };
    if (cleanNote) {
      payload.note = cleanNote;
    }
    try {
      await setDoc(doc(db, 'preauthorized_emails', emailId), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  }

  return {
    id: emailId,
    email: cleanEmail,
    accessCode: cleanCode,
    ...(cleanNote ? { note: cleanNote } : {}),
    createdBy: adminUid,
  };
}

export async function adminDeleteAuthorizedEmailAndUsers(
  item: PreauthorizedEmailRecord,
  matchingUsers: AccessUserRecord[]
): Promise<void> {
  const path = `preauthorized_emails/${item.id}`;
  try {
    await deleteDoc(doc(db, 'preauthorized_emails', item.id));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }

  for (const u of matchingUsers) {
    if (u.role === 'admin') continue;
    await adminDeleteAccessUser(u.uid);
  }
}
