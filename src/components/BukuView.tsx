import { useMemo, useState } from 'react';
import { Download, FileSpreadsheet, Maximize2, Minimize2 } from 'lucide-react';
import type { LedgerDatabase } from '../core/types';
import {
  currentLocalMonth,
  endOfMonthDate,
  formatBulanTahun,
  formatKolomAngka,
  formatPeriodeBerakhir,
  formatPerTanggal,
  formatRupiahTitle,
  formatTanggalID,
  todayLocalDate,
} from '../core/format';
import {
  buildBukuBesar,
  buildBukuKas,
  buildJurnalUmum,
  buildLabaRugi,
  buildNeraca,
  buildNeracaSaldo,
} from '../core/reports';
import {
  exportBukuBesarCSV,
  exportBukuKasCSV,
  exportJurnalUmumCSV,
  exportLabaRugiCSV,
  exportNeracaCSV,
  exportNeracaSaldoCSV,
  triggerFileDownload,
} from '../services/storage';
import {
  exportBukuBesarPDF,
  exportBukuKasPDF,
  exportJurnalUmumPDF,
  exportLabaRugiPDF,
  exportNeracaPDF,
  exportNeracaSaldoPDF,
} from '../services/pdfExport';

interface BukuViewProps {
  db: LedgerDatabase;
}

type ReportTab = 'jurnal' | 'buku_besar' | 'buku_kas' | 'neraca' | 'neraca_posisi' | 'laba_rugi';

export function BukuView({ db }: BukuViewProps) {
  const [reportTab, setReportTab] = useState<ReportTab>('jurnal');
  const [viewMode, setViewMode] = useState<'buku' | 'simple'>('buku');
  const [month, setMonth] = useState<string>(currentLocalMonth());
  const [selectedAccountId, setSelectedAccountId] = useState<string>('acc-1101');
  const [selectedWalletId, setSelectedWalletId] = useState<string>('all');
  const [wideLandscape, setWideLandscape] = useState<boolean>(false);

  const availableMonths = useMemo(() => {
    const set = new Set<string>([currentLocalMonth()]);
    for (const j of db.journals) {
      set.add(j.date.slice(0, 7));
    }
    return Array.from(set).sort().reverse();
  }, [db.journals]);

  const sortedAccounts = useMemo(
    () => [...db.accounts].sort((a, b) => a.code.localeCompare(b.code)),
    [db.accounts],
  );

  const walletAccounts = useMemo(
    () =>
      sortedAccounts.filter(
        (a) => a.is_wallet || ['1101', '1102', '1103'].includes(a.code),
      ),
    [sortedAccounts],
  );

  const jurnalEntries = useMemo(
    () =>
      buildJurnalUmum(db, {
        month: month === 'all' ? 'all' : month,
        includeReversals: viewMode === 'buku',
      }),
    [db, month, viewMode],
  );

  const bukuBesar = useMemo(
    () => buildBukuBesar(db, selectedAccountId, { month }),
    [db, selectedAccountId, month],
  );

  const bukuKas = useMemo(
    () =>
      buildBukuKas(db, {
        month,
        walletAccountId: selectedWalletId === 'all' ? undefined : selectedWalletId,
      }),
    [db, month, selectedWalletId],
  );

  const neracaUpTo = month === 'all' ? undefined : endOfMonthDate(month);
  const neracaSaldo = useMemo(() => buildNeracaSaldo(db, neracaUpTo), [db, neracaUpTo]);
  const neracaPosisi = useMemo(() => buildNeraca(db, neracaUpTo), [db, neracaUpTo]);
  const labaRugi = useMemo(() => buildLabaRugi(db, month), [db, month]);

  const reportHeader = useMemo(() => {
    const periodLabel =
      reportTab === 'neraca' || reportTab === 'neraca_posisi'
        ? formatPerTanggal(neracaUpTo ?? todayLocalDate())
        : month === 'all'
          ? `Semua Periode (${formatPerTanggal(todayLocalDate())})`
          : formatPeriodeBerakhir(month);

    const titles: Record<ReportTab, string> = {
      jurnal: 'JURNAL UMUM',
      buku_besar: `BUKU BESAR — ${(bukuBesar?.account.code ?? '')} ${(bukuBesar?.account.name ?? '').toUpperCase()}`,
      buku_kas: 'BUKU KAS & DOMPET',
      neraca: 'NERACA SALDO',
      neraca_posisi: 'NERACA (POSISI KEUANGAN)',
      laba_rugi: 'LAPORAN LABA RUGI',
    };

    return {
      owner: db.settings.ownerName,
      title: titles[reportTab],
      period: periodLabel,
    };
  }, [reportTab, db.settings.ownerName, month, neracaUpTo, bukuBesar]);

  const handleExportPDF = () => {
    if (reportTab === 'jurnal') exportJurnalUmumPDF(db, month);
    else if (reportTab === 'buku_besar') exportBukuBesarPDF(db, selectedAccountId, month);
    else if (reportTab === 'buku_kas')
      exportBukuKasPDF(db, selectedWalletId === 'all' ? undefined : selectedWalletId, month);
    else if (reportTab === 'neraca') exportNeracaSaldoPDF(db, month);
    else if (reportTab === 'neraca_posisi') exportNeracaPDF(db, month);
    else exportLabaRugiPDF(db, month);
  };

  const handleExportCSV = () => {
    if (reportTab === 'jurnal') {
      triggerFileDownload(
        `BukuKu-Jurnal-Umum-${month}.csv`,
        exportJurnalUmumCSV(db, month),
        'text/csv;charset=utf-8;',
      );
    } else if (reportTab === 'buku_besar') {
      triggerFileDownload(
        `BukuKu-Buku-Besar-${bukuBesar?.account.code ?? 'akun'}-${month}.csv`,
        exportBukuBesarCSV(db, selectedAccountId, month),
        'text/csv;charset=utf-8;',
      );
    } else if (reportTab === 'buku_kas') {
      triggerFileDownload(
        `BukuKu-Buku-Kas-${selectedWalletId === 'all' ? 'semua' : selectedWalletId}-${month}.csv`,
        exportBukuKasCSV(db, month, selectedWalletId === 'all' ? undefined : selectedWalletId),
        'text/csv;charset=utf-8;',
      );
    } else if (reportTab === 'neraca') {
      triggerFileDownload(
        `BukuKu-Neraca-Saldo-${month}.csv`,
        exportNeracaSaldoCSV(db, neracaUpTo),
        'text/csv;charset=utf-8;',
      );
    } else if (reportTab === 'neraca_posisi') {
      triggerFileDownload(
        `BukuKu-Neraca-${month}.csv`,
        exportNeracaCSV(db, neracaUpTo),
        'text/csv;charset=utf-8;',
      );
    } else {
      triggerFileDownload(
        `BukuKu-Laba-Rugi-${month}.csv`,
        exportLabaRugiCSV(db, month),
        'text/csv;charset=utf-8;',
      );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Sakelar Simple / Buku */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-bold text-[#18181B]">Buku Akuntansi</h1>
          <p className="text-sm text-[#57534E]">
            Laporan akuntansi resmi Indonesia dalam format buku bergaris dan siap ekspor PDF/CSV.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Sakelar Simple / Buku */}
          <div className="inline-flex items-center gap-1 rounded-lg bg-[#EBE8E0] p-1" role="group" aria-label="Mode tampilan laporan">
            <button
              type="button"
              aria-pressed={viewMode === 'simple'}
              onClick={() => setViewMode('simple')}
              className={`min-h-[40px] px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap ${
                viewMode === 'simple'
                  ? 'bg-white text-[#14532D] shadow-sm'
                  : 'text-[#57534E] hover:text-[#18181B]'
              }`}
            >
              Mode Simple
            </button>
            <button
              type="button"
              aria-pressed={viewMode === 'buku'}
              onClick={() => setViewMode('buku')}
              className={`min-h-[40px] px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap ${
                viewMode === 'buku'
                  ? 'bg-white text-[#14532D] shadow-sm'
                  : 'text-[#57534E] hover:text-[#18181B]'
              }`}
            >
              Mode Buku
            </button>
          </div>

          <select
            aria-label="Pilih periode bulan"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="min-h-[40px] rounded-lg border border-[#D6D3CB] bg-white px-3 py-2 text-xs font-semibold text-[#18181B]"
          >
            <option value="all">Semua Periode</option>
            {availableMonths.map((m) => (
              <option key={m} value={m}>
                {formatBulanTahun(m)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Report Selector Tabs & Export Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E5E2DC] pb-3">
        <div className="flex flex-wrap items-center gap-2">
          {[
            { id: 'jurnal', label: 'Jurnal Umum' },
            { id: 'buku_besar', label: 'Buku Besar' },
            { id: 'buku_kas', label: 'Buku Kas' },
            { id: 'neraca', label: 'Neraca Saldo' },
            { id: 'neraca_posisi', label: 'Neraca' },
            { id: 'laba_rugi', label: 'Laba Rugi' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={reportTab === t.id}
              onClick={() => setReportTab(t.id as ReportTab)}
              className={`min-h-[40px] px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 ${
                reportTab === t.id
                  ? 'bg-[#14532D] text-white'
                  : 'bg-white border border-[#E5E2DC] text-[#57534E] hover:text-[#18181B]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setWideLandscape((v) => !v)}
            className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-[#D6D3CB] bg-white px-3 py-2 text-xs font-semibold text-[#18181B] hover:bg-[#F3F1EB] whitespace-nowrap"
          >
            {wideLandscape ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            <span>{wideLandscape ? 'Lebar Normal' : 'Mode Lebar'}</span>
          </button>

          <button
            type="button"
            onClick={handleExportCSV}
            className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-[#D6D3CB] bg-white px-3 py-2 text-xs font-semibold text-[#18181B] hover:bg-[#F3F1EB] whitespace-nowrap"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Ekspor CSV</span>
          </button>

          <button
            type="button"
            onClick={handleExportPDF}
            className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg bg-[#14532D] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#166534] whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Ekspor PDF</span>
          </button>
        </div>

        {reportTab === 'buku_besar' && (
          <select
            aria-label="Pilih akun buku besar"
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            className="min-h-[40px] ml-auto rounded-lg border border-[#D6D3CB] bg-white px-3 py-2 text-xs font-semibold text-[#18181B]"
          >
            {sortedAccounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.code} — {acc.name}
              </option>
            ))}
          </select>
        )}

        {reportTab === 'buku_kas' && (
          <select
            aria-label="Pilih dompet buku kas"
            value={selectedWalletId}
            onChange={(e) => setSelectedWalletId(e.target.value)}
            className="min-h-[40px] ml-auto rounded-lg border border-[#D6D3CB] bg-white px-3 py-2 text-xs font-semibold text-[#18181B]"
          >
            <option value="all">Semua Dompet (Kas + Bank + E-Wallet)</option>
            {walletAccounts.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} — {w.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Ledger Sheet Container */}
      <div
        className={`rounded-xl border border-[#D6D3CB] bg-white p-4 sm:p-8 shadow-sm ${
          wideLandscape ? 'min-w-full overflow-x-auto' : ''
        }`}
      >
        {/* Indonesian Accounting Report Header */}
        <div className="text-center pb-5 mb-6 border-b border-[#D6D3CB]">
          <p className="text-sm font-medium text-[#57534E]">{reportHeader.owner}</p>
          <h2 className="font-serif text-xl sm:text-2xl font-bold tracking-wide text-[#18181B] mt-0.5 uppercase">
            {reportHeader.title}
          </h2>
          <p className="text-sm text-[#18181B] mt-1">{reportHeader.period}</p>
          <p className="text-xs italic text-[#57534E] mt-0.5">(Dalam Rupiah)</p>
        </div>

        {/* 1. JURNAL UMUM */}
        {reportTab === 'jurnal' && (
          <div className="overflow-x-auto">
            {viewMode === 'simple' ? (
              <table className="w-full min-w-[640px] border-collapse border border-[#C8C3B8] text-sm">
                <thead>
                  <tr className="bg-[#14532D] text-white text-xs font-semibold">
                    <th className="sticky left-0 z-10 bg-[#14532D] border border-[#1E6B3D] px-3 py-2.5 text-center w-28">
                      Tanggal
                    </th>
                    <th className="border border-[#1E6B3D] px-3 py-2.5 text-left">Keterangan</th>
                    <th className="border border-[#1E6B3D] px-3 py-2.5 text-left">Akun Terkait</th>
                    <th className="border border-[#1E6B3D] px-3 py-2.5 text-right w-36">Nominal</th>
                  </tr>
                </thead>
                <tbody>
                  {jurnalEntries.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="border border-[#C8C3B8] px-4 py-8 text-center text-[#57534E]">
                        Belum ada jurnal pada periode ini.
                      </td>
                    </tr>
                  ) : (
                    jurnalEntries.map((entry) => (
                      <tr key={entry.journal.id} className="hover:bg-[#FAF9F6]">
                        <td className="sticky left-0 z-10 bg-white border border-[#C8C3B8] px-3 py-2 text-center font-mono text-xs whitespace-nowrap">
                          {formatTanggalID(entry.journal.date)}
                        </td>
                        <td className="border border-[#C8C3B8] px-3 py-2">
                          <span className="font-medium text-[#18181B]">{entry.journal.description}</span>
                          <span className="ml-2 font-mono text-xs text-[#57534E]">{entry.journal.number}</span>
                        </td>
                        <td className="border border-[#C8C3B8] px-3 py-2 text-xs text-[#57534E]">
                          {entry.lines.map((l) => `${l.account.name} (${l.line.debit > 0 ? 'D' : 'K'})`).join(' · ')}
                        </td>
                        <td className="border border-[#C8C3B8] px-3 py-2 text-right font-mono tabular-nums font-medium">
                          {formatKolomAngka(entry.totalDebit)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            ) : (
              <table className="w-full min-w-[700px] border-collapse border border-[#C8C3B8] text-sm">
                <thead>
                  <tr className="bg-[#14532D] text-white text-xs font-semibold">
                    <th className="sticky left-0 z-10 bg-[#14532D] border border-[#1E6B3D] px-3 py-2.5 text-center w-28">
                      Tanggal
                    </th>
                    <th className="border border-[#1E6B3D] px-3 py-2.5 text-left">Keterangan</th>
                    <th className="border border-[#1E6B3D] px-3 py-2.5 text-center w-20">Ref</th>
                    <th className="border border-[#1E6B3D] px-3 py-2.5 text-right w-36">Debit</th>
                    <th className="border border-[#1E6B3D] px-3 py-2.5 text-right w-36">Kredit</th>
                  </tr>
                </thead>
                <tbody>
                  {jurnalEntries.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="border border-[#C8C3B8] px-4 py-8 text-center text-[#57534E]">
                        Belum ada jurnal pada periode ini.
                      </td>
                    </tr>
                  ) : (
                    jurnalEntries.flatMap((entry) => {
                      const isVoided = Boolean(entry.journal.voided_at);
                      const rows = entry.lines.map((item, idx) => {
                        const isCredit = item.line.credit > 0;
                        return (
                          <tr
                            key={item.line.id}
                            className={`hover:bg-[#FAF9F6] ${isVoided ? 'opacity-60' : ''}`}
                          >
                            <td className="sticky left-0 z-10 bg-white border border-[#C8C3B8] px-3 py-1.5 text-center font-mono text-xs whitespace-nowrap">
                              {idx === 0 ? formatTanggalID(entry.journal.date) : ''}
                            </td>
                            <td
                              className={`border border-[#C8C3B8] px-3 py-1.5 ${
                                isCredit ? 'pl-10' : 'font-medium'
                              } ${isVoided ? 'line-through' : ''}`}
                            >
                              {item.account.name}
                            </td>
                            <td className="border border-[#C8C3B8] px-3 py-1.5 text-center font-mono text-xs text-[#57534E]">
                              {item.account.code}
                            </td>
                            <td className="border border-[#C8C3B8] px-3 py-1.5 text-right font-mono tabular-nums">
                              {formatKolomAngka(item.line.debit)}
                            </td>
                            <td className="border border-[#C8C3B8] px-3 py-1.5 text-right font-mono tabular-nums">
                              {formatKolomAngka(item.line.credit)}
                            </td>
                          </tr>
                        );
                      });

                      rows.push(
                        <tr key={`${entry.journal.id}-desc`} className="bg-[#FAF9F6]">
                          <td className="sticky left-0 z-10 bg-[#FAF9F6] border border-[#C8C3B8] px-3 py-1" />
                          <td className="border border-[#C8C3B8] px-3 py-1 italic text-xs text-[#57534E]">
                            ({entry.journal.description})
                            {isVoided && ' — VOID'}
                          </td>
                          <td className="border border-[#C8C3B8] px-3 py-1 text-center font-mono text-[11px] text-[#57534E]">
                            {entry.journal.number}
                          </td>
                          <td className="border border-[#C8C3B8] px-3 py-1" />
                          <td className="border border-[#C8C3B8] px-3 py-1" />
                        </tr>,
                      );

                      return rows;
                    })
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-[#F3F1EB] font-bold">
                    <td colSpan={3} className="border border-[#C8C3B8] px-3 py-2.5 text-right">
                      TOTAL JURNAL UMUM
                    </td>
                    <td className="border border-[#C8C3B8] px-3 py-2.5 text-right font-mono tabular-nums">
                      {formatRupiahTitle(jurnalEntries.reduce((s, e) => s + e.totalDebit, 0))}
                    </td>
                    <td className="border border-[#C8C3B8] px-3 py-2.5 text-right font-mono tabular-nums">
                      {formatRupiahTitle(jurnalEntries.reduce((s, e) => s + e.totalCredit, 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        )}

        {/* 2. BUKU BESAR */}
        {reportTab === 'buku_besar' && bukuBesar && (
          <div className="overflow-x-auto space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#57534E]">
              <span>
                Saldo Normal: <strong className="text-[#18181B]">{bukuBesar.account.normal_balance}</strong>
              </span>
              <span>
                Saldo Akhir: <strong className="font-mono text-sm text-[#14532D]">{formatRupiahTitle(bukuBesar.closingBalance)}</strong>
              </span>
            </div>
            <table className="w-full min-w-[720px] border-collapse border border-[#C8C3B8] text-sm">
              <thead>
                <tr className="bg-[#14532D] text-white text-xs font-semibold">
                  <th className="sticky left-0 z-10 bg-[#14532D] border border-[#1E6B3D] px-3 py-2.5 text-center w-28">
                    Tanggal
                  </th>
                  <th className="border border-[#1E6B3D] px-3 py-2.5 text-left">Keterangan</th>
                  <th className="border border-[#1E6B3D] px-3 py-2.5 text-center w-24">Ref</th>
                  <th className="border border-[#1E6B3D] px-3 py-2.5 text-right w-32">Debit</th>
                  <th className="border border-[#1E6B3D] px-3 py-2.5 text-right w-32">Kredit</th>
                  <th className="border border-[#1E6B3D] px-3 py-2.5 text-right w-36">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {bukuBesar.openingBalance !== 0 && (
                  <tr className="bg-[#FAF9F6] font-medium">
                    <td className="sticky left-0 z-10 bg-[#FAF9F6] border border-[#C8C3B8] px-3 py-2 text-center font-mono text-xs">
                      -
                    </td>
                    <td className="border border-[#C8C3B8] px-3 py-2 italic">Saldo Awal Periode</td>
                    <td className="border border-[#C8C3B8] px-3 py-2 text-center">-</td>
                    <td className="border border-[#C8C3B8] px-3 py-2 text-right">-</td>
                    <td className="border border-[#C8C3B8] px-3 py-2 text-right">-</td>
                    <td className="border border-[#C8C3B8] px-3 py-2 text-right font-mono tabular-nums font-semibold">
                      {formatKolomAngka(bukuBesar.openingBalance)}
                    </td>
                  </tr>
                )}
                {bukuBesar.rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="border border-[#C8C3B8] px-4 py-8 text-center text-[#57534E]">
                      Belum ada mutasi pada akun ini di periode terpilih.
                    </td>
                  </tr>
                ) : (
                  bukuBesar.rows.map((row, idx) => (
                    <tr
                      key={`${row.journalId}-${idx}`}
                      className={`hover:bg-[#FAF9F6] ${row.isVoided ? 'opacity-60' : ''}`}
                    >
                      <td className="sticky left-0 z-10 bg-white border border-[#C8C3B8] px-3 py-2 text-center font-mono text-xs whitespace-nowrap">
                        {formatTanggalID(row.date)}
                      </td>
                      <td
                        className={`border border-[#C8C3B8] px-3 py-2 ${
                          row.isVoided ? 'line-through' : ''
                        }`}
                      >
                        {row.description}
                        {row.isVoided && (
                          <span className="ml-1.5 text-[11px] font-semibold no-underline text-[#B91C1C]">
                            ({row.kind === 'pembalik' ? 'Pembalik' : 'Void'})
                          </span>
                        )}
                      </td>
                      <td className="border border-[#C8C3B8] px-3 py-2 text-center font-mono text-xs text-[#57534E]">
                        {row.ref}
                      </td>
                      <td className="border border-[#C8C3B8] px-3 py-2 text-right font-mono tabular-nums">
                        {formatKolomAngka(row.debit)}
                      </td>
                      <td className="border border-[#C8C3B8] px-3 py-2 text-right font-mono tabular-nums">
                        {formatKolomAngka(row.credit)}
                      </td>
                      <td className="border border-[#C8C3B8] px-3 py-2 text-right font-mono tabular-nums font-semibold">
                        {formatKolomAngka(row.runningBalance)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* 3. BUKU KAS */}
        {reportTab === 'buku_kas' && (
          <div className="overflow-x-auto space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm border border-[#E5E2DC] rounded-lg p-4 bg-[#F8F7F4]">
              <div>
                <p className="text-xs text-[#57534E]">Total Kas Masuk</p>
                <p className="font-mono font-semibold text-[#15803D] tabular-nums mt-0.5">
                  {formatRupiahTitle(bukuKas.totalMasuk)}
                </p>
              </div>
              <div>
                <p className="text-xs text-[#57534E]">Total Kas Keluar</p>
                <p className="font-mono font-semibold text-[#B91C1C] tabular-nums mt-0.5">
                  {formatRupiahTitle(bukuKas.totalKeluar)}
                </p>
              </div>
              <div>
                <p className="text-xs text-[#57534E]">Saldo Akhir Kas &amp; Dompet</p>
                <p className="font-mono font-bold text-[#14532D] tabular-nums mt-0.5">
                  {formatRupiahTitle(bukuKas.closingBalance)}
                </p>
              </div>
            </div>

            <table className="w-full min-w-[720px] border-collapse border border-[#C8C3B8] text-sm">
              <thead>
                <tr className="bg-[#14532D] text-white text-xs font-semibold">
                  <th className="sticky left-0 z-10 bg-[#14532D] border border-[#1E6B3D] px-3 py-2.5 text-center w-28">
                    Tanggal
                  </th>
                  <th className="border border-[#1E6B3D] px-3 py-2.5 text-left">Keterangan</th>
                  <th className="border border-[#1E6B3D] px-3 py-2.5 text-left w-32">Dompet</th>
                  <th className="border border-[#1E6B3D] px-3 py-2.5 text-center w-24">Ref</th>
                  <th className="border border-[#1E6B3D] px-3 py-2.5 text-right w-32">Masuk (D)</th>
                  <th className="border border-[#1E6B3D] px-3 py-2.5 text-right w-32">Keluar (K)</th>
                  <th className="border border-[#1E6B3D] px-3 py-2.5 text-right w-36">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {bukuKas.openingBalance !== 0 && (
                  <tr className="bg-[#FAF9F6] font-medium">
                    <td className="sticky left-0 z-10 bg-[#FAF9F6] border border-[#C8C3B8] px-3 py-2 text-center font-mono text-xs">
                      -
                    </td>
                    <td className="border border-[#C8C3B8] px-3 py-2 italic">Saldo Awal Periode</td>
                    <td className="border border-[#C8C3B8] px-3 py-2 text-xs text-[#57534E]">-</td>
                    <td className="border border-[#C8C3B8] px-3 py-2 text-center">-</td>
                    <td className="border border-[#C8C3B8] px-3 py-2 text-right">-</td>
                    <td className="border border-[#C8C3B8] px-3 py-2 text-right">-</td>
                    <td className="border border-[#C8C3B8] px-3 py-2 text-right font-mono tabular-nums font-semibold">
                      {formatKolomAngka(bukuKas.openingBalance)}
                    </td>
                  </tr>
                )}
                {bukuKas.rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="border border-[#C8C3B8] px-4 py-8 text-center text-[#57534E]">
                      Belum ada mutasi kas pada periode ini.
                    </td>
                  </tr>
                ) : (
                  bukuKas.rows.map((row, idx) => (
                    <tr
                      key={`${row.journalId}-${idx}`}
                      className={`hover:bg-[#FAF9F6] ${row.isVoided ? 'opacity-60' : ''}`}
                    >
                      <td className="sticky left-0 z-10 bg-white border border-[#C8C3B8] px-3 py-2 text-center font-mono text-xs whitespace-nowrap">
                        {formatTanggalID(row.date)}
                      </td>
                      <td
                        className={`border border-[#C8C3B8] px-3 py-2 ${
                          row.isVoided ? 'line-through' : ''
                        }`}
                      >
                        {row.description}
                        {row.isVoided && (
                          <span className="ml-1.5 text-[11px] font-semibold no-underline text-[#B91C1C]">
                            ({row.kind === 'pembalik' ? 'Pembalik' : 'Void'})
                          </span>
                        )}
                      </td>
                      <td className="border border-[#C8C3B8] px-3 py-2 text-xs text-[#57534E]">
                        {row.walletCode} · {row.walletName}
                      </td>
                      <td className="border border-[#C8C3B8] px-3 py-2 text-center font-mono text-xs text-[#57534E]">
                        {row.ref}
                      </td>
                      <td className="border border-[#C8C3B8] px-3 py-2 text-right font-mono tabular-nums">
                        {formatKolomAngka(row.debit)}
                      </td>
                      <td className="border border-[#C8C3B8] px-3 py-2 text-right font-mono tabular-nums">
                        {formatKolomAngka(row.credit)}
                      </td>
                      <td className="border border-[#C8C3B8] px-3 py-2 text-right font-mono tabular-nums font-semibold">
                        {formatKolomAngka(row.runningBalance)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* 4. NERACA SALDO */}
        {reportTab === 'neraca' && (
          <div className="overflow-x-auto space-y-4">
            <table className="w-full min-w-[600px] border-collapse border border-[#C8C3B8] text-sm">
              <thead>
                <tr className="bg-[#14532D] text-white text-xs font-semibold">
                  <th className="border border-[#1E6B3D] px-3 py-2.5 text-center w-28">No. Akun</th>
                  <th className="border border-[#1E6B3D] px-3 py-2.5 text-left">Akun</th>
                  <th className="border border-[#1E6B3D] px-3 py-2.5 text-right w-40">Debit</th>
                  <th className="border border-[#1E6B3D] px-3 py-2.5 text-right w-40">Kredit</th>
                </tr>
              </thead>
              <tbody>
                {neracaSaldo.rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="border border-[#C8C3B8] px-4 py-8 text-center text-[#57534E]">
                      Belum ada saldo akun tercatat.
                    </td>
                  </tr>
                ) : (
                  neracaSaldo.rows.map((r) => (
                    <tr key={r.account.id} className="hover:bg-[#FAF9F6]">
                      <td className="border border-[#C8C3B8] px-3 py-2 text-center font-mono text-xs">
                        {r.account.code}
                      </td>
                      <td className="border border-[#C8C3B8] px-3 py-2 font-medium">
                        {r.account.name}
                      </td>
                      <td className="border border-[#C8C3B8] px-3 py-2 text-right font-mono tabular-nums">
                        {formatKolomAngka(r.debit)}
                      </td>
                      <td className="border border-[#C8C3B8] px-3 py-2 text-right font-mono tabular-nums">
                        {formatKolomAngka(r.credit)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="bg-[#F3F1EB] font-bold">
                  <td colSpan={2} className="border border-[#C8C3B8] px-3 py-2.5 text-right">
                    TOTAL NERACA SALDO
                  </td>
                  <td
                    className="border border-[#C8C3B8] px-3 py-2.5 text-right font-mono tabular-nums"
                    data-testid="neraca-total-debit"
                  >
                    {formatRupiahTitle(neracaSaldo.totalDebit)}
                  </td>
                  <td
                    className="border border-[#C8C3B8] px-3 py-2.5 text-right font-mono tabular-nums"
                    data-testid="neraca-total-credit"
                  >
                    {formatRupiahTitle(neracaSaldo.totalCredit)}
                  </td>
                </tr>
              </tfoot>
            </table>

            <p
              className={`text-xs font-semibold ${
                neracaSaldo.isBalanced ? 'text-[#14532D]' : 'text-[#B91C1C]'
              }`}
            >
              {neracaSaldo.isBalanced
                ? 'Status Neraca: Seimbang (Total Debit = Total Kredit)'
                : 'Peringatan: Total Debit dan Kredit belum seimbang'}
            </p>
          </div>
        )}

        {/* 4B. NERACA (POSISI KEUANGAN) */}
        {reportTab === 'neraca_posisi' && (
          <div className="overflow-x-auto space-y-4">
            <table className="w-full min-w-[540px] border-collapse border border-[#C8C3B8] text-sm">
              <thead>
                <tr className="bg-[#14532D] text-white text-xs font-semibold">
                  <th className="border border-[#1E6B3D] px-3 py-2.5 text-center w-28">Kode</th>
                  <th className="border border-[#1E6B3D] px-3 py-2.5 text-left">Keterangan Akun</th>
                  <th className="border border-[#1E6B3D] px-3 py-2.5 text-right w-44">Saldo</th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-[#F3F1EB] font-bold text-xs uppercase text-[#18181B]">
                  <td colSpan={3} className="border border-[#C8C3B8] px-3 py-2">
                    Aset (Harta)
                  </td>
                </tr>
                {neracaPosisi.assets.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="border border-[#C8C3B8] px-3 py-2 text-xs text-[#57534E] italic">
                      Belum ada saldo aset.
                    </td>
                  </tr>
                ) : (
                  neracaPosisi.assets.map((a) => (
                    <tr key={a.account.id}>
                      <td className="border border-[#C8C3B8] px-3 py-2 text-center font-mono text-xs">
                        {a.account.code}
                      </td>
                      <td className="border border-[#C8C3B8] px-3 py-2 pl-6">{a.account.name}</td>
                      <td className="border border-[#C8C3B8] px-3 py-2 text-right font-mono tabular-nums">
                        {formatKolomAngka(a.amount)}
                      </td>
                    </tr>
                  ))
                )}
                <tr className="bg-[#FAF9F6] font-bold">
                  <td colSpan={2} className="border border-[#C8C3B8] px-3 py-2 text-right">
                    TOTAL ASET
                  </td>
                  <td
                    className="border border-[#C8C3B8] px-3 py-2 text-right font-mono tabular-nums text-[#14532D]"
                    data-testid="neraca-posisi-total-aset"
                  >
                    {formatRupiahTitle(neracaPosisi.totalAssets)}
                  </td>
                </tr>

                <tr className="bg-[#F3F1EB] font-bold text-xs uppercase text-[#18181B]">
                  <td colSpan={3} className="border border-[#C8C3B8] px-3 py-2">
                    Kewajiban (Utang)
                  </td>
                </tr>
                {neracaPosisi.liabilities.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="border border-[#C8C3B8] px-3 py-2 text-xs text-[#57534E] italic">
                      Tidak ada saldo kewajiban aktif.
                    </td>
                  </tr>
                ) : (
                  neracaPosisi.liabilities.map((l) => (
                    <tr key={l.account.id}>
                      <td className="border border-[#C8C3B8] px-3 py-2 text-center font-mono text-xs">
                        {l.account.code}
                      </td>
                      <td className="border border-[#C8C3B8] px-3 py-2 pl-6">{l.account.name}</td>
                      <td className="border border-[#C8C3B8] px-3 py-2 text-right font-mono tabular-nums">
                        {formatKolomAngka(l.amount)}
                      </td>
                    </tr>
                  ))
                )}
                <tr className="bg-[#FAF9F6] font-semibold">
                  <td colSpan={2} className="border border-[#C8C3B8] px-3 py-2 text-right">
                    Total Kewajiban
                  </td>
                  <td className="border border-[#C8C3B8] px-3 py-2 text-right font-mono tabular-nums text-[#B91C1C]">
                    {formatRupiahTitle(neracaPosisi.totalLiabilities)}
                  </td>
                </tr>

                <tr className="bg-[#F3F1EB] font-bold text-xs uppercase text-[#18181B]">
                  <td colSpan={3} className="border border-[#C8C3B8] px-3 py-2">
                    Ekuitas (Modal &amp; Laba Berjalan)
                  </td>
                </tr>
                {neracaPosisi.equities.map((eq) => (
                  <tr key={eq.account.id}>
                    <td className="border border-[#C8C3B8] px-3 py-2 text-center font-mono text-xs">
                      {eq.account.code}
                    </td>
                    <td className="border border-[#C8C3B8] px-3 py-2 pl-6">{eq.account.name}</td>
                    <td className="border border-[#C8C3B8] px-3 py-2 text-right font-mono tabular-nums">
                      {formatKolomAngka(eq.amount)}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="border border-[#C8C3B8] px-3 py-2 text-center font-mono text-xs">-</td>
                  <td className="border border-[#C8C3B8] px-3 py-2 pl-6">
                    Laba / (Rugi) Periode Berjalan
                  </td>
                  <td className="border border-[#C8C3B8] px-3 py-2 text-right font-mono tabular-nums">
                    {formatKolomAngka(neracaPosisi.currentNetProfit)}
                  </td>
                </tr>
                <tr className="bg-[#FAF9F6] font-semibold">
                  <td colSpan={2} className="border border-[#C8C3B8] px-3 py-2 text-right">
                    Total Ekuitas
                  </td>
                  <td className="border border-[#C8C3B8] px-3 py-2 text-right font-mono tabular-nums">
                    {formatRupiahTitle(neracaPosisi.totalEquityWithProfit)}
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr className="bg-[#14532D]/10 font-bold text-base">
                  <td colSpan={2} className="border border-[#C8C3B8] px-3 py-3 text-right">
                    TOTAL KEWAJIBAN + EKUITAS
                  </td>
                  <td
                    className="border border-[#C8C3B8] px-3 py-3 text-right font-mono tabular-nums text-[#14532D]"
                    data-testid="neraca-posisi-total-pasiva"
                  >
                    {formatRupiahTitle(neracaPosisi.totalLiabilitiesAndEquity)}
                  </td>
                </tr>
              </tfoot>
            </table>

            <p
              className={`text-xs font-semibold ${
                neracaPosisi.isBalanced ? 'text-[#14532D]' : 'text-[#B91C1C]'
              }`}
            >
              {neracaPosisi.isBalanced
                ? 'Persamaan Akuntansi Seimbang: Total Aset = Total Kewajiban + Ekuitas'
                : 'Peringatan: Posisi Neraca belum seimbang'}
            </p>
          </div>
        )}

        {/* 5. LABA RUGI BULANAN */}
        {reportTab === 'laba_rugi' && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[540px] border-collapse border border-[#C8C3B8] text-sm">
              <thead>
                <tr className="bg-[#14532D] text-white text-xs font-semibold">
                  <th className="border border-[#1E6B3D] px-3 py-2.5 text-center w-28">Kode</th>
                  <th className="border border-[#1E6B3D] px-3 py-2.5 text-left">Keterangan Akun</th>
                  <th className="border border-[#1E6B3D] px-3 py-2.5 text-right w-44">Jumlah</th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-[#F3F1EB] font-bold text-xs uppercase text-[#18181B]">
                  <td colSpan={3} className="border border-[#C8C3B8] px-3 py-2">
                    Pendapatan
                  </td>
                </tr>
                {labaRugi.revenues.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="border border-[#C8C3B8] px-3 py-2 text-xs text-[#57534E] italic">
                      Tidak ada pendapatan pada{' '}
                      {month === 'all' ? 'seluruh periode ini' : `bulan ${formatBulanTahun(month)}`}.
                    </td>
                  </tr>
                ) : (
                  labaRugi.revenues.map((r) => (
                    <tr key={r.account.id}>
                      <td className="border border-[#C8C3B8] px-3 py-2 text-center font-mono text-xs">
                        {r.account.code}
                      </td>
                      <td className="border border-[#C8C3B8] px-3 py-2 pl-6">{r.account.name}</td>
                      <td className="border border-[#C8C3B8] px-3 py-2 text-right font-mono tabular-nums">
                        {formatKolomAngka(r.amount)}
                      </td>
                    </tr>
                  ))
                )}
                <tr className="bg-[#FAF9F6] font-semibold">
                  <td colSpan={2} className="border border-[#C8C3B8] px-3 py-2 text-right">
                    Total Pendapatan
                  </td>
                  <td className="border border-[#C8C3B8] px-3 py-2 text-right font-mono tabular-nums text-[#15803D]">
                    {formatRupiahTitle(labaRugi.totalRevenue)}
                  </td>
                </tr>

                <tr className="bg-[#F3F1EB] font-bold text-xs uppercase text-[#18181B]">
                  <td colSpan={3} className="border border-[#C8C3B8] px-3 py-2">
                    Beban-Beban
                  </td>
                </tr>
                {labaRugi.expenses.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="border border-[#C8C3B8] px-3 py-2 text-xs text-[#57534E] italic">
                      Tidak ada beban pada{' '}
                      {month === 'all' ? 'seluruh periode ini' : `bulan ${formatBulanTahun(month)}`}.
                    </td>
                  </tr>
                ) : (
                  labaRugi.expenses.map((e) => (
                    <tr key={e.account.id}>
                      <td className="border border-[#C8C3B8] px-3 py-2 text-center font-mono text-xs">
                        {e.account.code}
                      </td>
                      <td className="border border-[#C8C3B8] px-3 py-2 pl-6">{e.account.name}</td>
                      <td className="border border-[#C8C3B8] px-3 py-2 text-right font-mono tabular-nums">
                        {formatKolomAngka(e.amount)}
                      </td>
                    </tr>
                  ))
                )}
                <tr className="bg-[#FAF9F6] font-semibold">
                  <td colSpan={2} className="border border-[#C8C3B8] px-3 py-2 text-right">
                    Total Beban
                  </td>
                  <td className="border border-[#C8C3B8] px-3 py-2 text-right font-mono tabular-nums text-[#B91C1C]">
                    {formatRupiahTitle(labaRugi.totalExpense)}
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr className="bg-[#14532D]/10 font-bold text-base">
                  <td colSpan={2} className="border border-[#C8C3B8] px-3 py-3 text-right">
                    {labaRugi.netProfit >= 0 ? 'LABA BERSIH' : 'RUGI BERSIH'}
                  </td>
                  <td
                    className={`border border-[#C8C3B8] px-3 py-3 text-right font-mono tabular-nums ${
                      labaRugi.netProfit >= 0 ? 'text-[#14532D]' : 'text-[#B91C1C]'
                    }`}
                  >
                    {formatRupiahTitle(labaRugi.netProfit)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
