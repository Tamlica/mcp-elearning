# MCP Server Elearning UT (read-only)

Server MCP kecil supaya Claude (Desktop atau Code) bisa **membaca** isi elearning Universitas Terbuka (`elearning.ut.ac.id`, berbasis Moodle): daftar mata kuliah, materi per sesi, info kuis, instruksi tugas, topik diskusi, dan tenggat.

**Server ini tidak bisa menulis apa pun.** Tidak ada tool untuk mengirim tugas, memulai/mengerjakan kuis, atau memposting diskusi. Pengumpulan tetap kamu lakukan manual di elearning.

> **Status pengujian:** kode ini sudah diuji dengan **Moodle tiruan (data mock)**, 12 uji lulus. Kode ini **belum pernah diuji terhadap elearning UT yang asli**, karena situs UT tidak bisa diakses dari lingkungan tempat kode ini dibuat. Uji pertama di komputermu dengan `npm run cek` (lihat langkah 3).

---

## 1. Kebutuhan

- Node.js 18.17 atau lebih baru (`node -v`)
- Akun elearning UT yang aktif
- Claude Desktop atau Claude Code

## 2. Ambil token elearning

Server memakai **token Web Service Moodle** milikmu sendiri, bukan username/password. Token disimpan hanya di konfigurasi Claude di komputermu.

**Cara A: halaman Kunci keamanan (paling aman)**

1. Login ke `https://elearning.ut.ac.id`.
2. Klik foto profil (kanan atas) → **Preferensi** (Preferences) → **Kunci keamanan** (Security keys).
   Alamat langsungnya: `https://elearning.ut.ac.id/user/managetoken.php`
3. Cari baris layanan **Moodle mobile web service** (atau layanan lain yang tersedia). Salin isi kolom **Kunci** (Key).
4. Kalau halaman itu tidak ada atau kosong, berarti UT tidak menampilkan token di sana. Coba Cara B.

Catatan: baris "Moodle mobile web service" sering baru muncul setelah kamu pernah login lewat aplikasi **Moodle** resmi di HP (cari "Moodle" di Play Store/App Store, alamat situs `elearning.ut.ac.id`). Login sekali di aplikasi itu, lalu cek halaman Kunci keamanan lagi.

**Cara B: skrip `ambil-token` (cadangan)**

Setelah langkah instalasi di bawah, jalankan di terminalmu sendiri:

```bash
npm run ambil-token
```

Skrip meminta NIM dan password **di terminalmu**, mengirimnya sekali ke `https://elearning.ut.ac.id/login/token.php` (endpoint yang sama dengan aplikasi Moodle resmi), lalu mencetak token. Password tidak disimpan di mana pun dan tidak pernah lewat Claude. Kalau muncul error seperti `enablewsdescription` atau `servicenotavailable`, berarti UT menonaktifkan akses aplikasi seluler; lihat bagian **Jalur cadangan** di bawah.

**Jaga token seperti password.** Siapa pun yang punya token bisa membaca data elearning-mu. Jangan tempel token di chat, jangan unggah ke GitHub. Kalau bocor, hapus/reset di halaman Kunci keamanan.

## 3. Instalasi & uji token

```bash
cd mcp-elearning
npm install
npm run build
```

Uji token tanpa Claude (macOS/Linux):

```bash
MOODLE_TOKEN=tokenmu npm run cek
```

Windows PowerShell:

```powershell
$env:MOODLE_TOKEN="tokenmu"; npm run cek
```

Hasil yang diharapkan:

```
OK: terhubung ke ... sebagai TAMLICA MUHAIMIN (userid ...), Moodle 4.x
Semua fungsi baca yang dibutuhkan tersedia.
Mata kuliah terdaftar: 3
  - [12345] Analisis dan Perancangan Sistem
  ...
```

Kalau ada baris "Fungsi yang TIDAK diizinkan token ini", tool yang memakai fungsi itu akan memberi pesan error yang jelas, tool lain tetap jalan.

## 4. Pasang di Claude Desktop

Buka **Settings → Developer → Edit Config** (file `claude_desktop_config.json`), lalu tambahkan:

```json
{
  "mcpServers": {
    "elearning-ut": {
      "command": "node",
      "args": ["/PATH/LENGKAP/ke/mcp-elearning/dist/index.js"],
      "env": {
        "MOODLE_BASE_URL": "https://elearning.ut.ac.id",
        "MOODLE_TOKEN": "tokenmu"
      }
    }
  }
}
```

Di Windows tulis path seperti `"C:\\Users\\Mika\\mcp-elearning\\dist\\index.js"` (backslash ganda). Simpan, lalu **tutup dan buka ulang** Claude Desktop. Tool `ut_...` akan muncul di ikon tools.

## 5. Pasang di Claude Code

```bash
claude mcp add elearning-ut --scope user \
  -e MOODLE_BASE_URL=https://elearning.ut.ac.id \
  -e MOODLE_TOKEN=tokenmu \
  -- node /PATH/LENGKAP/ke/mcp-elearning/dist/index.js
```

Cek dengan `claude mcp list`, atau ketik `/mcp` di dalam Claude Code.

## 6. Tool yang tersedia

| Tool | Kegunaan |
|---|---|
| `ut_profil` | Cek token: nama, versi Moodle, fungsi yang diizinkan |
| `ut_daftar_mata_kuliah` | Mata kuliah aktif (atau semua) beserta `course_id` |
| `ut_isi_mata_kuliah` | Materi per sesi: file, tautan, halaman, kuis, tugas, diskusi, tanggal, status selesai, sesi yang masih terkunci |
| `ut_baca_halaman` | Isi teks aktivitas bertipe Halaman (inisiasi, pengantar) |
| `ut_daftar_kuis` | Judul, buka/tutup, batas waktu, maks percobaan, status, nilai terbaik |
| `ut_daftar_tugas` | Judul, tenggat, batas akhir, status pengiriman & penilaian |
| `ut_detail_tugas` | Instruksi lengkap, lampiran soal, bentuk pengiriman (file/teks, tipe file), batas kata, nilai & umpan balik tutor |
| `ut_daftar_diskusi` | Forum diskusi dan topik/soal diskusinya (tanpa memposting) |
| `ut_tenggat_mendatang` | Semua tenggat N hari ke depan, urut terdekat |

Contoh pertanyaan ke Claude:

- "Tugas apa saja yang belum aku kirim minggu ini?"
- "Tampilkan materi sesi 3 Analisis dan Perancangan Sistem."
- "Baca instruksi Tugas 1 Proses Bisnis, lalu bantu aku menyusun kerangkanya."
- "Kuis apa yang tutup dalam 3 hari?"

Semua waktu ditampilkan dalam WIB (`Asia/Jakarta`). Ubah dengan env `MOODLE_TIMEZONE` bila perlu.

## 7. Batasan

- **Read-only dikunci di kode.** `src/moodle.ts` punya daftar putih 12 fungsi Moodle bertipe `get`. Fungsi lain (misalnya `mod_assign_save_submission`, `mod_quiz_start_attempt`) ditolak sebelum request dikirim. Ini diuji di `test/e2e.test.mjs`.
- **Belum diuji di situs UT asli.** Bentuk respons mengikuti dokumentasi Moodle 4.x; bisa ada perbedaan kecil di instalasi UT.
- **Bergantung pada izin UT.** Kalau UT menonaktifkan Web Services untuk mahasiswa atau membatasi fungsi tertentu, tool terkait akan gagal dengan pesan "tidak diizinkan".
- **File materi (PDF, BMP) tidak diunduh.** Tool hanya memberi nama file dan tautannya (tanpa token). Buka tautan di browser yang sudah login, atau unduh lalu lampirkan ke Claude.
- **Isi soal kuis tidak dibaca.** Hanya info kuis (judul, waktu, status, nilai). Soal kuis baru bisa dilihat dengan memulai percobaan, dan itu sengaja tidak didukung.
- **Diskusi:** hanya postingan pembuka tiap topik (soal diskusi), bukan seluruh balasan.
- **Teks panjang dipotong** (instruksi tugas 12.000 karakter, halaman 20.000) agar percakapan tidak terlalu berat.
- **Token kedaluwarsa:** kalau muncul "Token salah atau kedaluwarsa", buat token baru dan ganti di konfigurasi.

## 8. Jalur cadangan: Playwright (belum dibangun)

Kalau ternyata UT memblokir Web Services/token untuk mahasiswa, alternatifnya adalah membaca halaman elearning lewat browser otomatis:

1. Server membuka Chromium dengan **profil browser terpisah yang persisten** (`launchPersistentContext`).
2. Pertama kali, jendela browser terbuka dan **kamu login sendiri** di sana. Server tidak pernah melihat password; ia hanya memakai cookie sesi yang tersimpan di profil itu.
3. Tool yang sama (`ut_daftar_mata_kuliah`, `ut_isi_mata_kuliah`, dst.) membaca HTML halaman `my/courses.php`, `course/view.php?id=…`, `mod/assign/view.php?id=…`, `mod/quiz/view.php?id=…` dan mengekstrak teksnya.
4. Hanya navigasi GET; tidak ada klik tombol "Kirim", "Mulai percobaan", atau isi formulir.

Kekurangannya: lebih lambat, rapuh bila tema elearning berubah, dan perlu login ulang saat sesi habis. Karena itu jalur ini baru dibangun kalau `npm run cek` membuktikan jalur token tidak bisa dipakai.

## 9. Struktur kode

```
src/
  moodle.ts       klien REST + daftar putih fungsi read-only
  tools.ts        definisi 9 tool MCP
  format.ts       HTML → teks, waktu WIB, hapus token dari URL
  config.ts       baca MOODLE_BASE_URL / MOODLE_TOKEN dari env
  index.ts        entry point server (stdio)
  cek.ts          npm run cek
  ambil-token.ts  npm run ambil-token
test/
  mock-moodle.mjs Moodle tiruan dengan data fiktif
  e2e.test.mjs    uji end-to-end lewat protokol MCP asli
```

Menjalankan uji: `npm test`.
