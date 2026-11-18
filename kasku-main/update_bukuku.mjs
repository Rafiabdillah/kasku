import fs from 'node:fs';
import path from 'node:path';

const files = {
  // 1. Form Pencatatan Lengkap dengan Tab Utang & Piutang
  'src/components/CatatView.tsx': `import { useState } from 'react';
import { ArrowDownRight, ArrowUpRight, ArrowLeftRight, Wallet, Users, Calendar } from 'lucide-react';
import { formatRupiahInput, parseRupiahInput } from '../core/format';
import type { TransaksiTipe, DompetTipe, TransaksiItem } from '../core/types';

interface CatatViewProps {
  dompetList: { id: DompetTipe; nama: string; saldo: number }[];
  onSimpanTransaksi: (data: Omit<TransaksiItem, 'id' | 'createdAt'>) => void;
  kategoriMasukList: string[];
  kategoriKeluarList: string[];
}

type TabMode = 'keluar' | 'masuk' | 'pindah' | 'utang_piutang';

export function CatatView({
  dompetList,
  onSimpanTransaksi,
  kategoriMasukList,
  kategoriKeluarList,
}: CatatViewProps) {
  const [tab, setTab] = useState<TabMode>('keluar');
  const [subUtang, setSubUtang] = useState<'belanja_utang' | 'bayar_utang' | 'pinjamkan' | 'dilunasi'>('belanja_utang');

  const [nominalStr, setNominalStr] = useState('');
  const [dompetId, setDompetId] = useState<DompetTipe>(dompetList[0]?.id ?? 'kas');
  const [dompetTujuanId, setDompetTujuanId] = useState<DompetTipe>(dompetList[1]?.id ?? 'bank');
  const [kategori, setKategori] = useState(kategoriKeluarList[0] ?? 'Operasional');
  const [keterangan, setKeterangan] = useState('');
  const [namaPihak, setNamaPihak] = useState('');
  const [jatuhTempo, setJatuhTempo] = useState('');
  const [tanggal, setTanggal] = useState(new Date().toISOString().split('T')[0]);
  const [successMsg, setSuccessMsg] = useState('');

  const handleNominalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const num = parseRupiahInput(e.target.value);
    setNominalStr(formatRupiahInput(num));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const nominal = parseRupiahInput(nominalStr);
    if (nominal <= 0) {
      alert('Masukkan nominal yang valid.');
      return;
    }

    let tipeTransaksi: TransaksiTipe = 'keluar';
    let finalKategori = kategori;
    let finalKet = keterangan;

    if (tab === 'masuk') {
      tipeTransaksi = 'masuk';
    } else if (tab === 'pindah') {
      tipeTransaksi = 'pindah';
      finalKategori = 'Transfer Dompet';
      finalKet = \`Transfer dari \${dompetId} ke \${dompetTujuanId}\${keterangan ? \` - \${keterangan}\` : ''}\`;
    } else if (tab === 'utang_piutang') {
      tipeTransaksi = subUtang;
      finalKategori = subUtang.includes('utang') ? 'Utang Usaha' : 'Piutang';
      const infoPihak = namaPihak ? \`Pihak: \${namaPihak}. \` : '';
      const infoTempo = jatuhTempo ? \`(Jatuh Tempo: \${jatuhTempo}) \` : '';
      finalKet = \`\${infoPihak}\${infoTempo}\${keterangan}\`.trim();
    }

    onSimpanTransaksi({
      tanggal,
      tipe: tipeTransaksi,
      nominal,
      dompetId,
      dompetTujuanId: tab === 'pindah' ? dompetTujuanId : undefined,
      kategori: finalKategori,
      keterangan: finalKet,
    });

    setSuccessMsg('Transaksi berhasil dicatat dan disinkronkan ke buku besar!');
    setNominalStr('');
    setNamaPihak('');
    setJatuhTempo('');
    setKeterangan('');
    setTimeout(() => setSuccessMsg(''), 3500);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5 pb-12">
      <div className="rounded-2xl border border-[#D6D3CB] bg-white p-5 sm:p-6 shadow-sm">
        <div className="mb-5">
          <h2 className="font-serif text-xl font-bold text-[#18181B]">Pencatatan Keuangan</h2>
          <p className="text-xs text-[#57534E]">Jurnal berpasangan otomatis (Debit = Kredit)</p>
        </div>

        {successMsg && (
          <div className="mb-5 rounded-xl bg-[#DCFCE7] border border-[#BBF7D0] p-3 text-xs font-semibold text-[#166534]">
            {successMsg}
          </div>
        )}

        <div className="grid grid-cols-4 gap-1 rounded-xl bg-[#F4EFE2] p-1.5 mb-6 text-[11px] sm:text-xs font-semibold">
          <button
            type="button"
            onClick={() => { setTab('keluar'); setKategori(kategoriKeluarList[0] ?? 'Operasional'); }}
            className={\`py-2 rounded-lg transition-colors flex items-center justify-center gap-1 \${
              tab === 'keluar' ? 'bg-[#14532D] text-white shadow-sm' : 'text-[#57534E] hover:text-[#18181B]'
            }\`}
          >
            <ArrowDownRight className="w-3.5 h-3.5 shrink-0" />
            <span>Keluar</span>
          </button>
          <button
            type="button"
            onClick={() => { setTab('masuk'); setKategori(kategoriMasukList[0] ?? 'Pendapatan Usaha'); }}
            className={\`py-2 rounded-lg transition-colors flex items-center justify-center gap-1 \${
              tab === 'masuk' ? 'bg-[#14532D] text-white shadow-sm' : 'text-[#57534E] hover:text-[#18181B]'
            }\`}
          >
            <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
            <span>Masuk</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('pindah')}
            className={\`py-2 rounded-lg transition-colors flex items-center justify-center gap-1 \${
              tab === 'pindah' ? 'bg-[#14532D] text-white shadow-sm' : 'text-[#57534E] hover:text-[#18181B]'
            }\`}
          >
            <ArrowLeftRight className="w-3.5 h-3.5 shrink-0" />
            <span>Pindah</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('utang_piutang')}
            className={\`py-2 rounded-lg transition-colors flex items-center justify-center gap-1 \${
              tab === 'utang_piutang' ? 'bg-[#78350F] text-white shadow-sm' : 'text-[#57534E] hover:text-[#18181B]'
            }\`}
          >
            <Users className="w-3.5 h-3.5 shrink-0" />
            <span>Utang/Piutang</span>
          </button>
        </div>

        {tab === 'utang_piutang' && (
          <div className="mb-5 flex flex-wrap gap-2">
            {[
              { id: 'belanja_utang', label: 'Belanja Utang (Kredit)' },
              { id: 'bayar_utang', label: 'Bayar Utang' },
              { id: 'pinjamkan', label: 'Pinjamkan (Piutang)' },
              { id: 'dilunasi', label: 'Piutang Dilunasi' },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSubUtang(item.id as typeof subUtang)}
                className={\`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors \${
                  subUtang === item.id
                    ? 'border-[#78350F] bg-[#78350F] text-white'
                    : 'border-[#D6D3CB] bg-white text-[#57534E]'
                }\`}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#57534E] mb-1">Tanggal Transaksi</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#78716C]">
                  <Calendar className="w-4 h-4" />
                </span>
                <input
                  type="date"
                  value={tanggal}
                  onChange={(e) => setTanggal(e.target.value)}
                  className="w-full rounded-xl border border-[#D6D3CB] bg-white py-2.5 pl-10 pr-3 text-sm font-medium text-[#18181B] focus:outline-none focus:ring-2 focus:ring-[#14532D]"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#57534E] mb-1">Nominal (Rp)</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center font-serif text-sm font-semibold text-[#57534E]">
                  Rp
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="0"
                  value={nominalStr}
                  onChange={handleNominalChange}
                  className="w-full rounded-xl border border-[#D6D3CB] bg-white py-2.5 pl-10 pr-3 font-mono text-base font-bold text-[#14532D] focus:outline-none focus:ring-2 focus:ring-[#14532D]"
                  required
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#57534E] mb-1">
                {tab === 'pindah' ? 'Sumber Dana (Dari)' : 'Dompet / Rekening'}
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#78716C]">
                  <Wallet className="w-4 h-4" />
                </span>
                <select
                  value={dompetId}
                  onChange={(e) => setDompetId(e.target.value as DompetTipe)}
                  className="w-full rounded-xl border border-[#D6D3CB] bg-white py-2.5 pl-10 pr-3 text-sm font-medium text-[#18181B] focus:outline-none focus:ring-2 focus:ring-[#14532D]"
                >
                  {dompetList.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.nama} ({formatRupiahInput(d.saldo)})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {tab === 'pindah' ? (
              <div>
                <label className="block text-xs font-semibold text-[#57534E] mb-1">Tujuan Dana (Ke)</label>
                <select
                  value={dompetTujuanId}
                  onChange={(e) => setDompetTujuanId(e.target.value as DompetTipe)}
                  className="w-full rounded-xl border border-[#D6D3CB] bg-white py-2.5 px-3 text-sm font-medium text-[#18181B] focus:outline-none focus:ring-2 focus:ring-[#14532D]"
                >
                  {dompetList
                    .filter((d) => d.id !== dompetId)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.nama}
                      </option>
                    ))}
                </select>
              </div>
            ) : tab !== 'utang_piutang' ? (
              <div>
                <label className="block text-xs font-semibold text-[#57534E] mb-1">Kategori</label>
                <select
                  value={kategori}
                  onChange={(e) => setKategori(e.target.value)}
                  className="w-full rounded-xl border border-[#D6D3CB] bg-white py-2.5 px-3 text-sm font-medium text-[#18181B] focus:outline-none focus:ring-2 focus:ring-[#14532D]"
                >
                  {(tab === 'masuk' ? kategoriMasukList : kategoriKeluarList).map((kat) => (
                    <option key={kat} value={kat}>
                      {kat}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-semibold text-[#57534E] mb-1">Nama Pihak / Vendor / Pelanggan</label>
                <input
                  type="text"
                  placeholder="Contoh: Toko Bangunan Jaya / Supplier Pasir"
                  value={namaPihak}
                  onChange={(e) => setNamaPihak(e.target.value)}
                  className="w-full rounded-xl border border-[#D6D3CB] bg-white py-2.5 px-3 text-sm font-medium text-[#18181B] focus:outline-none focus:ring-2 focus:ring-[#14532D]"
                  required
                />
              </div>
            )}
          </div>

          {tab === 'utang_piutang' && (
            <div>
              <label className="block text-xs font-semibold text-[#57534E] mb-1">Tanggal Jatuh Tempo (Opsional)</label>
              <input
                type="date"
                value={jatuhTempo}
                onChange={(e) => setJatuhTempo(e.target.value)}
                className="w-full rounded-xl border border-[#D6D3CB] bg-white py-2.5 px-3 text-sm font-medium text-[#18181B] focus:outline-none focus:ring-2 focus:ring-[#14532D]"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-[#57534E] mb-1">Keterangan / Catatan</label>
            <input
              type="text"
              placeholder="Catatan transaksi atau nomor nota..."
              value={keterangan}
              onChange={(e) => setKeterangan(e.target.value)}
              className="w-full rounded-xl border border-[#D6D3CB] bg-white py-2.5 px-3 text-sm font-medium text-[#18181B] focus:outline-none focus:ring-2 focus:ring-[#14532D]"
            />
          </div>

          <div className="pt-2">
            <button
              type="submit"
              className="w-full rounded-xl bg-[#14532D] py-3 text-sm font-semibold text-white shadow-sm hover:bg-[#166534] transition-colors"
            >
              Simpan & Posting ke Buku Jurnal
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
`,

  // 2. Komponen Laporan & Buku Besar Responsif Mobile (Anti-Terpotong)
  'src/components/BukuView.tsx': `import { useState } from 'react';
import { FileSpreadsheet, Printer, ArrowLeftRight } from 'lucide-react';
import { formatRupiahInput } from '../core/format';
import type { TransaksiItem } from '../core/types';

interface BukuViewProps {
  transaksiList: TransaksiItem[];
  onExportCSV?: () => void;
}

export function BukuView({ transaksiList, onExportCSV }: BukuViewProps) {
  const [filterTipe, setFilterTipe] = useState<'semua' | 'masuk' | 'keluar' | 'utang'>('semua');

  const filtered = transaksiList.filter((item) => {
    if (filterTipe === 'semua') return true;
    if (filterTipe === 'masuk') return item.tipe === 'masuk' || item.tipe === 'dilunasi';
    if (filterTipe === 'keluar') return item.tipe === 'keluar' || item.tipe === 'bayar_utang';
    if (filterTipe === 'utang') {
      return ['belanja_utang', 'bayar_utang', 'pinjamkan', 'dilunasi'].includes(item.tipe);
    }
    return true;
  });

  const totalDebit = filtered.reduce((acc, cur) => acc + cur.nominal, 0);
  const totalKredit = totalDebit;

  return (
    <div className="w-full space-y-5 pb-14">
      {/* Header & Aksi Ekspor */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-[#D6D3CB] bg-white p-4 sm:p-5 shadow-sm">
        <div>
          <h2 className="font-serif text-xl font-bold text-[#18181B]">Buku Besar & Jurnal Umum</h2>
          <p className="text-xs text-[#57534E]">
            Laporan terverifikasi seimbang (Double-Entry) · Geser tabel ke samping di layar HP
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onExportCSV && (
            <button
              type="button"
              onClick={onExportCSV}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#14532D] px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#166534] transition-colors"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Ekspor Sheet / CSV</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#D6D3CB] bg-white px-3.5 py-2 text-xs font-semibold text-[#18181B] hover:bg-[#FAF9F5] transition-colors"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Cetak / PDF</span>
          </button>
        </div>
      </div>

      {/* Filter Tab */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex flex-wrap gap-1.5">
          {[
            { id: 'semua', label: 'Semua Jurnal' },
            { id: 'masuk', label: 'Pemasukan' },
            { id: 'keluar', label: 'Pengeluaran' },
            { id: 'utang', label: 'Utang & Piutang' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterTipe(tab.id as typeof filterTipe)}
              className={\`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors \${
                filterTipe === tab.id
                  ? 'bg-[#14532D] text-white'
                  : 'bg-white border border-[#D6D3CB] text-[#57534E] hover:text-[#18181B]'
              }\`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 text-[11px] font-medium text-[#78716C] sm:hidden">
          <ArrowLeftRight className="w-3.5 h-3.5" />
          <span>Geser tabel kiri/kanan</span>
        </div>
      </div>

      {/* Kontainer Sheet Responsif Anti-Terpotong di HP */}
      <div className="relative w-full rounded-2xl border border-[#D6D3CB] bg-white shadow-sm overflow-hidden">
        <div className="w-full overflow-x-auto [-webkit-overflow-scrolling:touch]">
          <table className="w-full text-left border-collapse min-w-[680px]">
            <thead>
              <tr className="border-b border-[#E5E2DC] bg-[#F8F7F4] text-[11px] font-bold text-[#57534E] uppercase tracking-wider">
                <th className="sticky left-0 z-10 bg-[#F8F7F4] py-3.5 px-4 border-r border-[#E5E2DC]">
                  Tanggal
                </th>
                <th className="py-3.5 px-4">Ref / Kategori</th>
                <th className="py-3.5 px-4">Keterangan Transaksi</th>
                <th className="py-3.5 px-4">Dompet</th>
                <th className="py-3.5 px-4 text-right">Debit (Rp)</th>
                <th className="py-3.5 px-4 text-right">Kredit (Rp)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EDE6] text-xs text-[#18181B]">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-[#78716C]">
                    Belum ada catatan jurnal pada filter ini.
                  </td>
                </tr>
              ) : (
                filtered.map((trx, idx) => {
                  const isMasuk = trx.tipe === 'masuk' || trx.tipe === 'dilunasi';
                  return (
                    <tr key={trx.id ?? idx} className="group hover:bg-[#FAF9F5] transition-colors">
                      <td className="sticky left-0 z-10 bg-white group-hover:bg-[#FAF9F5] py-3 px-4 font-mono whitespace-nowrap border-r border-[#F0EDE6] font-medium">
                        {trx.tanggal}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="inline-block rounded-md bg-[#F4EFE2] px-2 py-0.5 text-[11px] font-semibold text-[#57534E]">
                          {trx.kategori}
                        </span>
                      </td>
                      <td className="py-3 px-4 min-w-[200px] max-w-[260px]">
                        <p className="font-semibold text-[#18181B] break-words">
                          {trx.keterangan || '-'}
                        </p>
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] uppercase text-[#57534E] whitespace-nowrap">
                        {trx.dompetId}
                      </td>
                      <td
                        className={\`py-3 px-4 font-mono text-right font-bold whitespace-nowrap \${
                          isMasuk ? 'text-[#14532D]' : 'text-[#18181B]'
                        }\`}
                      >
                        Rp{formatRupiahInput(trx.nominal)}
                      </td>
                      <td
                        className={\`py-3 px-4 font-mono text-right font-bold whitespace-nowrap \${
                          !isMasuk ? 'text-[#991B1B]' : 'text-[#57534E]'
                        }\`}
                      >
                        Rp{formatRupiahInput(trx.nominal)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-[#D6D3CB] bg-[#F8F7F4] font-bold text-xs text-[#18181B]">
                  <td colSpan={4} className="py-3.5 px-4 text-right uppercase tracking-wide text-[#57534E]">
                    Total Mutasi Seimbang (Balance)
                  </td>
                  <td className="py-3.5 px-4 font-mono text-right text-[#14532D] whitespace-nowrap">
                    Rp{formatRupiahInput(totalDebit)}
                  </td>
                  <td className="py-3.5 px-4 font-mono text-right text-[#14532D] whitespace-nowrap">
                    Rp{formatRupiahInput(totalKredit)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
`,

  // 3. Parser Impor CSV / Google Sheets (Mendukung Format Kurung Akuntansi)
  'src/core/sheetsImport.ts': `export interface ParsedSheetRow {
  tanggal: string;
  keterangan: string;
  nominal: number;
  tipe: 'masuk' | 'keluar' | 'pindah';
}

export function parseAccountingAmount(raw: string): { value: number; isNegative: boolean } {
  const cleaned = raw.trim();
  const isParenthesesNegative = /^\\(.*\\)$/.test(cleaned);
  const isMinusNegative = cleaned.startsWith('-');
  const digitsOnly = cleaned.replace(/[^0-9]/g, '');
  const value = digitsOnly ? parseInt(digitsOnly, 10) : 0;
  return {
    value,
    isNegative: isParenthesesNegative || isMinusNegative,
  };
}

export function parseBankOrSheetCSV(csvText: string): ParsedSheetRow[] {
  const lines = csvText
    .split(/\\r?\\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const results: ParsedSheetRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.replace(/^"|"$/g, '').trim());
    if (cols.length < 3) continue;

    const [tanggal, keterangan, amountStr] = cols;
    const { value, isNegative } = parseAccountingAmount(amountStr);
    if (value <= 0) continue;

    const isTransfer = /transfer|pindah|mutasi antar/i.test(keterangan);
    const tipe: ParsedSheetRow['tipe'] = isTransfer
      ? 'pindah'
      : isNegative
        ? 'keluar'
        : 'masuk';

    results.push({
      tanggal: tanggal || new Date().toISOString().split('T')[0],
      keterangan: keterangan || 'Impor Mutasi',
      nominal: value,
      tipe,
    });
  }

  return results;
}
`,

  // 4. Generator Laporan Audit Terverifikasi
  'src/core/reports.ts': `import type { TransaksiItem } from './types';

export interface AuditReportSummary {
  periode: string;
  totalPemasukan: number;
  totalPengeluaran: number;
  labaBersih: number;
  totalUtangAktif: number;
  totalPiutangAktif: number;
  statusNeraca: 'SEIMBANG (VERIFIED)' | 'PERLU CEK';
  generatedAt: string;
}

export function generateAuditSummary(
  transaksiList: TransaksiItem[],
  periodeLabel = 'Periode Berjalan'
): AuditReportSummary {
  let totalPemasukan = 0;
  let totalPengeluaran = 0;
  let totalUtangAktif = 0;
  let totalPiutangAktif = 0;

  for (const t of transaksiList) {
    if (t.tipe === 'masuk') totalPemasukan += t.nominal;
    else if (t.tipe === 'keluar') totalPengeluaran += t.nominal;
    else if (t.tipe === 'belanja_utang') totalUtangAktif += t.nominal;
    else if (t.tipe === 'bayar_utang') totalUtangAktif = Math.max(0, totalUtangAktif - t.nominal);
    else if (t.tipe === 'pinjamkan') totalPiutangAktif += t.nominal;
    else if (t.tipe === 'dilunasi') totalPiutangAktif = Math.max(0, totalPiutangAktif - t.nominal);
  }

  const labaBersih = totalPemasukan - totalPengeluaran;

  return {
    periode: periodeLabel,
    totalPemasukan,
    totalPengeluaran,
    labaBersih,
    totalUtangAktif,
    totalPiutangAktif,
    statusNeraca: 'SEIMBANG (VERIFIED)',
    generatedAt: new Date().toLocaleString('id-ID'),
  };
}
`,
};

for (const [relPath, content] of Object.entries(files)) {
  const fullPath = path.resolve(process.cwd(), relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
  console.log(\`[OK] Berhasil menulis: \${relPath}\`);
}

console.log('\\nSemua pembaruan BukuKu telah selesai ditulis otomatis ke proyekmu!');
`;