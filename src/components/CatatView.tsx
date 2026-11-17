import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Delete } from 'lucide-react';
import type { Account, TransactionActionType, TransactionInput } from '../core/types';
import { formatRupiahTitle, todayLocalDate } from '../core/format';

interface CatatViewProps {
  accounts: Account[];
  onSaveTransaction: (input: TransactionInput) => void;
  onGoToTransactions: () => void;
}

type CatatTab = 'keluar' | 'masuk' | 'pindah' | 'saldo_awal';

const TAB_LABELS: Array<{ id: CatatTab; label: string }> = [
  { id: 'keluar', label: 'Keluar' },
  { id: 'masuk', label: 'Masuk' },
  { id: 'pindah', label: 'Pindah' },
  { id: 'saldo_awal', label: 'Saldo Awal' },
];

export function CatatView({
  accounts,
  onSaveTransaction,
  onGoToTransactions,
}: CatatViewProps) {
  const activeAccounts = useMemo(() => accounts.filter((a) => a.is_active), [accounts]);
  const wallets = useMemo(
    () =>
      activeAccounts
        .filter((a) => a.is_wallet || ['1101', '1102', '1103'].includes(a.code))
        .sort((a, b) => a.code.localeCompare(b.code)),
    [activeAccounts],
  );

  const incomeCategories = useMemo(
    () =>
      activeAccounts
        .filter((a) => a.type === 'REVENUE' || a.code === '3101')
        .sort((a, b) => a.code.localeCompare(b.code)),
    [activeAccounts],
  );

  const expenseCategories = useMemo(
    () =>
      activeAccounts
        .filter((a) => a.type === 'EXPENSE' || a.code === '1501' || a.code === '3102')
        .sort((a, b) => a.code.localeCompare(b.code)),
    [activeAccounts],
  );

  const assetAccounts = useMemo(
    () =>
      activeAccounts
        .filter((a) => a.type === 'ASSET')
        .sort((a, b) => a.code.localeCompare(b.code)),
    [activeAccounts],
  );

  const [tab, setTab] = useState<CatatTab>('keluar');
  const [amountStr, setAmountStr] = useState<string>('0');
  const [adminFeeStr, setAdminFeeStr] = useState<string>('0');
  const [keypadTarget, setKeypadTarget] = useState<'amount' | 'admin'>('amount');
  const [walletId, setWalletId] = useState<string>(wallets[0]?.id ?? 'acc-1101');
  const [toWalletId, setToWalletId] = useState<string>(wallets[1]?.id ?? wallets[0]?.id ?? 'acc-1102');
  const [categoryId, setCategoryId] = useState<string>(expenseCategories[0]?.id ?? 'acc-5101');
  const [date, setDate] = useState<string>(todayLocalDate());
  const [description, setDescription] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');

  // Keep selected accounts valid if accounts are activated/deactivated in Settings
  useEffect(() => {
    const validWallets = tab === 'saldo_awal' ? assetAccounts : wallets;
    if (validWallets.length > 0 && !validWallets.some((w) => w.id === walletId)) {
      setWalletId(validWallets[0].id);
    }
    if (tab === 'pindah' && wallets.length > 0 && !wallets.some((w) => w.id === toWalletId)) {
      setToWalletId(wallets.find((w) => w.id !== walletId)?.id ?? wallets[0].id);
    }
    if (tab === 'masuk' && incomeCategories.length > 0 && !incomeCategories.some((c) => c.id === categoryId)) {
      setCategoryId(incomeCategories[0].id);
    }
    if (tab === 'keluar' && expenseCategories.length > 0 && !expenseCategories.some((c) => c.id === categoryId)) {
      setCategoryId(expenseCategories[0].id);
    }
  }, [tab, wallets, assetAccounts, incomeCategories, expenseCategories, walletId, toWalletId, categoryId]);

  const amountNum = Number(amountStr) || 0;
  const adminFeeNum = Number(adminFeeStr) || 0;
  const editingAdmin = tab === 'pindah' && keypadTarget === 'admin';

  const handleTabChange = (next: CatatTab) => {
    setTab(next);
    setKeypadTarget('amount');
    setErrorMsg('');
    setSuccessMsg('');
    if (next === 'masuk') {
      setCategoryId(incomeCategories[0]?.id ?? 'acc-4101');
    } else if (next === 'keluar') {
      setCategoryId(expenseCategories[0]?.id ?? 'acc-5101');
    } else if (next === 'pindah') {
      const first = wallets[0]?.id ?? 'acc-1101';
      const second = wallets.find((w) => w.id !== first)?.id ?? first;
      setWalletId(first);
      setToWalletId(second);
    } else if (next === 'saldo_awal') {
      setWalletId(assetAccounts[0]?.id ?? 'acc-1101');
    }
  };

  const appendDigit = (chunk: string) => {
    setErrorMsg('');
    setSuccessMsg('');
    const setter = editingAdmin ? setAdminFeeStr : setAmountStr;
    setter((prev) => {
      const cleaned = prev === '0' ? '' : prev;
      const next = cleaned + chunk;
      if (next.length > 12) return prev;
      return next === '' ? '0' : next.replace(/^0+/, '') || '0';
    });
  };

  const handleBackspace = () => {
    const setter = editingAdmin ? setAdminFeeStr : setAmountStr;
    setter((prev) => {
      if (prev.length <= 1) return '0';
      return prev.slice(0, -1);
    });
  };

  const handleClear = () => {
    if (editingAdmin) setAdminFeeStr('0');
    else setAmountStr('0');
    setErrorMsg('');
  };

  const submitTransaction = (stayAndAddMore: boolean) => {
    setErrorMsg('');
    setSuccessMsg('');

    if (amountNum <= 0 || !Number.isSafeInteger(amountNum)) {
      setErrorMsg('Masukkan nominal rupiah terlebih dahulu (lebih dari 0).');
      return;
    }

    const actionType: TransactionActionType = tab;
    try {
      onSaveTransaction({
        actionType,
        amount: amountNum,
        adminFee: tab === 'pindah' ? adminFeeNum : 0,
        walletId,
        toWalletId: tab === 'pindah' ? toWalletId : undefined,
        categoryAccountId: tab === 'masuk' || tab === 'keluar' ? categoryId : undefined,
        date,
        description: description.trim(),
      });

      setAmountStr('0');
      setAdminFeeStr('0');
      setDescription('');

      if (stayAndAddMore) {
        setSuccessMsg(`Tersimpan (${formatRupiahTitle(amountNum)}). Siap catat transaksi berikutnya.`);
      } else {
        onGoToTransactions();
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menyimpan transaksi.');
    }
  };

  const categoriesToShow = tab === 'masuk' ? incomeCategories : expenseCategories;
  const walletChoices = tab === 'saldo_awal' ? assetAccounts : wallets;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-bold text-[#18181B]">Catat Uang</h1>
          <p className="text-sm text-[#57534E]">
            Pilih jenis transaksi dan nominal — jurnal debit-kredit dicatat otomatis di balik layar.
          </p>
        </div>

        {/* Mode Segmented Switch */}
        <div className="inline-flex max-w-full overflow-x-auto items-center gap-1 rounded-lg bg-[#EBE8E0] p-1 self-start">
          {TAB_LABELS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleTabChange(item.id)}
              className={`min-h-[44px] px-3.5 py-2 text-xs font-semibold rounded-md whitespace-nowrap shrink-0 ${
                tab === item.id
                  ? 'bg-white text-[#14532D] shadow-sm'
                  : 'text-[#57534E] hover:text-[#18181B]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {successMsg && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] px-4 py-3 text-sm font-medium text-[#14532D]"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm font-medium text-[#B91C1C]"
        >
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Nominal Display & Custom Keypad with "000" */}
        <div className="lg:col-span-5 rounded-xl border border-[#E5E2DC] bg-white p-5 space-y-4">
          {tab === 'pindah' && (
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-[#EBE8E0] p-1">
              <button
                type="button"
                onClick={() => setKeypadTarget('amount')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md ${
                  keypadTarget === 'amount'
                    ? 'bg-white text-[#14532D] shadow-sm'
                    : 'text-[#57534E] hover:text-[#18181B]'
                }`}
              >
                Nominal Transfer
              </button>
              <button
                type="button"
                onClick={() => setKeypadTarget('admin')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md ${
                  keypadTarget === 'admin'
                    ? 'bg-white text-[#14532D] shadow-sm'
                    : 'text-[#57534E] hover:text-[#18181B]'
                }`}
              >
                Biaya Admin
              </button>
            </div>
          )}

          <div className="rounded-lg border border-[#E5E2DC] bg-[#F8F7F4] p-4 text-right">
            <p className="text-xs font-medium text-[#57534E]">
              {editingAdmin ? 'Biaya Admin Bank (Rp)' : 'Nominal Rupiah'}
            </p>
            <p
              className="font-mono text-3xl font-semibold text-[#18181B] tabular-nums mt-1 truncate"
              data-testid="catat-nominal-display"
            >
              {formatRupiahTitle(editingAdmin ? adminFeeNum : amountNum)}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0'].map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => appendDigit(key)}
                className="h-12 rounded-lg border border-[#E5E2DC] bg-[#F8F7F4] font-mono text-base font-semibold text-[#18181B] hover:bg-[#EFECE5] active:scale-[0.98] transition-all"
              >
                {key}
              </button>
            ))}
            <button
              type="button"
              onClick={handleBackspace}
              aria-label="Hapus satu digit"
              className="h-12 rounded-lg border border-[#E5E2DC] bg-[#F8F7F4] flex items-center justify-center text-[#18181B] hover:bg-[#EFECE5]"
            >
              <Delete className="w-5 h-5" />
            </button>
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {(editingAdmin ? [2500, 5000, 6500] : [10000, 50000, 100000]).map((quick) => (
                <button
                  key={quick}
                  type="button"
                  onClick={() => {
                    if (editingAdmin) setAdminFeeStr(String(adminFeeNum + quick));
                    else setAmountStr(String(amountNum + quick));
                  }}
                  className="min-h-[40px] rounded-md border border-[#E5E2DC] px-3 py-1.5 font-mono text-xs font-medium text-[#57534E] hover:bg-[#F3F1EB] hover:text-[#18181B]"
                >
                  +{quick >= 1000 && quick % 1000 === 0 ? `${quick / 1000}rb` : quick}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleClear}
              className="min-h-[40px] rounded-md px-3 py-1.5 text-xs font-semibold text-[#B91C1C] hover:bg-[#FEF2F2]"
            >
              Reset
            </button>
          </div>
        </div>

        {/* Right: Wallet, Category, Date & Description */}
        <div className="lg:col-span-7 rounded-xl border border-[#E5E2DC] bg-white p-5 sm:p-6 space-y-5">
          {/* Wallet Selector */}
          <div>
            <p className="text-xs font-semibold text-[#57534E] mb-2">
              {tab === 'pindah'
                ? 'Dari Dompet'
                : tab === 'saldo_awal'
                  ? 'Pilih Akun Aset'
                  : tab === 'masuk'
                    ? 'Masuk ke Dompet'
                    : 'Keluar dari Dompet'}
            </p>
            <div className="flex flex-wrap gap-2">
              {walletChoices.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => setWalletId(w.id)}
                  className={`min-h-[44px] px-3.5 py-2 rounded-lg text-xs font-semibold border whitespace-nowrap shrink-0 ${
                    walletId === w.id
                      ? 'border-[#14532D] bg-[#14532D] text-white'
                      : 'border-[#E5E2DC] bg-[#F8F7F4] text-[#18181B] hover:bg-[#EFECE5]'
                  }`}
                >
                  {w.name}
                </button>
              ))}
            </div>
          </div>

          {/* Destination Wallet & Admin Fee for Transfer */}
          {tab === 'pindah' && (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold text-[#57534E] mb-2">Ke Dompet Tujuan</p>
                <div className="flex flex-wrap gap-2">
                  {wallets.map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => setToWalletId(w.id)}
                      className={`min-h-[44px] px-3.5 py-2 rounded-lg text-xs font-semibold border whitespace-nowrap shrink-0 ${
                        toWalletId === w.id
                          ? 'border-[#14532D] bg-[#14532D] text-white'
                          : 'border-[#E5E2DC] bg-[#F8F7F4] text-[#18181B] hover:bg-[#EFECE5]'
                      }`}
                    >
                      {w.name}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label
                  htmlFor="catat-admin-fee"
                  className="block text-xs font-semibold text-[#57534E] mb-1.5"
                >
                  Biaya Admin Bank (Opsional, Rp)
                </label>
                <input
                  id="catat-admin-fee"
                  type="number"
                  min={0}
                  step={500}
                  value={adminFeeStr}
                  onChange={(e) => setAdminFeeStr(e.target.value)}
                  className="w-full min-h-[44px] rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-3 py-2 font-mono text-sm text-[#18181B] focus:border-[#14532D] focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* Category Selector for Masuk / Keluar */}
          {(tab === 'masuk' || tab === 'keluar') && (
            <div>
              <p className="text-xs font-semibold text-[#57534E] mb-2">
                {tab === 'masuk' ? 'Sumber Pemasukan' : 'Kategori Pengeluaran'}
              </p>
              <div className="flex flex-wrap gap-2">
                {categoriesToShow.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategoryId(cat.id)}
                    className={`min-h-[44px] px-3.5 py-2 rounded-lg text-xs font-semibold border whitespace-nowrap shrink-0 ${
                      categoryId === cat.id
                        ? 'border-[#14532D] bg-[#14532D] text-white'
                        : 'border-[#E5E2DC] bg-[#F8F7F4] text-[#18181B] hover:bg-[#EFECE5]'
                    }`}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Local Calendar Date & Note */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="catat-tanggal"
                className="block text-xs font-semibold text-[#57534E] mb-1.5"
              >
                Tanggal Transaksi (Lokal)
              </label>
              <input
                id="catat-tanggal"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full min-h-[44px] rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-3 py-2 font-mono text-sm text-[#18181B] focus:border-[#14532D] focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="catat-catatan"
                className="block text-xs font-semibold text-[#57534E] mb-1.5"
              >
                Catatan / Keterangan
              </label>
              <input
                id="catat-catatan"
                type="text"
                placeholder="Misal: Nasi Padang, Proyek"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full min-h-[44px] rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-3 py-2 text-sm text-[#18181B] focus:border-[#14532D] focus:outline-none"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-[#F0EDE6] flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => submitTransaction(true)}
              className="flex-1 min-w-[190px] min-h-[46px] rounded-lg bg-[#14532D] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#166534] whitespace-nowrap"
            >
              Simpan &amp; tambah lagi
            </button>
            <button
              type="button"
              onClick={() => submitTransaction(false)}
              className="flex-1 sm:flex-none min-h-[46px] rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-4 py-2.5 text-sm font-semibold text-[#18181B] hover:bg-[#EFECE5] whitespace-nowrap shrink-0"
            >
              Simpan &amp; lihat daftar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
