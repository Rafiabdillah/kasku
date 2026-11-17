import { useMemo, useState } from 'react';
import { Ban, BookOpenCheck, Pencil, Search, X } from 'lucide-react';
import type {
  Account,
  Journal,
  JournalLine,
  LedgerDatabase,
  TransactionInput,
} from '../core/types';
import { formatKolomAngka, formatRupiahTitle, formatTanggalID } from '../core/format';
import { explainJournal } from '../core/mapper';
import { matchesTransactionQuery } from '../core/reports';

interface TransaksiViewProps {
  db: LedgerDatabase;
  onEditJournal: (journalId: string, updates: { date: string; description: string }) => void;
  onEditFullTransaction: (journalId: string, input: TransactionInput) => void;
  onVoidJournal: (journalId: string) => void;
}

export function TransaksiView({
  db,
  onEditJournal,
  onEditFullTransaction,
  onVoidJournal,
}: TransaksiViewProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'voided'>('all');
  const [inspectJournal, setInspectJournal] = useState<Journal | null>(null);
  const [editingJournal, setEditingJournal] = useState<Journal | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editAdminFee, setEditAdminFee] = useState('0');
  const [editWalletId, setEditWalletId] = useState('');
  const [editToWalletId, setEditToWalletId] = useState('');
  const [editCategoryId, setEditCategoryId] = useState('');
  const [editCounterparty, setEditCounterparty] = useState('');
  const [editError, setEditError] = useState('');
  const [confirmVoidId, setConfirmVoidId] = useState<string | null>(null);

  const accountsMap = useMemo(
    () => new Map<string, Account>(db.accounts.map((a) => [a.id, a])),
    [db.accounts],
  );

  const linesByJournal = useMemo(() => {
    const map = new Map<string, JournalLine[]>();
    for (const line of db.journalLines) {
      const list = map.get(line.journal_id) ?? [];
      list.push(line);
      map.set(line.journal_id, list);
    }
    return map;
  }, [db.journalLines]);

  const transactions = useMemo(() => {
    return [...db.journals]
      .filter((j) => {
        if (statusFilter === 'active' && (j.voided_at || j.kind === 'pembalik')) return false;
        if (statusFilter === 'voided' && !j.voided_at && j.kind !== 'pembalik') return false;
        const lines = linesByJournal.get(j.id) ?? [];
        return matchesTransactionQuery(j, lines, accountsMap, search);
      })
      .sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return b.number.localeCompare(a.number);
      });
  }, [db.journals, linesByJournal, accountsMap, search, statusFilter]);

  const wallets = useMemo(
    () =>
      db.accounts
        .filter((a) => a.is_active && (a.is_wallet || ['1101', '1102', '1103'].includes(a.code)))
        .sort((a, b) => a.code.localeCompare(b.code)),
    [db.accounts],
  );

  const startEdit = (j: Journal) => {
    setEditingJournal(j);
    setEditDate(j.date);
    setEditDesc(j.description);
    setEditError('');
    if (j.tx_meta) {
      setEditAmount(String(j.tx_meta.amount));
      setEditAdminFee(String(j.tx_meta.adminFee ?? 0));
      setEditWalletId(j.tx_meta.walletId ?? '');
      setEditToWalletId(j.tx_meta.toWalletId ?? '');
      setEditCategoryId(j.tx_meta.categoryAccountId ?? '');
      setEditCounterparty(j.tx_meta.counterparty ?? '');
    } else {
      const lines = linesByJournal.get(j.id) ?? [];
      setEditAmount(String(lines.reduce((s, l) => s + l.debit, 0)));
      setEditAdminFee('0');
      setEditWalletId('');
      setEditToWalletId('');
      setEditCategoryId('');
      setEditCounterparty('');
    }
  };

  const handleSaveEdit = () => {
    if (!editingJournal) return;
    setEditError('');
    try {
      if (editingJournal.tx_meta) {
        const num = Number(editAmount);
        const fee = Number(editAdminFee) || 0;
        if (!Number.isSafeInteger(num) || num <= 0) {
          setEditError('Nominal harus bilangan bulat lebih dari 0.');
          return;
        }
        if (!Number.isSafeInteger(fee) || fee < 0) {
          setEditError('Biaya admin harus bilangan bulat >= 0.');
          return;
        }
        onEditFullTransaction(editingJournal.id, {
          actionType: editingJournal.tx_meta.actionType,
          amount: num,
          adminFee: editingJournal.tx_meta.actionType === 'pindah' ? fee : undefined,
          walletId: editWalletId || editingJournal.tx_meta.walletId,
          toWalletId: editToWalletId || editingJournal.tx_meta.toWalletId,
          categoryAccountId: editCategoryId || editingJournal.tx_meta.categoryAccountId,
          counterparty: editCounterparty.trim() || undefined,
          date: editDate,
          description: editDesc,
        });
      } else {
        onEditJournal(editingJournal.id, { date: editDate, description: editDesc });
      }
      setEditingJournal(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Gagal menyimpan perubahan transaksi.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-bold text-[#18181B]">Daftar Transaksi</h1>
          <p className="text-sm text-[#57534E]">
            Klik &ldquo;Lihat jurnalnya&rdquo; untuk memeriksa pencatatan debit-kredit atau batalkan transaksi dengan jurnal pembalik.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-[#57534E] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Cari deskripsi, tanggal, atau nominal..."
              aria-label="Cari transaksi berdasarkan deskripsi, tanggal, atau nominal"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="min-h-[44px] pl-9 pr-9 py-2 rounded-lg border border-[#D6D3CB] bg-white text-sm text-[#18181B] w-full focus:border-[#14532D] focus:outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Hapus kata kunci pencarian"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-[#57534E] hover:text-[#18181B] hover:bg-[#F3F1EB]"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="inline-flex max-w-full overflow-x-auto items-center gap-1 rounded-lg bg-[#EBE8E0] p-1">
            {[
              { id: 'all', label: 'Semua' },
              { id: 'active', label: 'Aktif' },
              { id: 'voided', label: 'Void / Pembalik' },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={statusFilter === f.id}
                onClick={() => setStatusFilter(f.id as 'all' | 'active' | 'voided')}
                className={`min-h-[40px] px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap shrink-0 ${
                  statusFilter === f.id
                    ? 'bg-white text-[#14532D] shadow-sm'
                    : 'text-[#57534E] hover:text-[#18181B]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {search.trim() !== '' && (
        <p className="text-xs text-[#57534E]" data-testid="search-result-summary">
          Menampilkan <strong className="font-mono text-[#18181B]">{transactions.length}</strong> transaksi untuk kata kunci &ldquo;{search.trim()}&rdquo;
        </p>
      )}

      {/* Transaction List */}
      <div className="rounded-xl border border-[#E5E2DC] bg-white overflow-hidden">
        {transactions.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <p className="text-sm text-[#57534E]">
              Tidak ada transaksi yang cocok dengan pencarian Anda.
            </p>
            {(search || statusFilter !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setStatusFilter('all');
                }}
                className="text-xs font-semibold text-[#14532D] hover:underline"
              >
                Tampilkan semua transaksi
              </button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-[#F0EDE6]" data-testid="transaction-list">
            {transactions.map((j) => {
              const lines = linesByJournal.get(j.id) ?? [];
              const total = lines.reduce((s, l) => s + l.debit, 0);
              const explanation = explainJournal(lines, accountsMap);
              const isVoided = Boolean(j.voided_at);
              const isReversal = j.kind === 'pembalik';

              return (
                <li
                  key={j.id}
                  className={`px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                    isVoided ? 'bg-[#FAF9F6] opacity-70' : ''
                  }`}
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p
                        className={`text-sm font-semibold text-[#18181B] ${
                          isVoided ? 'line-through' : ''
                        }`}
                      >
                        {j.description}
                      </p>
                    </div>
                    <p className="text-xs text-[#57534E]">
                      <span className="font-mono">{formatTanggalID(j.date)}</span>
                      <span aria-hidden="true"> · </span>
                      <span className="font-mono">{j.number}</span>
                      <span aria-hidden="true"> · </span>
                      <span>{explanation}</span>
                      {isVoided && <span className="text-[#B91C1C] font-semibold"> · Dibatalkan (Void)</span>}
                      {isReversal && <span className="text-[#B45309] font-semibold"> · Jurnal Pembalik</span>}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2.5 shrink-0">
                    <p className="font-mono text-sm font-semibold text-[#18181B] tabular-nums">
                      {formatRupiahTitle(total)}
                    </p>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setInspectJournal(j)}
                        className="min-h-[40px] inline-flex items-center gap-1 rounded-md border border-[#D6D3CB] bg-[#F8F7F4] px-2.5 py-1.5 text-xs font-semibold text-[#14532D] hover:bg-[#EFECE5] whitespace-nowrap"
                      >
                        <BookOpenCheck className="w-3.5 h-3.5" />
                        <span>Lihat jurnalnya</span>
                      </button>

                      {!isVoided && !isReversal && (
                        <>
                          <button
                            type="button"
                            onClick={() => startEdit(j)}
                            aria-label={`Edit ${j.description}`}
                            className="min-h-[40px] inline-flex items-center gap-1 rounded-md border border-[#D6D3CB] px-2.5 py-1.5 text-xs font-semibold text-[#18181B] hover:bg-[#F3F1EB] whitespace-nowrap"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setConfirmVoidId(j.id)}
                            aria-label={`Batalkan ${j.description}`}
                            className="min-h-[40px] inline-flex items-center gap-1 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-2.5 py-1.5 text-xs font-semibold text-[#B91C1C] hover:bg-[#FEE2E2] whitespace-nowrap"
                          >
                            <Ban className="w-3.5 h-3.5" />
                            <span>Batalkan</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Modal: Lihat Jurnalnya (Read-Only Debit/Kredit + Plain Indonesian Explanation) */}
      {inspectJournal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-jurnal-title"
        >
          <div className="w-full max-w-xl rounded-xl border border-[#D6D3CB] bg-white p-4 sm:p-6 space-y-4 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-mono text-[#57534E]">
                  {inspectJournal.number} · {formatTanggalID(inspectJournal.date)}
                </p>
                <h2 id="modal-jurnal-title" className="font-serif text-xl font-bold text-[#18181B] mt-1">
                  {inspectJournal.description}
                </h2>
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
              const lines = linesByJournal.get(inspectJournal.id) ?? [];
              const sorted = [...lines].sort((a, b) => (a.debit > 0 && b.debit === 0 ? -1 : 1));
              const totalD = sorted.reduce((s, l) => s + l.debit, 0);
              const totalC = sorted.reduce((s, l) => s + l.credit, 0);
              const explanation = explainJournal(sorted, accountsMap);

              return (
                <>
                  <div className="rounded-lg border border-[#E5E2DC] bg-[#F8F7F4] p-3.5">
                    <p className="text-xs font-semibold text-[#57534E]">Arti Akuntansi</p>
                    <p className="text-sm font-medium text-[#14532D] mt-1">{explanation}</p>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse border border-[#D6D3CB] text-sm">
                      <thead>
                        <tr className="bg-[#F3F1EB] text-xs font-semibold text-[#18181B]">
                          <th className="border border-[#D6D3CB] px-3 py-2 text-left">Akun</th>
                          <th className="border border-[#D6D3CB] px-3 py-2 text-center w-20">Ref</th>
                          <th className="border border-[#D6D3CB] px-3 py-2 text-right w-32">Debit</th>
                          <th className="border border-[#D6D3CB] px-3 py-2 text-right w-32">Kredit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sorted.map((line) => {
                          const acc = accountsMap.get(line.account_id);
                          const isCredit = line.credit > 0;
                          return (
                            <tr key={line.id}>
                              <td className={`border border-[#D6D3CB] px-3 py-2 ${isCredit ? 'pl-8' : ''}`}>
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
                      <tfoot>
                        <tr className="bg-[#F8F7F4] font-semibold">
                          <td className="border border-[#D6D3CB] px-3 py-2" colSpan={2}>
                            Total (Seimbang)
                          </td>
                          <td className="border border-[#D6D3CB] px-3 py-2 text-right font-mono tabular-nums">
                            {formatRupiahTitle(totalD)}
                          </td>
                          <td className="border border-[#D6D3CB] px-3 py-2 text-right font-mono tabular-nums">
                            {formatRupiahTitle(totalC)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Modal: Edit Full Transaction */}
      {editingJournal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-xl border border-[#D6D3CB] bg-white p-4 sm:p-6 space-y-4 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-lg font-bold text-[#18181B]">
                Edit Transaksi ({editingJournal.number})
              </h2>
              <button
                type="button"
                onClick={() => setEditingJournal(null)}
                aria-label="Tutup dialog edit"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-[#57534E] hover:bg-[#F3F1EB]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {editError && (
              <div role="alert" className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs font-medium text-[#B91C1C]">
                {editError}
              </div>
            )}

            <div className="space-y-3">
              {editingJournal.tx_meta && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="edit-nominal" className="block text-xs font-semibold text-[#57534E] mb-1">
                        Nominal (Rp)
                      </label>
                      <input
                        id="edit-nominal"
                        type="number"
                        min={1}
                        step={1}
                        value={editAmount}
                        onChange={(e) => setEditAmount(e.target.value)}
                        className="w-full rounded-lg border border-[#D6D3CB] px-3 py-2 font-mono text-sm"
                      />
                    </div>
                    {editingJournal.tx_meta.actionType === 'pindah' && (
                      <div>
                        <label htmlFor="edit-admin" className="block text-xs font-semibold text-[#57534E] mb-1">
                          Biaya Admin (Rp)
                        </label>
                        <input
                          id="edit-admin"
                          type="number"
                          min={0}
                          step={500}
                          value={editAdminFee}
                          onChange={(e) => setEditAdminFee(e.target.value)}
                          className="w-full rounded-lg border border-[#D6D3CB] px-3 py-2 font-mono text-sm"
                        />
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="edit-wallet" className="block text-xs font-semibold text-[#57534E] mb-1">
                        {editingJournal.tx_meta.actionType === 'belanja_utang'
                          ? 'Akun Utang'
                          : editingJournal.tx_meta.actionType === 'saldo_awal'
                            ? 'Akun Aset'
                            : 'Dompet'}
                      </label>
                      <select
                        id="edit-wallet"
                        value={editWalletId}
                        onChange={(e) => setEditWalletId(e.target.value)}
                        className="w-full rounded-lg border border-[#D6D3CB] px-3 py-2 text-sm"
                      >
                        {(editingJournal.tx_meta.actionType === 'belanja_utang'
                          ? db.accounts.filter((a) => a.type === 'LIABILITY')
                          : editingJournal.tx_meta.actionType === 'saldo_awal'
                            ? db.accounts.filter((a) => a.type === 'ASSET')
                            : wallets
                        ).map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} — {a.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {editingJournal.tx_meta.actionType === 'pindah' && (
                      <div>
                        <label htmlFor="edit-to-wallet" className="block text-xs font-semibold text-[#57534E] mb-1">
                          Dompet Tujuan
                        </label>
                        <select
                          id="edit-to-wallet"
                          value={editToWalletId}
                          onChange={(e) => setEditToWalletId(e.target.value)}
                          className="w-full rounded-lg border border-[#D6D3CB] px-3 py-2 text-sm"
                        >
                          {wallets.map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.code} — {w.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {(editingJournal.tx_meta.actionType === 'masuk' ||
                      editingJournal.tx_meta.actionType === 'keluar' ||
                      editingJournal.tx_meta.actionType === 'belanja_utang') && (
                      <div>
                        <label htmlFor="edit-category" className="block text-xs font-semibold text-[#57534E] mb-1">
                          Kategori
                        </label>
                        <select
                          id="edit-category"
                          value={editCategoryId}
                          onChange={(e) => setEditCategoryId(e.target.value)}
                          className="w-full rounded-lg border border-[#D6D3CB] px-3 py-2 text-sm"
                        >
                          {db.accounts
                            .filter((a) =>
                              editingJournal.tx_meta?.actionType === 'masuk'
                                ? a.type === 'REVENUE' || a.code === '3101'
                                : a.type === 'EXPENSE' || a.code === '1501' || a.code === '3102',
                            )
                            .sort((a, b) => a.code.localeCompare(b.code))
                            .map((cat) => (
                              <option key={cat.id} value={cat.id}>
                                {cat.code} — {cat.name}
                              </option>
                            ))}
                        </select>
                      </div>
                    )}

                    {editingJournal.tx_meta.actionType === 'bayar_utang' && (
                      <div>
                        <label htmlFor="edit-debt-acc" className="block text-xs font-semibold text-[#57534E] mb-1">
                          Akun Utang
                        </label>
                        <select
                          id="edit-debt-acc"
                          value={editCategoryId}
                          onChange={(e) => setEditCategoryId(e.target.value)}
                          className="w-full rounded-lg border border-[#D6D3CB] px-3 py-2 text-sm"
                        >
                          {db.accounts
                            .filter((a) => a.type === 'LIABILITY')
                            .sort((a, b) => a.code.localeCompare(b.code))
                            .map((acc) => (
                              <option key={acc.id} value={acc.id}>
                                {acc.code} — {acc.name}
                              </option>
                            ))}
                        </select>
                      </div>
                    )}

                    {(editingJournal.tx_meta.actionType === 'pinjamkan' ||
                      editingJournal.tx_meta.actionType === 'dilunasi') && (
                      <div>
                        <label htmlFor="edit-receivable-acc" className="block text-xs font-semibold text-[#57534E] mb-1">
                          Akun Piutang
                        </label>
                        <select
                          id="edit-receivable-acc"
                          value={editCategoryId}
                          onChange={(e) => setEditCategoryId(e.target.value)}
                          className="w-full rounded-lg border border-[#D6D3CB] px-3 py-2 text-sm"
                        >
                          {db.accounts
                            .filter((a) => a.type === 'ASSET' && a.code.startsWith('12'))
                            .sort((a, b) => a.code.localeCompare(b.code))
                            .map((acc) => (
                              <option key={acc.id} value={acc.id}>
                                {acc.code} — {acc.name}
                              </option>
                            ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {['belanja_utang', 'bayar_utang', 'pinjamkan', 'dilunasi'].includes(
                    editingJournal.tx_meta.actionType,
                  ) && (
                    <div>
                      <label htmlFor="edit-party" className="block text-xs font-semibold text-[#57534E] mb-1">
                        Pihak Terkait
                      </label>
                      <input
                        id="edit-party"
                        type="text"
                        value={editCounterparty}
                        onChange={(e) => setEditCounterparty(e.target.value)}
                        className="w-full rounded-lg border border-[#D6D3CB] px-3 py-2 text-sm"
                      />
                    </div>
                  )}
                </>
              )}

              <div>
                <label htmlFor="edit-tanggal" className="block text-xs font-semibold text-[#57534E] mb-1">
                  Tanggal
                </label>
                <input
                  id="edit-tanggal"
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="w-full rounded-lg border border-[#D6D3CB] px-3 py-2 font-mono text-sm"
                />
              </div>
              <div>
                <label htmlFor="edit-keterangan" className="block text-xs font-semibold text-[#57534E] mb-1">
                  Keterangan
                </label>
                <input
                  id="edit-keterangan"
                  type="text"
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="w-full rounded-lg border border-[#D6D3CB] px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingJournal(null)}
                className="min-h-[44px] rounded-lg border border-[#D6D3CB] px-4 py-2 text-xs font-semibold text-[#18181B]"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                className="min-h-[44px] rounded-lg bg-[#14532D] px-4 py-2 text-xs font-semibold text-white"
              >
                Simpan Perubahan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog: Void Transaction */}
      {confirmVoidId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-[#D6D3CB] bg-white p-4 sm:p-6 space-y-4 shadow-xl">
            <h2 className="font-serif text-lg font-bold text-[#18181B]">
              Batalkan Transaksi (Void)?
            </h2>
            <p className="text-sm text-[#57534E]">
              Sesuai prinsip akuntansi, transaksi tidak dihapus. BukuKu akan menandai jurnal sebagai Void dan membuatkan jurnal pembalik agar saldo dompet dan akun kembali seperti semula.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmVoidId(null)}
                className="min-h-[44px] rounded-lg border border-[#D6D3CB] px-4 py-2 text-xs font-semibold text-[#18181B]"
              >
                Kembali
              </button>
              <button
                type="button"
                onClick={() => {
                  onVoidJournal(confirmVoidId);
                  setConfirmVoidId(null);
                }}
                className="min-h-[44px] rounded-lg bg-[#B91C1C] px-4 py-2 text-xs font-semibold text-white hover:bg-[#991B1B]"
              >
                Ya, Batalkan (Void)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
