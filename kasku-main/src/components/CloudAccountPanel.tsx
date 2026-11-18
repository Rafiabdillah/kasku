import { useState } from 'react';
import { Cloud, CloudOff, Mail, RefreshCw, ShieldCheck } from 'lucide-react';
import type { LedgerDatabase } from '../core/types';
import type { CloudSyncState } from '../hooks/useCloudSync';
import {
  cloudError, loginAccount, logoutAccount, resendVerification, resetAccountPassword, verifyAccount,
} from '../services/cloudAccount';
import { downloadCloudRecovery } from '../services/storage';

export function CloudAccountPanel({ sync, db, allowUpload = true }: {
  sync: CloudSyncState; db: LedgerDatabase; allowUpload?: boolean;
}) {
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<'disconnect' | 'local' | 'remote' | 'download' | 'logout' | null>(null);
  const work = async (action: () => Promise<unknown>, success = '') => {
    setBusy(true); setError(''); setMessage('');
    try { await action(); setMessage(success); } catch (err) { setError(cloudError(err)); }
    finally { setBusy(false); }
  };
  const disabled = busy || sync.busy || !sync.authReady;
  const linked = db.cloudLink?.uid === sync.user?.uid && !!db.cloudLink;
  const labels = {
    local: 'Tersimpan di perangkat', pending: 'Menunggu sinkronisasi…', checking: 'Menyinkronkan…', synced: 'Tersinkron ke akun',
    offline: 'Offline · perubahan menunggu internet', conflict: 'Dua versi buku perlu ditinjau', error: 'Sinkronisasi perlu perhatian',
  };
  const primary = 'min-h-12 w-full rounded-xl bg-[#14532D] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50';
  const secondary = 'min-h-12 rounded-xl border border-[#D6D3CB] px-4 py-3 text-sm font-semibold text-[#14532D] disabled:opacity-50';

  return (
    <section className="rounded-2xl border border-[#E5E2DC] bg-white p-5 sm:p-6 space-y-5" aria-labelledby="cloud-account-title">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-[#EAF3EC] p-3 text-[#14532D]"><Cloud className="h-6 w-6" /></div>
        <div className="min-w-0">
          <h2 id="cloud-account-title" className="font-serif text-xl font-bold">Akun & sinkronisasi</h2>
          <p className="mt-1 text-sm text-[#57534E]">Satu buku, di HP dan laptop Anda.</p>
        </div>
      </div>
      <p className="text-sm text-[#57534E]">Masuk dengan email yang sama di setiap perangkat. Data keuangan dikirim ke Firebase hanya setelah Anda menghubungkan buku. PIN dan tautan Google Sheets tetap lokal.</p>
      {(error || sync.error) && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800 break-words">{error || sync.error}</p>}
      {message && <p role="status" className="rounded-xl bg-green-50 p-3 text-sm text-green-800">{message}</p>}
      {!sync.authReady ? <p role="status">Memeriksa akun…</p> : !sync.user ? (
        <form className="space-y-4" onSubmit={(event) => {
          event.preventDefault();
          void work(async () => { await loginAccount(email, password, register); setPassword(''); }, register ? 'Email verifikasi dikirim. Periksa kotak masuk dan spam.' : 'Berhasil masuk. Hubungkan buku untuk mulai sinkronisasi.');
        }}>
          <label className="block text-sm font-medium">Email
            <input className="mt-2 w-full min-h-12 rounded-xl border border-[#D6D3CB] px-3" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="block text-sm font-medium">Kata sandi
            <input className="mt-2 w-full min-h-12 rounded-xl border border-[#D6D3CB] px-3" type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={register ? 12 : undefined} required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {register && <p className="text-xs text-[#57534E]">Minimal 12 karakter. Gunakan kata sandi yang tidak dipakai di layanan lain.</p>}
          <button className={primary} disabled={disabled}>{busy ? 'Mohon tunggu…' : register ? 'Buat akun BukuKu' : 'Masuk ke akun'}</button>
          <div className="flex flex-wrap justify-between gap-2">
            <button type="button" className="min-h-11 text-sm font-semibold text-[#14532D]" disabled={disabled} onClick={() => { setRegister(!register); setError(''); setMessage(''); }}>{register ? 'Sudah punya akun? Masuk' : 'Belum punya akun? Daftar'}</button>
            {!register && <button type="button" className="min-h-11 text-sm text-[#57534E]" disabled={disabled || !email.trim()} onClick={() => void work(() => resetAccountPassword(email), 'Jika email terdaftar, tautan pengaturan ulang dikirim. Periksa kotak masuk dan spam.')}>Lupa kata sandi?</button>}
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl bg-[#F8F7F4] p-4">
            <p className="flex items-center gap-2 font-semibold text-sm break-all"><Mail className="h-4 w-4 shrink-0" />{sync.user.email}</p>
            <p role="status" className="mt-2 text-sm text-[#57534E]">{linked ? labels[sync.status] : 'Akun masuk · buku belum terhubung'}</p>
            {linked && db.cloudLink && <p className="mt-1 text-xs text-[#57534E]">Sinkron terakhir: {new Date(db.cloudLink.lastSyncedAt).toLocaleString('id-ID')}</p>}
          </div>
          {!sync.user.emailVerified ? (
            <div className="space-y-3">
              <p className="text-sm text-[#57534E]">Verifikasi email sebelum mengakses buku cloud. Setelah membuka tautan email, kembali ke sini.</p>
              <button className={primary} disabled={disabled} onClick={() => void work(async () => { await verifyAccount(); sync.refreshAuth(); }, 'Email terverifikasi. Anda dapat menghubungkan buku.')}>Saya sudah verifikasi</button>
              <button className={secondary} disabled={disabled} onClick={() => void work(resendVerification, 'Email verifikasi dikirim ulang.')}>Kirim ulang email</button>
            </div>
          ) : !linked ? (
            db.cloudLink ? <p className="text-sm text-amber-800">Buku ini tertaut ke akun lain. Masuk ke akun semula agar data tidak tercampur.</p> :
            sync.offer === undefined ? <button className={primary} disabled={disabled} onClick={() => void sync.inspect()}>Hubungkan buku ke akun ini</button> :
            sync.offer ? (
              <div className="space-y-3">
                <p className="text-sm">Buku akun ditemukan. Ambil buku tersebut untuk melanjutkan dari perangkat lain. Buku lokal disalin ke pemulihan terlebih dahulu; kedua buku tidak digabung otomatis.</p>
                <button className={primary} disabled={disabled} onClick={() => setConfirm('download')}>Gunakan buku dari akun</button>
              </div>
            ) : allowUpload ? (
              <div className="space-y-3">
                <p className="text-sm">Belum ada buku di akun ini. Unggah buku perangkat ini ({db.journals.length} jurnal), lalu perubahan berikutnya disinkronkan otomatis.</p>
                <button className={primary} disabled={disabled} onClick={() => void sync.upload()}>Setuju, unggah buku ke akun</button>
              </div>
            ) : <p className="text-sm">Belum ada buku di akun ini. Mulai buku kosong di atas, lalu hubungkan dari menu Akun.</p>
          ) : sync.status === 'conflict' ? (
            <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm text-amber-900">Perangkat ini dan perangkat lain mengubah buku sejak sinkron terakhir. Tidak ada versi yang ditimpa otomatis. Versi yang diganti disimpan sebagai salinan pemulihan.</p>
              <button className={primary} disabled={disabled} onClick={() => setConfirm('remote')}>Gunakan versi akun</button>
              <button className={`${secondary} w-full`} disabled={disabled} onClick={() => setConfirm('local')}>Gunakan versi perangkat ini</button>
            </div>
          ) : <button className={`${secondary} w-full flex items-center justify-center gap-2`} disabled={disabled} onClick={() => void sync.syncNow()}><RefreshCw className={`h-4 w-4 ${sync.busy ? 'animate-spin' : ''}`} />Sinkronkan sekarang</button>}
          <div className="flex flex-wrap gap-2">
            {db.cloudLink && <button className={secondary} disabled={disabled} onClick={() => setConfirm('disconnect')}><CloudOff className="mr-2 inline h-4 w-4" />Putuskan tautan</button>}
            <button className={secondary} disabled={disabled} onClick={() => setConfirm('logout')}>Keluar akun</button>
          </div>
        </div>
      )}
      {confirm && <div role="alertdialog" aria-modal="false" aria-labelledby="cloud-confirm-title" className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3">
        <h3 id="cloud-confirm-title" className="font-semibold">{confirm === 'logout' ? 'Keluar dari akun?' : confirm === 'disconnect' ? 'Putuskan sinkronisasi?' : 'Konfirmasi pilihan buku'}</h3>
        <p className="text-sm">{confirm === 'logout' ? 'Sinkronisasi berhenti. Salinan buku tetap di perangkat ini dan bisa dibaca oleh pemakainya. Gunakan PIN jika perangkat dipakai bersama.' : confirm === 'disconnect' ? 'Data akun tidak dihapus. Perubahan berikutnya hanya tersimpan lokal sampai dihubungkan lagi.' : confirm === 'local' ? 'Seluruh buku akun diganti dengan versi perangkat ini. Versi akun sebelumnya disalin ke pemulihan.' : 'Seluruh buku perangkat diganti dengan versi akun. Versi perangkat sebelumnya disalin ke pemulihan.'}</p>
        <div className="flex gap-2">
          <button className={primary} disabled={disabled} onClick={() => {
            const choice = confirm; setConfirm(null);
            if (choice === 'logout') void work(logoutAccount);
            else if (choice === 'disconnect') sync.disconnect();
            else if (choice === 'download') void sync.download();
            else void sync.resolve(choice);
          }}>Ya, lanjutkan</button>
          <button className={secondary} onClick={() => setConfirm(null)}>Batal</button>
        </div>
      </div>}
      <div className="border-t border-[#E5E2DC] pt-4 space-y-2 text-xs text-[#57534E]">
        <p className="flex items-start gap-2"><ShieldCheck className="h-4 w-4 shrink-0" />Buku hanya dapat diakses akun pemilik. Bukan enkripsi end-to-end. Tetap unduh backup berkala; batas buku cloud 850 KB.</p>
        <button className="min-h-11 font-semibold text-[#14532D] text-left" disabled={disabled} onClick={() => void work(downloadCloudRecovery)}>Unduh salinan sebelum pergantian terakhir</button>
      </div>
    </section>
  );
}
