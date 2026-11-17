import { useCallback, useEffect, useState } from 'react';
import { Delete, Lock } from 'lucide-react';
import { hashPin } from '../services/storage';

interface PinLockOverlayProps {
  expectedHash: string;
  onUnlock: () => void;
}

export function PinLockOverlay({ expectedHash, onUnlock }: PinLockOverlayProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const handleDigit = useCallback(
    async (d: string) => {
      setError('');
      if (pin.length >= 6) return;
      const next = pin + d;
      setPin(next);
      if (next.length >= 4) {
        const h = await hashPin(next);
        if (h === expectedHash) {
          onUnlock();
        } else if (next.length === 6) {
          setError('PIN salah. Coba lagi.');
          setPin('');
        }
      }
    },
    [pin, expectedHash, onUnlock],
  );

  const handleBackspace = useCallback(() => {
    setError('');
    setPin((prev) => prev.slice(0, -1));
  }, []);

  const handleVerify = useCallback(async () => {
    if (pin.length < 4) {
      setError('Masukkan minimal 4 digit PIN.');
      return;
    }
    const h = await hashPin(pin);
    if (h === expectedHash) {
      onUnlock();
    } else {
      setError('PIN tidak cocok.');
      setPin('');
    }
  }, [pin, expectedHash, onUnlock]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        void handleDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        void handleVerify();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setPin('');
        setError('');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleDigit, handleBackspace, handleVerify]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#F8F7F4] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pin-lock-title"
    >
      <div className="w-full max-w-sm rounded-xl border border-[#D6D3CB] bg-white p-6 sm:p-7 shadow-lg text-center space-y-5">
        <div className="mx-auto w-12 h-12 rounded-full bg-[#14532D]/10 text-[#14532D] flex items-center justify-center">
          <Lock className="w-6 h-6" />
        </div>
        <div>
          <h1 id="pin-lock-title" className="font-serif text-xl font-bold text-[#18181B]">
            BukuKu Terkunci
          </h1>
          <p className="text-xs text-[#57534E] mt-1">
            Masukkan PIN keamanan untuk membuka catatan keuangan Anda.
          </p>
        </div>

        <div className="flex items-center justify-center gap-2 py-2" aria-label={`Panjang PIN ${pin.length} digit`}>
          {[0, 1, 2, 3, 4, 5].map((idx) => (
            <span
              key={idx}
              className={`w-3 h-3 rounded-full border ${
                idx < pin.length
                  ? 'bg-[#14532D] border-[#14532D]'
                  : 'border-[#D6D3CB] bg-[#F8F7F4]'
              }`}
            />
          ))}
        </div>

        {error && (
          <p role="alert" className="text-xs font-medium text-[#B91C1C]">
            {error}
          </p>
        )}

        <div className="grid grid-cols-3 gap-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => void handleDigit(d)}
              className="h-12 rounded-lg border border-[#E5E2DC] bg-[#F8F7F4] font-mono text-lg font-semibold hover:bg-[#EFECE5]"
            >
              {d}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setPin('');
              setError('');
            }}
            className="h-12 rounded-lg border border-[#E5E2DC] bg-[#F8F7F4] text-xs font-semibold text-[#57534E] hover:bg-[#EFECE5]"
          >
            Ulang
          </button>
          <button
            type="button"
            onClick={() => void handleDigit('0')}
            className="h-12 rounded-lg border border-[#E5E2DC] bg-[#F8F7F4] font-mono text-lg font-semibold hover:bg-[#EFECE5]"
          >
            0
          </button>
          <button
            type="button"
            onClick={handleBackspace}
            aria-label="Hapus satu digit PIN"
            className="h-12 rounded-lg border border-[#E5E2DC] bg-[#F8F7F4] flex items-center justify-center text-[#18181B] hover:bg-[#EFECE5]"
          >
            <Delete className="w-5 h-5" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => void handleVerify()}
          className="w-full h-12 rounded-lg bg-[#14532D] text-xs font-semibold text-white hover:bg-[#166534]"
        >
          Buka Kunci
        </button>
      </div>
    </div>
  );
}
