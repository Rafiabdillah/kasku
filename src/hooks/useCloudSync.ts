import { useEffect, useRef, useState } from 'react';
import type { LedgerDatabase } from '../core/types';
import { cloudPayload, parseCloudPayload, payloadHash, receiveCloud, syncDecision } from '../core/cloudSync';
import {
  CloudConflict, cloudAuth, cloudError, onAuthStateChanged, readCloudBook, watchCloudBook, writeCloudBook,
  type CloudBook, type User,
} from '../services/cloudAccount';
import { saveCloudRecovery } from '../services/storage';

type SyncStatus = 'local' | 'pending' | 'checking' | 'synced' | 'offline' | 'conflict' | 'error';
type Choice = 'inspect' | 'upload' | 'download' | 'local' | 'remote';

export function useCloudSync(
  db: LedgerDatabase | null,
  enabled: boolean,
  getCurrent: () => LedgerDatabase | null,
  apply: (next: LedgerDatabase) => void,
) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [status, setStatus] = useState<SyncStatus>('local');
  const [error, setError] = useState('');
  const [offer, setOffer] = useState<CloudBook | null | undefined>(undefined);
  const [online, setOnline] = useState(navigator.onLine);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const rerunRef = useRef(false);
  const epoch = useRef(0);
  const conflictRevision = useRef<number | null>(null);
  const latest = useRef({ enabled, getCurrent, apply });
  latest.current = { enabled, getCurrent, apply };

  useEffect(() => onAuthStateChanged(cloudAuth, (next) => {
    epoch.current++;
    setUser(next);
    setAuthReady(true);
    setOffer(undefined);
    setStatus('local');
    setError('');
  }), []);

  useEffect(() => {
    const active = () => { setOnline(navigator.onLine); setRefresh((n) => n + 1); };
    const visibility = () => { if (document.visibilityState === 'visible') active(); };
    window.addEventListener('online', active);
    window.addEventListener('offline', active);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('online', active);
      window.removeEventListener('offline', active);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);

  const run = async (choice?: Choice) => {
    if (!latest.current.enabled) return;
    if (busyRef.current) {
      if (!choice) rerunRef.current = true;
      return;
    }
    const account = cloudAuth.currentUser;
    const initial = latest.current.getCurrent();
    if (!account || !account.emailVerified || !initial) return;
    const link = initial.cloudLink;
    if (link && link.uid !== account.uid) {
      setStatus('error');
      setError('Buku perangkat tertaut ke akun lain. Masuk dengan akun semula atau putuskan tautan secara manual.');
      return;
    }
    if (!link && !choice) return;
    if (!navigator.onLine) { setStatus('offline'); return; }
    const started = epoch.current;
    const valid = () => started === epoch.current && latest.current.enabled && cloudAuth.currentUser?.uid === account.uid;
    busyRef.current = true;
    setBusy(true);
    setStatus('checking');
    setError('');
    try {
      const remote = await readCloudBook(account.uid);
      if (!valid()) return;
      if ((choice === 'local' || choice === 'remote') && remote?.revision !== conflictRevision.current) {
        conflictRevision.current = remote?.revision ?? null;
        setStatus('conflict');
        setError('Buku akun berubah lagi. Tinjau dan konfirmasi ulang pilihan versi.');
        return;
      }
      if (!link && (choice === 'inspect' || (choice === 'upload' && remote))) {
        setOffer(remote);
        setStatus('local');
        return;
      }
      if (latest.current.getCurrent() !== initial) { setRefresh((n) => n + 1); return; }
      const payload = cloudPayload(initial);
      const hash = await payloadHash(payload);
      const remoteHash = remote ? await payloadHash(remote.payload) : '';
      if (!valid() || latest.current.getCurrent() !== initial) { setRefresh((n) => n + 1); return; }
      if (link && !remote) throw new Error('Buku akun tidak ditemukan. Sinkronisasi dihentikan; buku lokal tetap utuh.');
      let action = link && remote ? syncDecision(link, hash, remoteHash, remote.revision) : 'push';
      if (choice === 'download' || choice === 'remote') action = 'pull';
      if (choice === 'local') action = 'push';
      if (action === 'conflict') { conflictRevision.current = remote!.revision; setStatus('conflict'); return; }
      if (action === 'pull') {
        if (!remote) throw new Error('Belum ada buku di akun ini.');
        await saveCloudRecovery(initial);
        if (!valid() || latest.current.getCurrent() !== initial) {
          throw new Error('Buku perangkat berubah. Periksa kembali sebelum mengambil buku akun.');
        }
        latest.current.apply(receiveCloud(initial, parseCloudPayload(remote.payload), {
          uid: account.uid, revision: remote.revision, baselineHash: remoteHash, lastSyncedAt: new Date().toISOString(),
        }));
      } else if (action === 'equal') {
        if (link?.revision !== remote!.revision || link.baselineHash !== hash) {
          latest.current.apply({ ...initial, cloudLink: {
            uid: account.uid, revision: remote!.revision, baselineHash: hash, lastSyncedAt: new Date().toISOString(),
          } });
        }
      } else {
        if (choice === 'local' && remote) {
          await saveCloudRecovery(receiveCloud(initial, parseCloudPayload(remote.payload), link!));
        }
        if (!valid()) return;
        const saved = await writeCloudBook(account.uid, remote?.revision ?? 0, payload);
        if (!valid()) return;
        const current = latest.current.getCurrent();
        if (!current || current.cloudLink?.uid !== link?.uid || current.cloudLink?.revision !== link?.revision) return;
        latest.current.apply({ ...current, cloudLink: {
          uid: account.uid, revision: saved.revision, baselineHash: hash, lastSyncedAt: new Date().toISOString(),
        } });
      }
      setOffer(undefined);
      setStatus('synced');
    } catch (err) {
      if (valid()) {
        setStatus('error'); setError(cloudError(err));
        if (err instanceof CloudConflict) setRefresh((n) => n + 1);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
      if (rerunRef.current) {
        rerunRef.current = false;
        setRefresh((n) => n + 1);
      }
    }
  };
  const runRef = useRef(run);
  runRef.current = run;

  const uid = user?.uid;
  const verified = user?.emailVerified;
  const linkedUid = db?.cloudLink?.uid;
  useEffect(() => {
    if (!enabled || !uid || !verified || linkedUid !== uid || !online) return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void watchCloudBook(uid, () => setRefresh((n) => n + 1), (err) => {
      if (!disposed) { setStatus('error'); setError(cloudError(err)); }
    }).then((stop) => { if (disposed) stop(); else unsubscribe = stop; }).catch((err) => {
      if (!disposed) { setStatus('error'); setError(cloudError(err)); }
    });
    return () => { disposed = true; unsubscribe?.(); };
  }, [uid, verified, linkedUid, enabled, online]);

  useEffect(() => {
    if (!enabled || !uid || !verified || !linkedUid) return;
    if (!online) { setStatus('offline'); return; }
    setStatus((current) => current === 'synced' ? 'pending' : current);
    const timer = window.setTimeout(() => void runRef.current(), 1000);
    return () => window.clearTimeout(timer);
  }, [db, uid, verified, linkedUid, enabled, online, refresh]);

  return {
    user, authReady, status: !online && linkedUid ? 'offline' as const : status,
    error, offer, busy,
    syncNow: () => run(), inspect: () => run('inspect'),
    upload: () => run('upload'), download: () => run('download'),
    resolve: (choice: 'local' | 'remote') => run(choice),
    refreshAuth: () => { setUser(cloudAuth.currentUser); setRefresh((n) => n + 1); },
    disconnect: () => {
      epoch.current++;
      const current = latest.current.getCurrent();
      if (current) latest.current.apply({ ...current, cloudLink: undefined });
      setStatus('local'); setError(''); setOffer(undefined);
    },
  };
}

export type CloudSyncState = ReturnType<typeof useCloudSync>;
