import { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  onSnapshot,
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
  try {
    const parsed = JSON.parse(raw) as { error?: string };
    if (parsed && typeof parsed.error === 'string') {
      return parsed.error;
    }
  } catch {
    // Plain error string
  }
  return raw;
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

export async function ensureAccessUserDocument(user: User): Promise<void> {
  const path = `access_users/${user.uid}`;
  const isRootAdmin = isAdminEmail(user.email, user.emailVerified);
  const rawEmail = user.email || user.providerData?.find((p) => p.email)?.email || '';
  const cleanEmail = rawEmail.trim().slice(0, 254);
  if (cleanEmail.length < 3) {
    throw new Error('Adresse e-mail Google introuvable sur ce compte.');
  }
  const cleanName = (user.displayName || cleanEmail.split('@')[0] || 'Utilisateur')
    .trim()
    .slice(0, 120);
  const deviceHint = detectDeviceHint().slice(0, 120);

  let initialStatus: AccessStatus = isRootAdmin ? 'approved' : 'pending';

  if (!isRootAdmin) {
    const preauthId = emailToSafeDocId(cleanEmail);
    if (preauthId.length >= 3) {
      try {
        const preauthSnap = await getDocFromServer(doc(db, 'preauthorized_emails', preauthId));
        if (preauthSnap.exists()) {
          const preauthData = preauthSnap.data() as PreauthorizedEmailRecord;
          if (preauthData.email?.trim().toLowerCase() === cleanEmail.toLowerCase()) {
            initialStatus = 'approved';
          }
        }
      } catch {
        // Not preauthorized or offline; continue with pending status
      }
    }
  }

  try {
    await setDoc(doc(db, 'access_users', user.uid), {
      uid: user.uid,
      email: cleanEmail,
      displayName: cleanName || 'Utilisateur',
      role: isRootAdmin ? 'admin' : 'user',
      status: initialStatus,
      deviceHint,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function fetchOrCreateOwnAccessRecord(user: User): Promise<AccessUserRecord | null> {
  const path = `access_users/${user.uid}`;
  let snap;
  try {
    snap = await getDocFromServer(doc(db, 'access_users', user.uid));
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }

  if (!snap.exists()) {
    await ensureAccessUserDocument(user);
    try {
      snap = await getDocFromServer(doc(db, 'access_users', user.uid));
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, path);
    }
  }

  if (!snap.exists()) return null;
  const rec = snap.data() as AccessUserRecord;
  saveCachedApproval({
    uid: rec.uid,
    email: rec.email,
    role: rec.role,
    status: rec.status,
  });
  return rec;
}

export async function refreshOwnDeviceMetadata(user: User): Promise<void> {
  const cleanName = (user.displayName || user.email?.split('@')[0] || 'Utilisateur')
    .trim()
    .slice(0, 120);
  const deviceHint = detectDeviceHint().slice(0, 120);

  try {
    await updateDoc(doc(db, 'access_users', user.uid), {
      displayName: cleanName || 'Utilisateur',
      deviceHint,
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Non-critical metadata refresh; ignore when offline
  }
}

export function subscribeToOwnAccessRecord(
  user: User,
  onRecord: (record: AccessUserRecord | null) => void,
  onError: (err: Error) => void
): () => void {
  const path = `access_users/${user.uid}`;
  let creating = false;

  return onSnapshot(
    doc(db, 'access_users', user.uid),
    (snapshot) => {
      if (!snapshot.exists()) {
        onRecord(null);
        if (!creating && navigator.onLine) {
          creating = true;
          void ensureAccessUserDocument(user)
            .catch((e) => {
              onError(e instanceof Error ? e : new Error(String(e)));
            })
            .finally(() => {
              creating = false;
            });
        }
        return;
      }

      const data = snapshot.data() as AccessUserRecord;
      saveCachedApproval({
        uid: data.uid,
        email: data.email,
        role: data.role,
        status: data.status,
      });
      onRecord(data);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribeToAllAccessUsers(
  onUsers: (users: AccessUserRecord[]) => void,
  onError: (err: Error) => void
): () => void {
  const path = 'access_users';
  return onSnapshot(
    collection(db, 'access_users'),
    (snapshot) => {
      const list: AccessUserRecord[] = snapshot.docs.map((d) => d.data() as AccessUserRecord);
      const orderRank: Record<AccessStatus, number> = {
        pending: 0,
        approved: 1,
        revoked: 2,
      };
      list.sort((a, b) => {
        if (a.role === 'admin' && b.role !== 'admin') return -1;
        if (b.role === 'admin' && a.role !== 'admin') return 1;
        const rankDiff = (orderRank[a.status] ?? 9) - (orderRank[b.status] ?? 9);
        if (rankDiff !== 0) return rankDiff;
        return a.displayName.localeCompare(b.displayName, 'fr', { sensitivity: 'base' });
      });
      onUsers(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
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

export function subscribeToPreauthorizedEmails(
  onList: (items: PreauthorizedEmailRecord[]) => void,
  onError: (err: Error) => void
): () => void {
  const path = 'preauthorized_emails';
  return onSnapshot(
    collection(db, 'preauthorized_emails'),
    (snapshot) => {
      const list = snapshot.docs.map((d) => d.data() as PreauthorizedEmailRecord);
      list.sort((a, b) => a.email.localeCompare(b.email, 'fr', { sensitivity: 'base' }));
      onList(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function adminAddPreauthorizedEmail(
  email: string,
  note: string,
  adminUid: string
): Promise<string> {
  const cleanEmail = email.trim().toLowerCase().slice(0, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || cleanEmail.length < 3) {
    throw new Error('Adresse e-mail invalide.');
  }
  const emailId = emailToSafeDocId(cleanEmail);
  if (emailId.length < 3) {
    throw new Error('Adresse e-mail invalide.');
  }
  const path = `preauthorized_emails/${emailId}`;
  const cleanNote = note.trim().slice(0, 200);
  const payload: Record<string, unknown> = {
    id: emailId,
    email: cleanEmail,
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
  return emailId;
}

export async function adminRemovePreauthorizedEmail(emailId: string): Promise<void> {
  const path = `preauthorized_emails/${emailId}`;
  try {
    await deleteDoc(doc(db, 'preauthorized_emails', emailId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}
