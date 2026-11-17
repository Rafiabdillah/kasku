# BukuKu — Catat Uang & Buku Akuntansi

Aplikasi pembukuan pribadi dan usaha kecil bergaya buku akuntansi Indonesia. Semua transaksi otomatis menjadi jurnal debit-kredit yang seimbang, dengan laporan Neraca Saldo, Neraca, Laba Rugi, Buku Besar, dan Buku Kas.

**Aplikasi siap pakai:** <https://rafiabdillah.github.io/kasku/>

**Offline-first:** data tersimpan di perangkat (IndexedDB + localStorage) dan aplikasi dapat dipasang sebagai PWA. Tidak ada server BukuKu dan tidak ada data yang dikirim ke mana pun kecuali Anda memilih sinkronisasi Google Sheets.

## Pasang di perangkat

Aplikasi ini tidak perlu diunduh dari toko aplikasi. Buka tautan di atas, lalu pasang dari browser:

| Perangkat | Langkah |
| --- | --- |
| Android (Chrome) | Buka tautan → menu ⋮ → **Tambahkan ke layar utama** / **Instal aplikasi** |
| Desktop (Chrome/Edge) | Buka tautan → ikon **Instal** di bilah alamat, atau menu → **Aplikasi → Instal situs ini** |
| iPhone/iPad (Safari) | Buka tautan → tombol **Bagikan** → **Tambah ke Layar Utama** |

Setelah terpasang, BukuKu terbuka layar penuh tanpa bilah browser dan tetap berjalan tanpa internet. Data tetap berada di perangkat yang sama; gunakan **Pengaturan → CSV, Backup & PWA → Unduh Backup (.json)** secara berkala.

## Update aplikasi

- Versi terbaru tersedia di halaman **Releases**: <https://github.com/Rafiabdillah/kasku/releases>
- Saat ada versi baru, BukuKu yang sedang terbuka menampilkan banner **“Pembaruan aplikasi BukuKu siap digunakan”** dengan tombol **Muat Ulang**. Data tidak terhapus.
- Aplikasi memeriksa pembaruan otomatis setiap jam dan saat kembali dibuka/diaktifkan. Jika tidak ada banner, cukup tutup lalu buka kembali aplikasi.
- Tidak perlu memasang ulang; service worker mengganti berkas lama dengan versi baru.

## Fitur

- Catat uang masuk, keluar, pindah dompet, saldo awal, utang, dan piutang.
- Jurnal umum otomatis dengan validasi debit = kredit dan nomor jurnal berurutan.
- Pembatalan transaksi lewat jurnal pembalik (audit trail tetap utuh, tidak ada penghapusan).
- Laporan: Jurnal Umum, Buku Besar, Buku Kas, Neraca Saldo, Neraca, Laba Rugi.
- Ekspor PDF dan CSV, backup/pemulihan JSON.
- Anggaran bulanan, transaksi berulang, pencarian, dan rincian utang/piutang per pihak.
- Visualisasi Neraca 3D (dengan fallback otomatis jika WebGL tidak tersedia).
- Sinkronisasi ke Google Sheets (opsional, memerlukan login Google).
- Kunci PIN layar, mode offline PWA, dan sinkronisasi antar-tab.
- Layar awal (onboarding) untuk mengisi nama pemilik dan memilih buku kosong atau data contoh.

## Menjalankan

Prasyarat: **Node.js 20+** dan npm.

```bash
npm install
npm run dev        # http://localhost:3000
```

Perintah lain:

```bash
npm run typecheck   # TypeScript strict
npm run test        # unit test akuntansi + hardening
npm run build       # build produksi ke dist/
npm run build:pages # build khusus GitHub Pages ke docs/ (base /kasku/)
npm run preview     # menjalankan hasil build
npm run verify      # typecheck + test + build
```

Tidak ada environment variable yang wajib. Konfigurasi Firebase untuk Google Sheets berada di `firebase-applet-config.json`.

> **Catatan Windows:** hindari nama folder yang mengandung karakter `&` (mis. `uang & buku`). `npm run` pada Windows memakai `cmd.exe` dan karakter tersebut memutus path `node_modules\.bin`. Jika sudah terlanjur, ganti nama folder atau jalankan binary langsung (`node node_modules/vite/bin/vite.js`).

## Deploy (GitHub Pages)

Situs produksi disajikan GitHub Pages dari branch `main`, folder `docs/`.

```bash
npm run verify
npm run build:pages      # menghasilkan docs/ dengan base /kasku/
git add docs && git commit -m "release: perbarui build Pages"
git push origin main
```

Pages menyajikan ulang dalam ±1 menit. Service worker di perangkat pengguna mendeteksi versi baru dan menampilkan tombol **Muat Ulang**.

## Keamanan dan privasi

- **PIN adalah kunci layar, bukan enkripsi.** Data di IndexedDB/localStorage dan file backup JSON disimpan tanpa enkripsi. Siapa pun yang memiliki akses ke profil browser atau file backup dapat membacanya.
- PIN di-hash dengan PBKDF2-SHA-256 dan salt per-perangkat, dengan jeda setelah percobaan gagal berulang. Aplikasi mengunci ulang otomatis setelah 60 detik di latar belakang.
- Gunakan kunci layar perangkat dan unduh backup JSON secara berkala.
- Kunci PIN dan Spreadsheet ID bersifat lokal: memulihkan backup tidak menimpa PIN perangkat Anda.

## Google Sheets (opsional)

1. Buat proyek Firebase dan aktifkan Google Sign-In (provider Google).
2. Tambahkan domain tempat aplikasi dijalankan ke **Authentication → Settings → Authorized domains**. Untuk versi GitHub Pages, tambahkan `rafiabdillah.github.io`; untuk pengembangan lokal, `localhost`.
3. Isi `firebase-applet-config.json` dengan konfigurasi web app Anda.
4. Di aplikasi: **Pengaturan → Google Sheets → Sign in with Google**, lalu buat spreadsheet baru atau tempel URL/ID spreadsheet.

Sinkronisasi hanya menimpa empat tab khusus BukuKu: `BukuKu · Ringkasan`, `BukuKu · Jurnal Umum`, `BukuKu · Neraca Saldo`, dan `BukuKu · Laba Rugi`. Nama bertanda `BukuKu ·` mencegah tab laporan menimpa tab lain (mis. tab bernama `Jurnal Umum` milik Anda). Jika tab belum ada, BukuKu membuatnya otomatis.

## Struktur proyek

```
src/
  core/        logika akuntansi murni (ledger, mapper, reports, format, import)
  services/    penyimpanan lokal, Google Sheets, ekspor PDF/CSV
  components/  tampilan React
  hooks/       hook PWA
scripts/       skrip build GitHub Pages
docs/          hasil build Pages (dihasilkan `npm run build:pages`)
```

Unit test berada di `src/core/*.test.ts` dan dijalankan dengan `node:test` melalui `tsx`.

## Lisensi

Proyek ini dibuat untuk penggunaan pribadi. Tinjau kembali sebelum digunakan untuk pembukuan usaha yang memiliki kewajiban pelaporan resmi.
