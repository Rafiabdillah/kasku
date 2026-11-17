import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { LedgerDatabase } from '../core/types';
import {
  endOfMonthDate,
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

function drawIndonesianReportHeader(
  doc: jsPDF,
  ownerName: string,
  titleCapital: string,
  periodSubtitle: string,
) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const centerX = pageWidth / 2;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(70, 70, 70);
  doc.text(ownerName, centerX, 15, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(20, 20, 20);
  doc.text(titleCapital.toUpperCase(), centerX, 22, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(50, 50, 50);
  doc.text(periodSubtitle, centerX, 28, { align: 'center' });

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text('(Dalam Rupiah)', centerX, 33, { align: 'center' });
}

export function exportJurnalUmumPDF(db: LedgerDatabase, month: string) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const entries = buildJurnalUmum(db, { month, includeReversals: true });
  const periodLabel =
    month === 'all'
      ? `Semua Periode (${formatPerTanggal(todayLocalDate())})`
      : formatPeriodeBerakhir(month);

  const body: Array<Array<string>> = [];
  let grandDebit = 0;
  let grandCredit = 0;

  for (const entry of entries) {
    entry.lines.forEach((item, idx) => {
      const isCredit = item.line.credit > 0;
      const accountLabel = isCredit
        ? `      ${item.account.name}`
        : item.account.name;
      body.push([
        idx === 0 ? formatTanggalID(entry.journal.date) : '',
        accountLabel,
        item.account.code,
        formatKolomAngka(item.line.debit),
        formatKolomAngka(item.line.credit),
      ]);
      grandDebit += item.line.debit;
      grandCredit += item.line.credit;
    });
    const voidSuffix = entry.journal.voided_at ? ' — VOID' : '';
    body.push(['', `(${entry.journal.description})${voidSuffix}`, entry.journal.number, '', '']);
  }

  body.push([
    '',
    'TOTAL',
    '',
    formatRupiahTitle(grandDebit),
    formatRupiahTitle(grandCredit),
  ]);

  autoTable(doc, {
    startY: 38,
    margin: { top: 38, left: 14, right: 14 },
    head: [['Tanggal', 'Keterangan / Akun', 'Ref', 'Debit', 'Kredit']],
    body,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: 2,
      lineColor: [180, 178, 170],
      lineWidth: 0.25,
      textColor: [24, 24, 27],
    },
    headStyles: {
      fillColor: [20, 83, 45],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'center',
    },
    columnStyles: {
      0: { cellWidth: 24, halign: 'center' },
      1: { cellWidth: 'auto', halign: 'left' },
      2: { cellWidth: 20, halign: 'center' },
      3: { cellWidth: 32, halign: 'right' },
      4: { cellWidth: 32, halign: 'right' },
    },
    didDrawPage: () => {
      drawIndonesianReportHeader(
        doc,
        db.settings.ownerName,
        'JURNAL UMUM',
        periodLabel,
      );
    },
  });

  doc.save(`BukuKu-Jurnal-Umum-${month}.pdf`);
}

export function exportBukuBesarPDF(db: LedgerDatabase, accountId: string, month: string) {
  const report = buildBukuBesar(db, accountId, { month });
  if (!report) return;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const periodLabel =
    month === 'all'
      ? `Semua Periode (${formatPerTanggal(todayLocalDate())})`
      : formatPeriodeBerakhir(month);

  const body: Array<Array<string>> = [];
  if (report.openingBalance !== 0) {
    body.push(['-', 'Saldo Awal Periode', '-', '-', '-', formatKolomAngka(report.openingBalance)]);
  }
  for (const r of report.rows) {
    body.push([
      formatTanggalID(r.date),
      `${r.description}${r.isVoided ? (r.kind === 'pembalik' ? ' [Pembalik]' : ' [Void]') : ''}`,
      r.ref,
      formatKolomAngka(r.debit),
      formatKolomAngka(r.credit),
      formatKolomAngka(r.runningBalance),
    ]);
  }

  autoTable(doc, {
    startY: 38,
    margin: { top: 38, left: 14, right: 14 },
    head: [['Tanggal', 'Keterangan', 'Ref', 'Debit', 'Kredit', 'Saldo']],
    body,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: 2.2,
      lineColor: [180, 178, 170],
      lineWidth: 0.25,
    },
    headStyles: {
      fillColor: [20, 83, 45],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'center',
    },
    columnStyles: {
      0: { cellWidth: 26, halign: 'center' },
      1: { cellWidth: 'auto', halign: 'left' },
      2: { cellWidth: 24, halign: 'center' },
      3: { cellWidth: 34, halign: 'right' },
      4: { cellWidth: 34, halign: 'right' },
      5: { cellWidth: 38, halign: 'right', fontStyle: 'bold' },
    },
    didDrawPage: () => {
      drawIndonesianReportHeader(
        doc,
        db.settings.ownerName,
        `BUKU BESAR — ${report.account.code} ${report.account.name.toUpperCase()}`,
        periodLabel,
      );
    },
  });

  doc.save(`BukuKu-Buku-Besar-${report.account.code}-${month}.pdf`);
}

export function exportBukuKasPDF(
  db: LedgerDatabase,
  walletAccountId: string | undefined,
  month: string,
) {
  const report = buildBukuKas(db, { month, walletAccountId });
  const walletLabel = walletAccountId
    ? db.accounts.find((a) => a.id === walletAccountId)?.name ?? 'DOMPET'
    : 'SEMUA DOMPET';

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const periodLabel =
    month === 'all'
      ? `Semua Periode (${formatPerTanggal(todayLocalDate())})`
      : formatPeriodeBerakhir(month);

  const body: Array<Array<string>> = [];
  if (report.openingBalance !== 0) {
    body.push(['-', 'Saldo Awal Periode', '-', '-', '-', '-', formatKolomAngka(report.openingBalance)]);
  }
  for (const r of report.rows) {
    body.push([
      formatTanggalID(r.date),
      `${r.description}${r.isVoided ? (r.kind === 'pembalik' ? ' [Pembalik]' : ' [Void]') : ''}`,
      `${r.walletCode} ${r.walletName}`,
      r.ref,
      formatKolomAngka(r.debit),
      formatKolomAngka(r.credit),
      formatKolomAngka(r.runningBalance),
    ]);
  }
  body.push([
    '',
    'TOTAL & SALDO AKHIR',
    '',
    '',
    formatRupiahTitle(report.totalMasuk),
    formatRupiahTitle(report.totalKeluar),
    formatRupiahTitle(report.closingBalance),
  ]);

  autoTable(doc, {
    startY: 38,
    margin: { top: 38, left: 14, right: 14 },
    head: [['Tanggal', 'Keterangan', 'Dompet', 'Ref', 'Masuk (D)', 'Keluar (K)', 'Saldo']],
    body,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: 2.2,
      lineColor: [180, 178, 170],
      lineWidth: 0.25,
    },
    headStyles: {
      fillColor: [20, 83, 45],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'center',
    },
    columnStyles: {
      0: { cellWidth: 24, halign: 'center' },
      1: { cellWidth: 'auto', halign: 'left' },
      2: { cellWidth: 34, halign: 'left' },
      3: { cellWidth: 22, halign: 'center' },
      4: { cellWidth: 32, halign: 'right' },
      5: { cellWidth: 32, halign: 'right' },
      6: { cellWidth: 36, halign: 'right', fontStyle: 'bold' },
    },
    didDrawPage: () => {
      drawIndonesianReportHeader(
        doc,
        db.settings.ownerName,
        `BUKU KAS & DOMPET — ${walletLabel.toUpperCase()}`,
        periodLabel,
      );
    },
  });

  doc.save(`BukuKu-Buku-Kas-${month}.pdf`);
}

export function exportNeracaSaldoPDF(db: LedgerDatabase, month: string) {
  const upTo = month === 'all' ? undefined : endOfMonthDate(month);
  const report = buildNeracaSaldo(db, upTo);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const periodLabel = formatPerTanggal(upTo ?? todayLocalDate());

  const body = report.rows.map((r) => [
    r.account.code,
    r.account.name,
    formatKolomAngka(r.debit),
    formatKolomAngka(r.credit),
  ]);
  body.push([
    '',
    'TOTAL NERACA SALDO',
    formatRupiahTitle(report.totalDebit),
    formatRupiahTitle(report.totalCredit),
  ]);

  autoTable(doc, {
    startY: 38,
    margin: { top: 38, left: 14, right: 14 },
    head: [['No. Akun', 'Nama Akun', 'Debit', 'Kredit']],
    body,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 9,
      cellPadding: 2.5,
      lineColor: [180, 178, 170],
      lineWidth: 0.25,
    },
    headStyles: {
      fillColor: [20, 83, 45],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'center',
    },
    columnStyles: {
      0: { cellWidth: 26, halign: 'center' },
      1: { cellWidth: 'auto', halign: 'left' },
      2: { cellWidth: 40, halign: 'right' },
      3: { cellWidth: 40, halign: 'right' },
    },
    didDrawPage: () => {
      drawIndonesianReportHeader(
        doc,
        db.settings.ownerName,
        'NERACA SALDO',
        periodLabel,
      );
    },
  });

  doc.save(`BukuKu-Neraca-Saldo-${month}.pdf`);
}

export function exportLabaRugiPDF(db: LedgerDatabase, month: string) {
  const report = buildLabaRugi(db, month);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const periodLabel =
    month === 'all'
      ? `Semua Periode (${formatPerTanggal(todayLocalDate())})`
      : formatPeriodeBerakhir(month);

  const body: Array<Array<string>> = [
    ['PENDAPATAN', '', ''],
    ...report.revenues.map((r) => [
      r.account.code,
      r.account.name,
      formatKolomAngka(r.amount),
    ]),
    ['', 'Total Pendapatan', formatRupiahTitle(report.totalRevenue)],
    ['BEBAN-BEBAN', '', ''],
    ...report.expenses.map((e) => [
      e.account.code,
      e.account.name,
      formatKolomAngka(e.amount),
    ]),
    ['', 'Total Beban', formatRupiahTitle(report.totalExpense)],
    ['', report.netProfit >= 0 ? 'LABA BERSIH' : 'RUGI BERSIH', formatRupiahTitle(report.netProfit)],
  ];

  autoTable(doc, {
    startY: 38,
    margin: { top: 38, left: 14, right: 14 },
    head: [['Kode', 'Keterangan Akun', 'Jumlah']],
    body,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 9,
      cellPadding: 2.5,
      lineColor: [180, 178, 170],
      lineWidth: 0.25,
    },
    headStyles: {
      fillColor: [20, 83, 45],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 26, halign: 'center' },
      1: { cellWidth: 'auto', halign: 'left' },
      2: { cellWidth: 46, halign: 'right' },
    },
    didDrawPage: () => {
      drawIndonesianReportHeader(
        doc,
        db.settings.ownerName,
        'LAPORAN LABA RUGI',
        periodLabel,
      );
    },
  });

  doc.save(`BukuKu-Laba-Rugi-${month}.pdf`);
}

export function exportNeracaPDF(db: LedgerDatabase, month: string) {
  const upTo = month === 'all' ? undefined : endOfMonthDate(month);
  const report = buildNeraca(db, upTo);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const periodLabel = formatPerTanggal(upTo ?? todayLocalDate());

  const body: Array<Array<string>> = [
    ['ASET (HARTA)', '', ''],
    ...report.assets.map((a) => [a.account.code, a.account.name, formatKolomAngka(a.amount)]),
    ['', 'Total Aset', formatRupiahTitle(report.totalAssets)],
    ['KEWAJIBAN (UTANG)', '', ''],
    ...report.liabilities.map((l) => [l.account.code, l.account.name, formatKolomAngka(l.amount)]),
    ['', 'Total Kewajiban', formatRupiahTitle(report.totalLiabilities)],
    ['EKUITAS (MODAL)', '', ''],
    ...report.equities.map((e) => [e.account.code, e.account.name, formatKolomAngka(e.amount)]),
    ['', 'Laba / (Rugi) Periode Berjalan', formatKolomAngka(report.currentNetProfit)],
    ['', 'Total Ekuitas', formatRupiahTitle(report.totalEquityWithProfit)],
    ['', 'TOTAL KEWAJIBAN + EKUITAS', formatRupiahTitle(report.totalLiabilitiesAndEquity)],
  ];

  autoTable(doc, {
    startY: 38,
    margin: { top: 38, left: 14, right: 14 },
    head: [['Kode', 'Keterangan Akun', 'Saldo']],
    body,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 9,
      cellPadding: 2.5,
      lineColor: [180, 178, 170],
      lineWidth: 0.25,
    },
    headStyles: {
      fillColor: [20, 83, 45],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 26, halign: 'center' },
      1: { cellWidth: 'auto', halign: 'left' },
      2: { cellWidth: 46, halign: 'right' },
    },
    didDrawPage: () => {
      drawIndonesianReportHeader(
        doc,
        db.settings.ownerName,
        'NERACA (POSISI KEUANGAN)',
        periodLabel,
      );
    },
  });

  doc.save(`BukuKu-Neraca-${month}.pdf`);
}
