import { ArrowDownLeft, ArrowUpRight, BookOpen, PlusCircle, Scale, Wallet } from 'lucide-react';
import type { Account, Journal, JournalLine, LedgerDatabase } from '../core/types';
import { formatBulanTahun, formatRupiahTitle, formatTanggalID } from '../core/format';
import { buildBudgetProgress, buildHomeSummary } from '../core/reports';
import { LazyThreeBalanceScene } from './LazyThreeBalanceScene';

interface BerandaViewProps {
  db: LedgerDatabase;
  currentMonth: string;
  onNavigateCatat: () => void;
  onNavigateBuku: () => void;
  onNavigateTransaksi: () => void;
  onNavigateHutang?: () => void;
  onNavigateBudgets: () => void;
  onOpenFull3D: () => void;
}

export function BerandaView({
  db,
  currentMonth,
  onNavigateCatat,
  onNavigateBuku,
  onNavigateTransaksi,
  onNavigateHutang,
  onNavigateBudgets,
  onOpenFull3D,
}: BerandaViewProps) {
  const summary = buildHomeSummary(db, currentMonth);
  const budgetItems = buildBudgetProgress(db, currentMonth);
  const accountsMap = new Map<string, Account>(db.accounts.map((a) => [a.id, a]));

  const recentJournals = [...db.journals]
    .filter((j) => j.kind !== 'pembalik')
    .sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return b.number.localeCompare(a.number);
    })
    .slice(0, 5);

  const linesByJournal = new Map<string, JournalLine[]>();
  for (const line of db.journalLines) {
    const arr = linesByJournal.get(line.journal_id) ?? [];
    arr.push(line);
    linesByJournal.set(line.journal_id, arr);
  }

  function getJournalAmount(j: Journal): number {
    const lines = linesByJournal.get(j.id) ?? [];
    return lines.reduce((s, l) => s + l.debit, 0);
  }

  function getJournalSubtitle(j: Journal): string {
    const lines = linesByJournal.get(j.id) ?? [];
    const names = lines
      .map((l) => accountsMap.get(l.account_id)?.name)
      .filter(Boolean);
    return names.join(' · ');
  }

  const kasBalance = summary.wallets.find((w) => w.account.code === '1101')?.balance ?? 0;
  const bankBalance = summary.wallets.find((w) => w.account.code === '1102')?.balance ?? 0;
  const ewalletBalance = summary.wallets.find((w) => w.account.code === '1103')?.balance ?? 0;

  return (
    <div className="space-y-8">
      {/* Top Hero Split: Summary Ledger Card + Live 3D Balance Scale */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-5 flex flex-col justify-between rounded-xl border border-[#E5E2DC] bg-white p-5 sm:p-6">
          <div>
            <p className="text-xs font-medium text-[#57534E]">
              {db.settings.businessName} · {db.settings.ownerName}
            </p>
            <h1 className="font-serif text-2xl sm:text-3xl font-bold tracking-tight text-[#18181B] mt-2 text-balance">
              Total Saldo Semua Dompet
            </h1>
            <p
              className="font-mono text-3xl sm:text-4xl font-semibold text-[#14532D] tabular-nums mt-3"
              data-testid="total-wallet-balance"
            >
              {formatRupiahTitle(summary.totalWalletBalance)}
            </p>
          </div>

          <div className="mt-6 pt-5 border-t border-[#E5E2DC] space-y-3">
            <p className="text-xs font-semibold text-[#57534E]">
              Ringkasan {formatBulanTahun(currentMonth)}
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center gap-1.5 text-xs text-[#57534E]">
                  <ArrowDownLeft className="w-3.5 h-3.5 text-[#15803D]" />
                  <span>Pemasukan</span>
                </div>
                <p className="font-mono text-base font-semibold text-[#15803D] tabular-nums mt-1">
                  {formatRupiahTitle(summary.monthlyIncome)}
                </p>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-xs text-[#57534E]">
                  <ArrowUpRight className="w-3.5 h-3.5 text-[#B91C1C]" />
                  <span>Pengeluaran</span>
                </div>
                <p className="font-mono text-base font-semibold text-[#B91C1C] tabular-nums mt-1">
                  {formatRupiahTitle(summary.monthlyExpense)}
                </p>
              </div>
            </div>

            <div className="pt-3 border-t border-[#F0EDE6] flex items-center justify-between gap-2">
              <span className="text-xs text-[#57534E]">Selisih / Laba Bersih Bulan Ini</span>
              <span
                className={`font-mono text-sm font-semibold tabular-nums ${
                  summary.monthlyNet >= 0 ? 'text-[#14532D]' : 'text-[#B91C1C]'
                }`}
              >
                {formatRupiahTitle(summary.monthlyNet)}
              </span>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onNavigateCatat}
              className="flex-1 sm:flex-initial min-h-[44px] inline-flex items-center justify-center gap-2 rounded-lg bg-[#14532D] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#166534] whitespace-nowrap shrink-0"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Catat Transaksi</span>
            </button>
            <button
              type="button"
              onClick={onNavigateBuku}
              className="flex-1 sm:flex-initial min-h-[44px] inline-flex items-center justify-center gap-2 rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-4 py-2.5 text-sm font-semibold text-[#18181B] hover:bg-[#EFECE5] whitespace-nowrap shrink-0"
            >
              <BookOpen className="w-4 h-4" />
              <span>Buka Laporan Buku</span>
            </button>
          </div>
        </div>

        <div className="lg:col-span-7 flex flex-col">
          <LazyThreeBalanceScene
            metrics={{
              kasBalance,
              bankBalance,
              ewalletBalance,
              totalAssets: summary.totalAssets,
              totalDebt: summary.totalDebt,
              totalEquity: summary.totalEquity,
              monthlyNet: summary.monthlyNet,
            }}
            onToggleFullScreen={onOpenFull3D}
          />
        </div>
      </section>

      {/* Wallet Breakdown + Debt/Receivable Strip */}
      <section aria-labelledby="dompet-heading">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 id="dompet-heading" className="font-serif text-lg font-bold text-[#18181B]">
            Rincian Saldo Dompet &amp; Posisi
          </h2>
          {onNavigateHutang ? (
            <button
              type="button"
              onClick={onNavigateHutang}
              className="text-xs font-semibold text-[#14532D] hover:underline min-h-[36px] flex items-center"
            >
              Kelola Hutang &amp; Piutang
            </button>
          ) : (
            <span className="text-xs text-[#57534E]">Dihitung langsung dari baris jurnal</span>
          )}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
          {summary.wallets.map((w) => (
            <div
              key={w.account.id}
              className="rounded-xl border border-[#E5E2DC] bg-white p-4 flex flex-col justify-between"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-[#18181B] truncate">
                  {w.account.name}
                </span>
                <Wallet className="w-4 h-4 text-[#57534E] shrink-0" />
              </div>
              <div className="mt-3">
                <p className="font-mono text-base sm:text-lg font-semibold text-[#18181B] tabular-nums truncate">
                  {formatRupiahTitle(w.balance)}
                </p>
                <p className="text-xs text-[#57534E] font-mono mt-0.5">Akun {w.account.code}</p>
              </div>
            </div>
          ))}

          <div className="rounded-xl border border-[#E5E2DC] bg-white p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-[#18181B]">Piutang</span>
              <Scale className="w-4 h-4 text-[#57534E] shrink-0" />
            </div>
            <div className="mt-3">
              <p className="font-mono text-base sm:text-lg font-semibold text-[#14532D] tabular-nums truncate">
                {formatRupiahTitle(summary.totalReceivable)}
              </p>
              <p className="text-xs text-[#57534E] mt-0.5">Uang dipinjamkan</p>
            </div>
          </div>

          <div className="rounded-xl border border-[#E5E2DC] bg-white p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-[#18181B]">Utang</span>
              <Scale className="w-4 h-4 text-[#57534E] shrink-0" />
            </div>
            <div className="mt-3">
              <p className="font-mono text-base sm:text-lg font-semibold text-[#B91C1C] tabular-nums truncate">
                {formatRupiahTitle(summary.totalDebt)}
              </p>
              <p className="text-xs text-[#57534E] mt-0.5">Kewajiban aktif</p>
            </div>
          </div>
        </div>
      </section>

      {/* Monthly Budgets Progress */}
      <section aria-labelledby="anggaran-heading" className="rounded-xl border border-[#E5E2DC] bg-white p-6 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 id="anggaran-heading" className="font-serif text-lg font-bold text-[#18181B]">
              Anggaran Pengeluaran {formatBulanTahun(currentMonth)}
            </h2>
            <p className="text-xs text-[#57534E]">
              Pemantauan batas belanja bulanan per kategori akun beban
            </p>
          </div>
          <button
            type="button"
            onClick={onNavigateBudgets}
            className="text-xs font-semibold text-[#14532D] hover:underline whitespace-nowrap shrink-0"
          >
            Atur anggaran
          </button>
        </div>

        {budgetItems.length === 0 ? (
          <p className="text-xs text-[#57534E]">
            Belum ada target anggaran bulanan. Klik &ldquo;Atur anggaran&rdquo; untuk menetapkan batas belanja kategori.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {budgetItems.map((b) => {
              const barColor =
                b.status === 'melebihi'
                  ? 'bg-[#B91C1C]'
                  : b.status === 'mendekati'
                    ? 'bg-[#B45309]'
                    : 'bg-[#14532D]';
              const statusText =
                b.status === 'melebihi'
                  ? 'Melebihi Anggaran'
                  : b.status === 'mendekati'
                    ? 'Mendekati Batas'
                    : 'Aman';
              const statusColor =
                b.status === 'melebihi'
                  ? 'text-[#B91C1C]'
                  : b.status === 'mendekati'
                    ? 'text-[#B45309]'
                    : 'text-[#14532D]';
              const fillPct = Math.min(100, Math.max(0, b.percentUsed));

              return (
                <div key={b.account.id} className="rounded-lg border border-[#E5E2DC] bg-[#F8F7F4] p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-[#18181B]">
                      {b.account.code} · {b.account.name}
                    </span>
                    <span className={`font-semibold ${statusColor}`}>
                      {statusText} ({b.percentUsed}%)
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-[#E5E2DC] overflow-hidden">
                    <div
                      className={`h-full rounded-full ${barColor}`}
                      style={{ width: `${fillPct}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-[#57534E] font-mono tabular-nums">
                    <span>Terpakai {formatRupiahTitle(b.spent)}</span>
                    <span>Batas {formatRupiahTitle(b.budget)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Recent Transactions Preview */}
      <section className="rounded-xl border border-[#E5E2DC] bg-white overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E2DC]">
          <div>
            <h2 className="font-serif text-lg font-bold text-[#18181B]">Transaksi Terakhir</h2>
            <p className="text-xs text-[#57534E]">
              Setiap catatan otomatis tersimpan sebagai jurnal debit-kredit seimbang
            </p>
          </div>
          <button
            type="button"
            onClick={onNavigateTransaksi}
            className="text-sm font-semibold text-[#14532D] hover:underline whitespace-nowrap shrink-0"
          >
            Lihat semua
          </button>
        </div>

        {recentJournals.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-[#57534E]">Belum ada transaksi tercatat.</p>
            <button
              type="button"
              onClick={onNavigateCatat}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#14532D] px-4 py-2 text-xs font-semibold text-white"
            >
              Catat Transaksi Pertama
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-[#F0EDE6]">
            {recentJournals.map((j) => (
              <li
                key={j.id}
                className={`px-6 py-3.5 flex items-center justify-between gap-4 ${
                  j.voided_at ? 'opacity-55' : ''
                }`}
              >
                <div className="min-w-0">
                  <p className={`text-sm font-semibold text-[#18181B] truncate ${j.voided_at ? 'line-through' : ''}`}>
                    {j.description}
                  </p>
                  <p className="text-xs text-[#57534E] mt-0.5 truncate">
                    <span className="font-mono">{formatTanggalID(j.date)}</span>
                    <span aria-hidden="true"> · </span>
                    <span className="font-mono">{j.number}</span>
                    <span aria-hidden="true"> · </span>
                    <span>{getJournalSubtitle(j)}</span>
                    {j.voided_at && <span> · Dibatalkan (Void)</span>}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-mono text-sm font-semibold text-[#18181B] tabular-nums">
                    {formatRupiahTitle(getJournalAmount(j))}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
