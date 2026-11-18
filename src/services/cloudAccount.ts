import { getApps, initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword, getAuth, onAuthStateChanged, sendEmailVerification,
  sendPasswordResetEmail, signInWithEmailAndPassword, signOut, type User,
} from 'firebase/auth';
import config from '../../cloud-firebase-config.json';
import { MAX_CLOUD_BYTES, parseCloudPayload } from '../core/cloudSync';

const app = getApps().find((a) => a.name === 'bukuku-cloud') ?? initializeApp(config, 'bukuku-cloud');
export const cloudAuth = getAuth(app);
cloudAuth.languageCode = 'id';
export { onAuthStateChanged, type User };

export async function loginAccount(email: string, password: string, register: boolean) {
  if (register) {
    const result = await createUserWithEmailAndPassword(cloudAuth, email.trim(), password);
    await sendEmailVerification(result.user);
  } else {
    await signInWithEmailAndPassword(cloudAuth, email.trim(), password);
  }
}

export async function verifyAccount() {
  const user = cloudAuth.currentUser;
  if (!user) throw new Error('Masuk terlebih dahulu.');
  await user.reload();
  await user.getIdToken(true);
  if (!user.emailVerified) throw new Error('Email belum terverifikasi. Buka tautan di kotak masuk atau spam.');
}

export async function resendVerification() {
  if (cloudAuth.currentUser) await sendEmailVerification(cloudAuth.currentUser);
}

export const resetAccountPassword = (email: string) => sendPasswordResetEmail(cloudAuth, email.trim());
export const logoutAccount = () => signOut(cloudAuth);

export interface CloudBook {
  version: 1;
  revision: number;
  payload: string;
}

export class CloudConflict extends Error {
  constructor() { super('Buku akun berubah saat disimpan. Periksa konflik sebelum mencoba lagi.'); }
}

async function firestore() {
  const sdk = await import('firebase/firestore');
  return { ...sdk, db: sdk.getFirestore(app) };
}

function bookData(raw: unknown): CloudBook {
  const data = raw as CloudBook;
  if (!data || data.version !== 1 || !Number.isSafeInteger(data.revision) ||
      data.revision < 1 || typeof data.payload !== 'string') {
    throw new Error('Format buku cloud tidak dikenali. Data perangkat tidak diubah.');
  }
  parseCloudPayload(data.payload);
  return { version: 1, revision: data.revision, payload: data.payload };
}

export async function readCloudBook(uid: string): Promise<CloudBook | null> {
  const sdk = await firestore();
  const snapshot = await sdk.getDocFromServer(sdk.doc(sdk.db, 'bukukuUsers', uid, 'books', 'main'));
  return snapshot.exists() ? bookData(snapshot.data()) : null;
}

export async function writeCloudBook(uid: string, expectedRevision: number, payload: string): Promise<CloudBook> {
  if (new TextEncoder().encode(payload).byteLength > MAX_CLOUD_BYTES) {
    throw new Error('Buku melebihi batas sinkronisasi 850 KB. Data lokal tetap tersimpan; gunakan backup JSON.');
  }
  parseCloudPayload(payload);
  const sdk = await firestore();
  const ref = sdk.doc(sdk.db, 'bukukuUsers', uid, 'books', 'main');
  const next: CloudBook = { version: 1, revision: expectedRevision + 1, payload };
  await sdk.runTransaction(sdk.db, async (transaction) => {
    if (cloudAuth.currentUser?.uid !== uid || !cloudAuth.currentUser.emailVerified) {
      throw new Error('Akun berubah atau email belum diverifikasi. Sinkronisasi dihentikan.');
    }
    const snapshot = await transaction.get(ref);
    const revision = snapshot.exists() ? bookData(snapshot.data()).revision : 0;
    if (revision !== expectedRevision) throw new CloudConflict();
    transaction.set(ref, { ...next, updatedAt: sdk.serverTimestamp() });
  });
  return next;
}

export async function watchCloudBook(uid: string, changed: () => void, error: (err: Error) => void) {
  const sdk = await firestore();
  return sdk.onSnapshot(sdk.doc(sdk.db, 'bukukuUsers', uid, 'books', 'main'), (snapshot) => {
    if (!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites) changed();
  }, error);
}

export function cloudError(error: unknown): string {
  const code = (error as { code?: string })?.code;
  switch (code) {
    case 'auth/invalid-credential': return 'Email atau kata sandi tidak cocok.';
    case 'auth/email-already-in-use': return 'Email sudah terdaftar. Silakan masuk atau atur ulang kata sandi.';
    case 'auth/invalid-email': return 'Alamat email tidak valid.';
    case 'auth/weak-password': return 'Gunakan kata sandi minimal 12 karakter.';
    case 'auth/too-many-requests': return 'Terlalu banyak percobaan. Tunggu beberapa saat lalu coba lagi.';
    case 'auth/network-request-failed':
    case 'unavailable': return 'Tidak dapat terhubung. Catatan tetap lokal; coba lagi saat internet tersedia.';
    case 'permission-denied': return 'Akses cloud ditolak. Verifikasi email dan pastikan aturan keamanan Firebase sudah aktif.';
    case 'auth/operation-not-allowed': return 'Login email belum diaktifkan oleh pengelola aplikasi.';
    case 'resource-exhausted': return 'Kuota cloud sedang penuh. Catatan tetap tersimpan di perangkat.';
    default: return error instanceof Error ? error.message : 'Sinkronisasi gagal. Catatan perangkat tidak dihapus.';
  }
}
