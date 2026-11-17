import { useMemo, useRef, useState } from 'react';
import { BookOpenCheck, CheckCircle2, X } from 'lucide-react';
import type {
  Account,
  CounterpartyLedgerItem,
  Journal,
  LedgerDatabase,
  TransactionInput,
} from '../core/types';
import {
  formatKolomAngka,
  formatRupiahTitle,
  formatTanggalID,
  todayLocalDate,
} from '../core/format';
import { computeAccountBalances } from '../core/ledger';
import { explainJournal } from '../core/mapper';
import { buildCounterpartyLedgers } from '../core/reports';

interface HutangPiutangViewProps {
  db: LedgerDatabase;
  onSaveTransaction: (input: TransactionInput) => void;
}

type DebtAction = 'belanja_utang' | 'bayar_utang' | 'pinjamkan' | 'dilunasi';

export function HutangPiutangView({ db, onSaveTransaction }: HutangPiutangViewProps) {
  const balances = useMemo(
    () => computeAccountBalances(db.accounts, db.journalLines),
    [db.accounts, db.journalLines],
  );

  const wallets = useMemo(
    () =>
      db.accounts
        .filter((a) => a.is_active && (a.is_wallet || ['1101', '1102', '1103'].includes(a.code)))
        .sort((a, b) => a.code.localeCompare(b.code)),
    [db.accounts],
  );

  const liabilities = useMemo(
    () =>
      db.accounts
        .filter((a) => a.is_active && a.type === 'LIABILITY')
        .sort((a, b) => a.code.localeCompare(b.code)),
    [db.accounts],
  );

  const receivables = useMemo(
    () =>
      db.accounts
        .filter((a) => a.is_active && a.code.startsWith('12') && a.type === 'ASSET')
        .sort((a, b) => a.code.localeCompare(b.code)),
    [db.accounts],
  );

  const expenses = useMemo(
    () =>
      db.accounts
        .filter((a) => a.is_active && a.type === 'EXPENSE')
        .sort((a, b) => a.code.localeCompare(b.code)),
    [db.accounts],
  );

  const [action, setAction] = useState<DebtAction>('belanja_utang');
  const [amount, setAmount] = useState<string>('');
  const [walletId, setWalletId] = useState<string>(wallets[0]?.id ?? 'acc-1101');
  const [debtAccountId, setDebtAccountId] = useState<string>(liabilities[0]?.id ?? 'acc-2101');
  const [receivableId, setReceivableId] = useState<string>(receivables[0]?.id ?? 'acc-1201');
  const [expenseId, setExpenseId] = useState<string>(expenses[0]?.id ?? 'acc-5101');
  const [counterparty, setCounterparty] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [date, setDate] = useState<string>(todayLocalDate());
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');
  const [inspectJournal, setInspectJournal] = useState<Journal | null>(null);

  const formRef = useRef<HTMLFormElement | null>(null);
  const amountInputRef = useRef<HTMLInputElement | null>(null);

  const accountsMap = useMemo(
    () => new Map<string, Account>(db.accounts.map((a) => [a.id, a])),
    [db.accounts],
  );

  const partyLedgers = useMemo(() => buildCounterpartyLedgers(db), [db]);

  const handleQuickSettle = (item: CounterpartyLedgerItem) => {
    setErrorMsg('');
    if (item.kind === 'piutang') {
      setAction('dilunasi');
      setReceivableId(item.accountId);
    } else {
      setAction('bayar_utang');
      setDebtAccountId(item.accountId);
    }
    const settleAmount = Math.max(0, item.remaining);
    setAmount(settleAmount > 0 ? String(settleAmount) : '');
    setCounterparty(item.counterparty === 'Umum / Tanpa Nama' ? '' : item.counterparty);
    setDescription(
      item.kind === 'piutang'
        ? `Pelunasan piutang dari ${item.counterparty}`
        : `Pembayaran utang ke ${item.counterparty}`,
    );
    setSuccessMsg(
      `Formulir pelunasan untuk ${item.counterparty} (${formatRupiahTitle(settleAmount)}) telah diisi. Pilih dompet lalu klik Simpan ke Jurnal.`,
    );
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      amountInputRef.current?.focus({ preventScroll: true });
    });
  };

  const debtJournals = useMemo(() => {
    const targetIds = new Set([...liabilities.map((l) => l.id), ...receivables.map((r) => r.id)]);
    const matchingJournalIds = new Set(
      db.journalLines.filter((l) => targetIds.has(l.account_id)).map((l) => l.journal_id),
    );
    return [...db.journals]
      .filter((j) => matchingJournalIds.has(j.id) && j.kind !== 'pembalik')
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [db.journals, db.journalLines, liabilities, receivables]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    const num = Number(amount);
    if (!Number.isSafeInteger(num) || num <= 0) {
      setErrorMsg('Masukkan nominal rupiah bilangan bulat lebih dari 0.');
      return;
    }

    try {
      if (action === 'belanja_utang') {
        onSaveTransaction({
          actionType: 'belanja_utang',
          amount: num,
          walletId: debtAccountId,
          categoryAccountId: expenseId,
          counterparty: counterparty.trim(),
          description: description.trim(),
          date,
        });
      } else if (action === 'bayar_utang') {
        onSaveTransaction({
          actionType: 'bayar_utang',
          amount: num,
          walletId,
          categoryAccountId: debtAccountId,
          counterparty: counterparty.trim(),
          description: description.trim(),
          date,
        });
      } else if (action === 'pinjamkan') {
        onSaveTransaction({
          actionType: 'pinjamkan',
          amount: num,
          walletId,
          categoryAccountId: receivableId,
          counterparty: counterparty.trim(),
          description: description.trim(),
          date,
        });
      } else {
        onSaveTransaction({
          actionType: 'dilunasi',
          amount: num,
          walletId,
          categoryAccountId: receivableId,
          counterparty: counterparty.trim(),
          description: description.trim(),
          date,
        });
      }
      setAmount('');
      setCounterparty('');
      setDescription('');
      setSuccessMsg(`Berhasil mencatat ${formatRupiahTitle(num)}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal mencatat transaksi.');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-bold text-[#18181B]">Hutang &amp; Piutang</h1>
        <p className="text-sm text-[#57534E]">
          Kelola belanja belum bayar, cicilan utang, pinjaman ke orang lain, dan pelunasannya dengan jurnal otomatis.
        </p>
      </div>

      {/* Live Position Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {receivables.map((r) => (
          <div key={r.id} className="rounded-xl border border-[#E5E2DC] bg-white p-5">
            <p className="text-xs font-medium text-[#57534E]">
              {r.code} · {r.name} (Aset)
            </p>
            <p className="font-mono text-2xl font-semibold text-[#14532D] tabular-nums mt-2">
              {formatRupiahTitle(balances.get(r.id)?.balance ?? 0)}
            </p>
          </div>
        ))}
        {liabilities.map((l) => (
          <div key={l.id} className="rounded-xl border border-[#E5E2DC] bg-white p-5">
            <p className="text-xs font-medium text-[#57534E]">
              {l.code} · {l.name} (Kewajiban)
            </p>
            <p className="font-mono text-2xl font-semibold text-[#B91C1C] tabular-nums mt-2">
              {formatRupiahTitle(balances.get(l.id)?.balance ?? 0)}
            </p>
          </div>
        ))}
      </div>

      {/* Per-Counterparty Ledger */}
      <section className="rounded-xl border border-[#E5E2DC] bg-white overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E5E2DC] flex items-center justify-between gap-4">
          <div>
            <h2 className="font-serif text-lg font-bold text-[#18181B]">
              Rincian per Nama Pihak
            </h2>
            <p className="text-xs text-[#57534E]">
              Klik &ldquo;Lunasi&rdquo; atau &ldquo;Bayar&rdquo; untuk mengisi formulir pelunasan otomatis sesuai sisa saldo.
            </p>
          </div>
        </div>
        {partyLedgers.length === 0 ? (
          <div className="p-6 text-xs text-[#57534E]">
            Belum ada rincian pihak terkait yang tercatat.
          </div>
        ) : (
          <>
            {/* Mobile Card List */}
            <div className="md:hidden divide-y divide-[#F0EDE6]">
              {partyLedgers.map((item) => {
                const isOverpaid = item.remaining < 0;
                const statusLabel =
                  item.remaining === 0
                    ? 'Lunas (Rp0)'
                    : isOverpaid
                      ? `Lebih bayar (${formatRupiahTitle(Math.abs(item.remaining))})`
                      : formatRupiahTitle(item.remaining);

                return (
                  <div key={item.key} className="p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#18181B] truncate">
                          {item.counterparty}
                        </p>
                        <p className="text-xs text-[#57534E] mt-0.5">
                          {item.kind === 'piutang' ? 'Piutang' : 'Utang'} · {item.accountCode}{' '}
                          {item.accountName}
                        </p>
                      </div>
                      {item.remaining > 0 ? (
                        <button
                          type="button"
                          onClick={() => handleQuickSettle(item)}
                          className="min-h-[40px] rounded-md bg-[#14532D] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#166534] whitespace-nowrap shrink-0"
                        >
                          {item.kind === 'piutang' ? 'Lunasi' : 'Bayar'}
                        </button>
                      ) : (
                        <span className="text-xs font-medium text-[#57534E] shrink-0">Selesai</span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
                      <div>
                        <p className="text-[#57534E]">Total Awal</p>
                        <p className="font-mono tabular-nums font-medium mt-0.5">
                          {formatRupiahTitle(item.totalAdded)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[#57534E]">Terbayar</p>
                        <p className="font-mono tabular-nums text-[#57534E] mt-0.5">
                          {formatRupiahTitle(item.totalSettled)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[#57534E]">Sisa Aktif</p>
                        <p
                          className={`font-mono tabular-nums font-semibold mt-0.5 ${
                            item.remaining === 0
                              ? 'text-[#57534E]'
                              : isOverpaid
                                ? 'text-[#B45309]'
                                : item.kind === 'piutang'
                                  ? 'text-[#14532D]'
                                  : 'text-[#B91C1C]'
                          }`}
                        >
                          {statusLabel}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-[#F8F7F4] border-b border-[#E5E2DC] text-xs font-semibold text-[#57534E]">
                    <th className="px-5 py-2.5 text-left">Pihak Terkait</th>
                    <th className="px-4 py-2.5 text-left">Jenis &amp; Akun</th>
                    <th className="px-4 py-2.5 text-right">Total Awal</th>
                    <th className="px-4 py-2.5 text-right">Terbayar</th>
                    <th className="px-4 py-2.5 text-right">Sisa Aktif</th>
                    <th className="px-5 py-2.5 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0EDE6]">
                  {partyLedgers.map((item) => {
                    const isOverpaid = item.remaining < 0;
                    return (
                      <tr key={item.key} className="hover:bg-[#FAF9F6]">
                        <td className="px-5 py-3 font-semibold text-[#18181B]">
                          {item.counterparty}
                        </td>
                        <td className="px-4 py-3 text-xs text-[#57534E]">
                          {item.kind === 'piutang' ? 'Piutang' : 'Utang'} · {item.accountCode}{' '}
                          {item.accountName}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-xs">
                          {formatRupiahTitle(item.totalAdded)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-xs text-[#57534E]">
                          {formatRupiahTitle(item.totalSettled)}
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-mono tabular-nums font-semibold ${
                            item.remaining === 0
                              ? 'text-[#57534E]'
                              : isOverpaid
                                ? 'text-[#B45309]'
                                : item.kind === 'piutang'
                                  ? 'text-[#14532D]'
                                  : 'text-[#B91C1C]'
                          }`}
                        >
                          {item.remaining === 0
                            ? 'Lunas (Rp0)'
                            : isOverpaid
                              ? `Lebih bayar (${formatRupiahTitle(Math.abs(item.remaining))})`
                              : formatRupiahTitle(item.remaining)}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {item.remaining > 0 ? (
                            <button
                              type="button"
                              onClick={() => handleQuickSettle(item)}
                              className="min-h-[40px] rounded-md bg-[#14532D] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#166534] whitespace-nowrap"
                            >
                              {item.kind === 'piutang' ? 'Lunasi' : 'Bayar'}
                            </button>
                          ) : (
                            <span className="text-xs text-[#57534E]">Selesai</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Form */}
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="lg:col-span-5 rounded-xl border border-[#E5E2DC] bg-white p-5 sm:p-6 space-y-4 scroll-mt-20"
        >
          <h2 className="font-serif text-lg font-bold text-[#18181B]">Catat Hutang / Piutang</h2>

          <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-[#EBE8E0] p-1">
            {[
              { id: 'belanja_utang', label: 'Belanja Utang' },
              { id: 'bayar_utang', label: 'Bayar Utang' },
              { id: 'pinjamkan', label: 'Pinjamkan' },
              { id: 'dilunasi', label: 'Dilunasi' },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setAction(item.id as DebtAction);
                  setErrorMsg('');
                  setSuccessMsg('');
                }}
                className={`min-h-[44px] px-3 py-2 text-xs font-semibold rounded-md ${
                  action === item.id
                    ? 'bg-white text-[#14532D] shadow-sm'
                    : 'text-[#57534E] hover:text-[#18181B]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {successMsg && (
            <div className="flex items-center gap-2 rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] px-3 py-2 text-xs font-medium text-[#14532D]">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}
          {errorMsg && (
            <div className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs font-medium text-[#B91C1C]">
              {errorMsg}
            </div>
          )}

          <div>
            <label htmlFor="hp-nominal" className="block text-xs font-semibold text-[#57534E] mb-1">
              Nominal (Rp)
            </label>
            <input
              ref={amountInputRef}
              id="hp-nominal"
              type="number"
              min={1}
              step={1}
              placeholder="Contoh: 250000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full min-h-[44px] rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-3 py-2 font-mono text-sm"
            />
          </div>

          {action === 'belanja_utang' ? (
            <>
              <div>
                <label htmlFor="hp-expense" className="block text-xs font-semibold text-[#57534E] mb-1">
                  Kategori Beban
                </label>
                <select
                  id="hp-expense"
                  value={expenseId}
                  onChange={(e) => setExpenseId(e.target.value)}
                  className="w-full rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-3 py-2 text-sm"
                >
                  {expenses.map((ex) => (
                    <option key={ex.id} value={ex.id}>
                      {ex.code} — {ex.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="hp-debt-acc" className="block text-xs font-semibold text-[#57534E] mb-1">
                  Akun Utang
                </label>
                <select
                  id="hp-debt-acc"
                  value={debtAccountId}
                  onChange={(e) => setDebtAccountId(e.target.value)}
                  className="w-full rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-3 py-2 text-sm"
                >
                  {liabilities.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code} — {l.name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <>
              <div>
                <label htmlFor="hp-wallet" className="block text-xs font-semibold text-[#57534E] mb-1">
                  {action === 'dilunasi' ? 'Masuk ke Dompet' : 'Bayar dari Dompet'}
                </label>
                <select
                  id="hp-wallet"
                  value={walletId}
                  onChange={(e) => setWalletId(e.target.value)}
                  className="w-full rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-3 py-2 text-sm"
                >
                  {wallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} — {w.name}
                    </option>
                  ))}
                </select>
              </div>

              {action === 'bayar_utang' ? (
                <div>
                  <label htmlFor="hp-debt-pay" className="block text-xs font-semibold text-[#57534E] mb-1">
                    Utang yang Dibayar
                  </label>
                  <select
                    id="hp-debt-pay"
                    value={debtAccountId}
                    onChange={(e) => setDebtAccountId(e.target.value)}
                    className="w-full rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-3 py-2 text-sm"
                  >
                    {liabilities.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.code} — {l.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label htmlFor="hp-piutang-acc" className="block text-xs font-semibold text-[#57534E] mb-1">
                    Akun Piutang
                  </label>
                  <select
                    id="hp-piutang-acc"
                    value={receivableId}
                    onChange={(e) => setReceivableId(e.target.value)}
                    className="w-full rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-3 py-2 text-sm"
                  >
                    {receivables.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.code} — {r.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="hp-party" className="block text-xs font-semibold text-[#57534E] mb-1">
                Pihak Terkait
              </label>
              <input
                id="hp-party"
                type="text"
                placeholder="Misal: Raka / Toko A"
                value={counterparty}
                onChange={(e) => setCounterparty(e.target.value)}
                className="w-full rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="hp-date" className="block text-xs font-semibold text-[#57534E] mb-1">
                Tanggal
              </label>
              <input
                id="hp-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-3 py-2 font-mono text-sm"
              />
            </div>
          </div>

          <div>
            <label htmlFor="hp-desc" className="block text-xs font-semibold text-[#57534E] mb-1">
              Catatan
            </label>
            <input
              id="hp-desc"
              type="text"
              placeholder="Keterangan tambahan (opsional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-3 py-2 text-sm"
            />
          </div>

          <button
            type="submit"
            className="w-full min-h-[46px] rounded-lg bg-[#14532D] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#166534]"
          >
            Simpan ke Jurnal
          </button>
        </form>

        {/* History Table */}
        <div className="lg:col-span-7 rounded-xl border border-[#E5E2DC] bg-white overflow-hidden">
          <div className="px-5 sm:px-6 py-4 border-b border-[#E5E2DC]">
            <h2 className="font-serif text-lg font-bold text-[#18181B]">Riwayat Hutang &amp; Piutang</h2>
          </div>

          {debtJournals.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#57534E]">
              Belum ada catatan hutang atau piutang.
            </div>
          ) : (
            <ul className="divide-y divide-[#F0EDE6]">
              {debtJournals.map((j) => {
                const lines = db.journalLines.filter((l) => l.journal_id === j.id);
                const nominal = lines.reduce((s, l) => s + l.debit, 0);
                return (
                  <li
                    key={j.id}
                    className={`px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3 ${
                      j.voided_at ? 'opacity-55 line-through' : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#18181B] truncate">{j.description}</p>
                      <p className="text-xs text-[#57534E] mt-0.5">
                        <span className="font-mono">{formatTanggalID(j.date)}</span>
                        <span aria-hidden="true"> · </span>
                        <span className="font-mono">{j.number}</span>
                        {j.tx_meta?.counterparty && <span> · {j.tx_meta.counterparty}</span>}
                        {j.voided_at && <span> · Void</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <p className="font-mono text-sm font-semibold text-[#18181B] tabular-nums">
                        {formatRupiahTitle(nominal)}
                      </p>
                      <button
                        type="button"
                        onClick={() => setInspectJournal(j)}
                        aria-label={`Lihat jurnal ${j.number}`}
                        className="min-h-[40px] inline-flex items-center gap-1 rounded-md border border-[#D6D3CB] bg-[#F8F7F4] px-2.5 py-1.5 text-xs font-semibold text-[#14532D] hover:bg-[#EFECE5]"
                      >
                        <BookOpenCheck className="w-3.5 h-3.5" />
                        <span>Jurnal</span>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Modal: Lihat Jurnalnya */}
      {inspectJournal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-xl rounded-xl border border-[#D6D3CB] bg-white p-4 sm:p-6 space-y-4 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-mono text-[#57534E]">
                  {inspectJournal.number} · {formatTanggalID(inspectJournal.date)}
                </p>
                <h3 className="font-serif text-xl font-bold text-[#18181B] mt-1">
                  {inspectJournal.description}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInspectJournal(null)}
                aria-label="Tutup rincian jurnal"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-[#57534E] hover:bg-[#F3F1EB]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {(() => {
              const lines = db.journalLines
                .filter((l) => l.journal_id === inspectJournal.id)
                .sort((a, b) => (a.debit > 0 && b.debit === 0 ? -1 : 1));
              const explanation = explainJournal(lines, accountsMap);
              return (
                <>
                  <div className="rounded-lg border border-[#E5E2DC] bg-[#F8F7F4] p-3.5">
                    <p className="text-xs font-semibold text-[#57534E]">Arti Akuntansi</p>
                    <p className="text-sm font-medium text-[#14532D] mt-1">{explanation}</p>
                  </div>
                  <table className="w-full border-collapse border border-[#D6D3CB] text-sm">
                    <thead>
                      <tr className="bg-[#F3F1EB] text-xs font-semibold">
                        <th className="border border-[#D6D3CB] px-3 py-2 text-left">Akun</th>
                        <th className="border border-[#D6D3CB] px-3 py-2 text-center w-20">Ref</th>
                        <th className="border border-[#D6D3CB] px-3 py-2 text-right w-32">Debit</th>
                        <th className="border border-[#D6D3CB] px-3 py-2 text-right w-32">Kredit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line) => {
                        const acc = accountsMap.get(line.account_id);
                        return (
                          <tr key={line.id}>
                            <td className={`border border-[#D6D3CB] px-3 py-2 ${line.credit > 0 ? 'pl-8' : ''}`}>
                              {acc?.name ?? line.account_id}
                            </td>
                            <td className="border border-[#D6D3CB] px-3 py-2 text-center font-mono text-xs">
                              {acc?.code ?? '-'}
                            </td>
                            <td className="border border-[#D6D3CB] px-3 py-2 text-right font-mono tabular-nums">
                              {formatKolomAngka(line.debit)}
                            </td>
                            <td className="border border-[#D6D3CB] px-3 py-2 text-right font-mono tabular-nums">
                              {formatKolomAngka(line.credit)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
