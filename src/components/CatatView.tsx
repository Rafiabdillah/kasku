import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, Delete } from 'lucide-react';
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
  const [mobileStep, setMobileStep] = useState<'nominal' | 'detail'>('nominal');
  const nominalHeadingRef = useRef<HTMLHeadingElement>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const focusStepRef = useRef(false);

  useEffect(() => {
    if (!focusStepRef.current) return;
    focusStepRef.current = false;
    if (!window.matchMedia('(max-width: 1023px)').matches) return;
    const heading = mobileStep === 'nominal' ? nominalHeadingRef.current : detailHeadingRef.current;
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: 'nearest' });
  }, [mobileStep]);

  useEffect(() => {
    if (errorMsg) {
      errorRef.current?.focus({ preventScroll: true });
      errorRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [errorMsg]);

  const changeMobileStep = (next: 'nominal' | 'detail') => {
    if (next === mobileStep) return;
    focusStepRef.current = true;
    setMobileStep(next);
  };

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
    setMobileStep('nominal');
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
    setErrorMsg('');
    setSuccessMsg('');
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

  const goToDetails = () => {
    if (amountNum <= 0 || !Number.isSafeInteger(amountNum)) {
      setErrorMsg('Masukkan nominal rupiah terlebih dahulu (lebih dari 0).');
      setKeypadTarget('amount');
      return;
    }
    setErrorMsg('');
    setKeypadTarget('amount');
    changeMobileStep('detail');
  };

  const submitTransaction = (stayAndAddMore: boolean) => {
    setErrorMsg('');
    setSuccessMsg('');

    if (amountNum <= 0 || !Number.isSafeInteger(amountNum)) {
      setErrorMsg('Masukkan nominal rupiah terlebih dahulu (lebih dari 0).');
      setKeypadTarget('amount');
      changeMobileStep('nominal');
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
        setKeypadTarget('amount');
        changeMobileStep('nominal');
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
    <form
      className="catat-view min-w-0 max-w-4xl mx-auto space-y-4 lg:space-y-6"
      data-mobile-step={mobileStep}
      aria-label="Catat transaksi"
      aria-describedby={errorMsg ? 'catat-error' : undefined}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (window.matchMedia('(max-width: 1023px)').matches && mobileStep === 'nominal') {
          goToDetails();
        } else {
          submitTransaction(true);
        }
      }}
    >
      <div className="flex min-w-0 flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-bold text-[#18181B]">Catat Uang</h1>
          <p className="text-sm text-[#57534E]">
            <span className="lg:hidden">Catat sekarang, pembukuan otomatis.</span>
            <span className="hidden lg:inline">Pilih jenis transaksi dan nominal — jurnal debit-kredit dicatat otomatis di balik layar.</span>
          </p>
        </div>

        {/* Mode Segmented Switch */}
        <div role="group" aria-label="Jenis transaksi" className="catat-tabs grid w-full min-w-0 grid-cols-4 items-center gap-1 rounded-xl bg-[#EBE8E0] p-1 lg:inline-flex lg:w-auto lg:shrink-0">
          {TAB_LABELS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleTabChange(item.id)}
              aria-pressed={tab === item.id}
              className={`min-w-0 min-h-[44px] px-1.5 lg:px-3.5 py-2 text-xs font-semibold rounded-lg ${
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

      <ol className="catat-steps flex items-center gap-3 lg:hidden" aria-label="Langkah pencatatan">
        <li aria-current={mobileStep === 'nominal' ? 'step' : undefined} className={mobileStep === 'nominal' ? 'is-current' : 'is-complete'}>
          <span aria-hidden="true">1</span> Nominal
        </li>
        <li className="catat-step-line" aria-hidden="true" />
        <li aria-current={mobileStep === 'detail' ? 'step' : undefined} className={mobileStep === 'detail' ? 'is-current' : ''}>
          <span aria-hidden="true">2</span> Detail
        </li>
      </ol>

      {successMsg && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] px-4 py-3 text-sm font-medium text-[#14532D]"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      <div className="grid min-w-0 grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Both panels stay visible on desktop; only the active step is shown on mobile. */}
        <section aria-labelledby="catat-nominal-heading" className="catat-nominal-panel min-w-0 lg:col-span-5 rounded-xl border border-[#E5E2DC] bg-white p-4 sm:p-5 space-y-3 lg:space-y-4">
          <h2 id="catat-nominal-heading" ref={nominalHeadingRef} tabIndex={-1} className="catat-step-heading font-serif text-lg font-bold text-[#18181B]">Berapa nominalnya?</h2>
          {tab === 'pindah' && (
            <div role="group" aria-label="Nominal yang diedit" className="grid grid-cols-2 gap-1 rounded-lg bg-[#EBE8E0] p-1">
              <button
                type="button"
                onClick={() => setKeypadTarget('amount')}
                aria-pressed={keypadTarget === 'amount'}
                className={`min-h-[44px] px-3 py-1.5 text-xs font-semibold rounded-md ${
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
                aria-pressed={keypadTarget === 'admin'}
                className={`min-h-[44px] px-3 py-1.5 text-xs font-semibold rounded-md ${
                  keypadTarget === 'admin'
                    ? 'bg-white text-[#14532D] shadow-sm'
                    : 'text-[#57534E] hover:text-[#18181B]'
                }`}
              >
                Biaya Admin
              </button>
            </div>
          )}

          <div className="catat-amount-card min-w-0 rounded-xl border border-[#D8E5DC] bg-[#F1F7F3] p-4 text-right">
            <label htmlFor="catat-nominal-input" className="block text-xs font-medium text-[#57534E]">
              {editingAdmin ? 'Biaya admin (Rp)' : 'Nominal rupiah'}
            </label>
            <p
              className="catat-amount-value font-mono text-3xl font-semibold text-[#14532D] tabular-nums mt-1"
              data-testid="catat-nominal-display"
              aria-live="off"
            >
              {formatRupiahTitle(editingAdmin ? adminFeeNum : amountNum)}
            </p>
            <input
              id="catat-nominal-input"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              enterKeyHint="next"
              maxLength={12}
              value={editingAdmin ? adminFeeStr : amountStr}
              aria-invalid={!editingAdmin && !!errorMsg && (amountNum <= 0 || !Number.isSafeInteger(amountNum))}
              aria-describedby={!editingAdmin && errorMsg ? 'catat-error' : undefined}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => {
                const digits = event.target.value.replace(/\D/g, '').replace(/^0+/, '') || '0';
                if (editingAdmin) setAdminFeeStr(digits);
                else setAmountStr(digits);
                setErrorMsg('');
                setSuccessMsg('');
              }}
              className="mt-2 min-h-[44px] w-full min-w-0 rounded-lg border border-[#D6D3CB] bg-white px-3 py-2 text-right font-mono text-base text-[#18181B]"
            />
          </div>

          <div role="group" aria-label={editingAdmin ? 'Papan angka biaya admin' : 'Papan angka nominal'} className="grid grid-cols-3 gap-2">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0'].map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => appendDigit(key)}
                className="h-12 rounded-lg border border-[#E5E2DC] bg-[#F8F7F4] font-mono text-base font-semibold text-[#18181B] hover:bg-[#EFECE5] active:scale-[0.98] transition-colors"
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

          <div className="catat-quick-actions flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {(editingAdmin ? [2500, 5000, 6500] : [10000, 50000, 100000]).map((quick) => (
                <button
                  key={quick}
                  type="button"
                  aria-label={`Tambah ${formatRupiahTitle(quick)}`}
                  onClick={() => {
                    setErrorMsg('');
                    setSuccessMsg('');
                    if (editingAdmin) setAdminFeeStr(String(adminFeeNum + quick));
                    else setAmountStr(String(amountNum + quick));
                  }}
                  className="min-h-[44px] rounded-md border border-[#E5E2DC] px-3 py-1.5 font-mono text-xs font-medium text-[#57534E] hover:bg-[#F3F1EB] hover:text-[#18181B]"
                >
                  +{quick >= 1000 && quick % 1000 === 0 ? `${quick / 1000}rb` : quick}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleClear}
              className="min-h-[44px] rounded-md px-3 py-1.5 text-xs font-semibold text-[#B91C1C] hover:bg-[#FEF2F2]"
            >
              Reset
            </button>
          </div>
        </section>

        <section aria-labelledby="catat-detail-heading" className="catat-detail-panel min-w-0 lg:col-span-7 rounded-xl border border-[#E5E2DC] bg-white p-4 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="catat-detail-heading" ref={detailHeadingRef} tabIndex={-1} className="catat-step-heading font-serif text-lg font-bold text-[#18181B]">Detail transaksi</h2>
            <button
              type="button"
              onClick={() => changeMobileStep('nominal')}
              className="lg:hidden inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-[#14532D] hover:bg-[#F1F7F3]"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Kembali
            </button>
          </div>
          <div className="lg:hidden rounded-xl border border-[#D8E5DC] bg-[#F1F7F3] p-4">
            <p className="text-xs font-semibold text-[#57534E]">{TAB_LABELS.find((item) => item.id === tab)?.label}</p>
            <p className="catat-amount-value mt-1 font-mono text-2xl font-semibold text-[#14532D] tabular-nums">{formatRupiahTitle(amountNum)}</p>
            {tab === 'pindah' && adminFeeNum > 0 && (
              <p className="mt-1 text-xs text-[#57534E]">+ biaya admin {formatRupiahTitle(adminFeeNum)}</p>
            )}
          </div>
          {/* Wallet Selector */}
          <fieldset className="min-w-0">
            <legend className="text-xs font-semibold text-[#57534E] mb-2">
              {tab === 'pindah'
                ? 'Dari Dompet'
                : tab === 'saldo_awal'
                  ? 'Pilih Akun Aset'
                  : tab === 'masuk'
                    ? 'Masuk ke Dompet'
                    : 'Keluar dari Dompet'}
            </legend>
            {walletChoices.length === 0 && <p className="text-sm text-[#B91C1C]">Belum ada akun aktif. Aktifkan akun di Pengaturan sebelum menyimpan.</p>}
            <div className="flex flex-wrap gap-2">
              {walletChoices.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => setWalletId(w.id)}
                  aria-pressed={walletId === w.id}
                  title={w.name}
                  className={`catat-choice min-h-[44px] px-3.5 py-2 rounded-lg text-xs font-semibold border ${
                    walletId === w.id
                      ? 'border-[#14532D] bg-[#14532D] text-white'
                      : 'border-[#E5E2DC] bg-[#F8F7F4] text-[#18181B] hover:bg-[#EFECE5]'
                  }`}
                >
                  {w.name}
                </button>
              ))}
            </div>
          </fieldset>

          {/* Destination Wallet & Admin Fee for Transfer */}
          {tab === 'pindah' && (
            <div className="space-y-4">
              <fieldset className="min-w-0">
                <legend className="text-xs font-semibold text-[#57534E] mb-2">Ke Dompet Tujuan</legend>
                <div className="flex flex-wrap gap-2">
                  {wallets.map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => setToWalletId(w.id)}
                      aria-pressed={toWalletId === w.id}
                      title={w.name}
                      className={`catat-choice min-h-[44px] px-3.5 py-2 rounded-lg text-xs font-semibold border ${
                        toWalletId === w.id
                          ? 'border-[#14532D] bg-[#14532D] text-white'
                          : 'border-[#E5E2DC] bg-[#F8F7F4] text-[#18181B] hover:bg-[#EFECE5]'
                      }`}
                    >
                      {w.name}
                    </button>
                  ))}
                </div>
              </fieldset>

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
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={adminFeeStr}
                  onChange={(e) => setAdminFeeStr(e.target.value)}
                  className="w-full min-w-0 min-h-[44px] rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-3 py-2 font-mono text-sm text-[#18181B] focus:border-[#14532D] focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* Category Selector for Masuk / Keluar */}
          {(tab === 'masuk' || tab === 'keluar') && (
            <fieldset className="min-w-0">
              <legend className="text-xs font-semibold text-[#57534E] mb-2">
                {tab === 'masuk' ? 'Sumber Pemasukan' : 'Kategori Pengeluaran'}
              </legend>
              {categoriesToShow.length === 0 && <p className="text-sm text-[#B91C1C]">Belum ada kategori aktif. Aktifkan kategori di Pengaturan sebelum menyimpan.</p>}
              <div className="flex flex-wrap gap-2">
                {categoriesToShow.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategoryId(cat.id)}
                    aria-pressed={categoryId === cat.id}
                    title={cat.name}
                    className={`catat-choice min-h-[44px] px-3.5 py-2 rounded-lg text-xs font-semibold border ${
                      categoryId === cat.id
                        ? 'border-[#14532D] bg-[#14532D] text-white'
                        : 'border-[#E5E2DC] bg-[#F8F7F4] text-[#18181B] hover:bg-[#EFECE5]'
                    }`}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            </fieldset>
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
                className="w-full min-w-0 min-h-[44px] rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-3 py-2 font-mono text-sm text-[#18181B] focus:border-[#14532D] focus:outline-none"
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
                className="w-full min-w-0 min-h-[44px] rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-3 py-2 text-sm text-[#18181B] focus:border-[#14532D] focus:outline-none"
              />
            </div>
          </div>

        </section>
      </div>

      <div className="catat-action-bar">
        {errorMsg && (
          <div
            id="catat-error"
            ref={errorRef}
            tabIndex={-1}
            role="alert"
            className="catat-error mb-3 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm font-medium text-[#B91C1C]"
          >
            {errorMsg}
          </div>
        )}
        <div className="catat-next-action lg:hidden">
          <button
            type="submit"
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[#14532D] px-4 py-3 text-sm font-semibold text-white hover:bg-[#166534]"
          >
            Lanjut ke detail <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="catat-save-actions grid grid-cols-2 gap-2 lg:flex lg:flex-wrap lg:justify-end lg:gap-3">
          <button
            type="submit"
            className="catat-save-more min-w-0 min-h-[48px] rounded-xl border border-[#D6D3CB] bg-[#F8F7F4] px-3 py-2.5 text-sm font-semibold text-[#18181B] hover:bg-[#EFECE5] lg:border-[#14532D] lg:bg-[#14532D] lg:text-white lg:hover:bg-[#166534]"
          >
            <span className="lg:hidden">Simpan &amp; tambah</span>
            <span className="hidden lg:inline">Simpan &amp; tambah lagi</span>
          </button>
          <button
            type="button"
            onClick={() => submitTransaction(false)}
            className="min-w-0 min-h-[48px] rounded-xl border border-[#14532D] bg-[#14532D] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#166534] lg:border-[#D6D3CB] lg:bg-[#F8F7F4] lg:text-[#18181B] lg:hover:bg-[#EFECE5]"
          >
            <span className="lg:hidden">Simpan</span>
            <span className="hidden lg:inline">Simpan &amp; lihat daftar</span>
          </button>
        </div>
      </div>
    </form>
  );
}
