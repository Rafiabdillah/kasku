import { useEffect, useState } from 'react';
import { Download, Smartphone, WifiOff, X } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_swUrl, reg) {
      setRegistration(reg ?? null);
    },
  });

  useEffect(() => {
    if (!registration) return;

    const checkForUpdate = () => {
      if (document.visibilityState === 'visible') void registration.update();
    };
    const interval = window.setInterval(checkForUpdate, 60 * 60 * 1000);
    document.addEventListener('visibilitychange', checkForUpdate);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', checkForUpdate);
    };
  }, [registration]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  if (isOnline && !needRefresh) return null;

  return (
    <div className="no-print space-y-2">
      {!isOnline && (
        <div
          role="status"
          className="bg-[#FFFBEB] border-b border-[#FDE68A] px-4 py-2 text-xs font-medium text-[#92400E]"
        >
          <div className="max-w-7xl mx-auto flex items-center justify-center gap-2">
            <WifiOff className="w-3.5 h-3.5 shrink-0" />
            <span>Mode Offline aktif — seluruh catatan tetap tersimpan lokal di perangkat Anda.</span>
          </div>
        </div>
      )}

      {needRefresh && (
        <div
          role="status"
          className="bg-[#F0FDF4] border-b border-[#BBF7D0] px-4 py-2 text-xs font-medium text-[#14532D]"
        >
          <div className="max-w-7xl mx-auto flex items-center justify-center gap-3 flex-wrap">
            <span>Pembaruan aplikasi BukuKu siap digunakan.</span>
            <button
              type="button"
              onClick={() => updateServiceWorker(true)}
              className="rounded-md bg-[#14532D] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#166534]"
            >
              Muat Ulang
            </button>
            <button
              type="button"
              onClick={() => setNeedRefresh(false)}
              className="text-[#57534E] hover:text-[#18181B]"
            >
              Nanti
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function PWAInstallCard() {
  const { canInstall, isInstalled, isIOS, promptInstall } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  return (
    <div className="rounded-xl border border-[#E5E2DC] bg-white p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Smartphone className="w-5 h-5 text-[#14532D] mt-0.5 shrink-0" />
          <div>
            <h2 className="font-serif text-lg font-bold text-[#18181B]">
              Pasang Aplikasi Offline (PWA)
            </h2>
            <p className="text-xs text-[#57534E] mt-1">
              {isInstalled
                ? 'BukuKu sudah berjalan sebagai aplikasi terpasang dan mendukung akses offline penuh.'
                : 'Pasang BukuKu di layar utama HP atau desktop agar terbuka cepat tanpa browser bar dan tetap jalan tanpa internet.'}
            </p>
          </div>
        </div>
      </div>

      {!isInstalled && (
        <div className="flex flex-wrap items-center gap-3">
          {canInstall ? (
            <button
              type="button"
              onClick={() => void promptInstall()}
              className="inline-flex items-center gap-2 rounded-lg bg-[#14532D] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#166534]"
            >
              <Download className="w-4 h-4" />
              <span>Pasang Aplikasi BukuKu</span>
            </button>
          ) : isIOS ? (
            <button
              type="button"
              onClick={() => setShowIOSGuide(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-[#14532D] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#166534]"
            >
              <Download className="w-4 h-4" />
              <span>Cara Pasang di iPhone / iPad</span>
            </button>
          ) : (
            <p className="text-xs text-[#57534E]">
              Gunakan ikon instalasi di bilah alamat browser (Chrome/Edge) atau menu &ldquo;Tambah ke Layar Utama&rdquo; untuk memasang aplikasi offline.
            </p>
          )}
        </div>
      )}

      {showIOSGuide && (
        <div
          role="dialog"
          aria-modal="true"
          className="rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] p-4 space-y-2 text-xs text-[#18181B]"
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold text-[#14532D]">Panduan Pasang di Safari iOS</span>
            <button
              type="button"
              onClick={() => setShowIOSGuide(false)}
              aria-label="Tutup panduan"
              className="text-[#57534E] hover:text-[#18181B]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <ol className="list-decimal pl-4 space-y-1 text-[#57534E]">
            <li>Ketuk tombol <strong>Bagikan (Share)</strong> di bagian bawah layar Safari.</li>
            <li>Pilih menu <strong>Tambah ke Layar Utama (Add to Home Screen)</strong>.</li>
            <li>Ketuk <strong>Tambah</strong> untuk menggunakan BukuKu secara offline.</li>
          </ol>
        </div>
      )}
    </div>
  );
}
