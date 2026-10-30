# TASK 02 — Hardening keamanan dan pengujian offline

Tanggal: 30 Oktober 2026. Branch implementasi: `feat/security-hardening-offline-tests`, berangkat dari `docs/flow-mcp-studio-windows-audit` (audit `ae9cf6c`). Dokumen audit sebelumnya dipertahankan sebagai catatan historis; status terkini ada di sini.

## Perubahan perilaku keamanan

### Nama proyek dan output

`src/paths.ts` menyediakan validasi nama portabel, containment berbasis `relative` dan canonical path, serta pemeriksaan setiap komponen menggunakan `lstat`. Nama `.`/`..`, pemisah direktori, path absolut/drive/UNC, ADS (`:`), karakter kontrol/karakter terlarang Windows, device names (termasuk ekstensi dan angka superscript), whitespace tepi, titik akhir, dan nama lebih dari 240 byte UTF-8 ditolak. Skema MCP/HTTP memvalidasi nama sebelum logika driver; panggilan `LocalCore` langsung juga diperiksa.

Untuk nama yang valid, pemetaan ASCII lama tetap dipakai (`Hotel Promo` menjadi `Hotel_Promo`) agar folder proyek lama tidak berpindah. Ini belum menyelesaikan benturan nama Unicode/normalisasi/case-insensitive; misalnya nama non-ASCII dapat menjadi `_`. Nama yang sebelumnya diam-diam disanitasi dari path atau karakter ilegal sekarang menghasilkan error. File/proyek lama dengan nama terlarang perlu diganti namanya secara manual di luar aplikasi; tidak ada migrasi/penghapusan otomatis.

Direktori root yang dikonfigurasi melalui `FLOW_MCP_OUTPUT` dan `FLOW_MCP_HOME` tetap dianggap tepercaya, termasuk bila root sengaja dipindahkan lewat symlink. Di bawah root, symlink/junction ditolak, termasuk link yang masih menunjuk ke dalam root dan link menggantung. File dengan lebih dari satu hardlink juga ditolak. Folder `uploads`/`captions` tidak boleh dipindahkan lewat link tersendiri karena keduanya berada di bawah state root.

### Pembacaan media dan operasi file lain

- `/media` hanya membuka regular file yang aman di output, uploads atau cache caption. File dibuka dengan `O_NOFOLLOW` bila tersedia, dibandingkan identitas device/inode sebelum/sesudah pembukaan, lalu dialirkan memakai descriptor yang sama. Descriptor ditutup saat stream selesai/error atau klien terputus. Path yang ditolak mendapat 404, tanpa isi file eksternal.
- HTTP Range mendukung satu rentang normal, open-ended dan suffix; rentang invalid/tidak terjangkau mendapat 416. Multi-range belum didukung.
- `discard` memvalidasi target sebelum memanggil Trash/Recycle Bin. Root output sendiri, target di luar root, link/junction dan hardlink ditolak. Tidak ada pengujian yang benar-benar memanggil Recycle Bin/Trash pengguna.
- Galeri mengabaikan link dan entri yang bukan regular media file. Output assembly, track narasi, frame chaining, caption/SRT, portrait dan hasil download diperiksa pada batas operasi file. Input media yang dipilih pengguna di luar output tetap dapat dibaca untuk assembly/transkripsi; ini kapabilitas yang sengaja dipertahankan, bukan sandbox semua input.
- Cache caption/model, token, metadata karakter dan key Gemini menggunakan pemeriksaan state path. Profil Chrome tidak boleh berupa link di bawah state root. RemoteCore memeriksa path token yang dibacanya.
- Upload menggunakan nama acak 128-bit, mode privat POSIX dan create-exclusive (`wx`), dengan pemeriksaan ulang setelah body diterima. Tidak menimpa file yang sudah ada. Dispatch HTTP terbatas pada metode yang dideklarasikan dalam `shapes`, sehingga metode prototype tidak dapat dipanggil.
- Cleanup PCM Gemini memakai `fs.rmSync`, menggantikan command `rm` yang tidak tersedia secara default pada Windows.

### Ekstraksi ZIP

Ekstraksi `tar/unzip` diganti dengan `fflate` (MIT, tanpa dependensi transitif). Entri didekode sebagai data file biasa; atribut symlink Unix tidak menghasilkan link filesystem. Semua nama diperiksa sebelum penulisan. Path absolut, `..`, backslash, device Windows dan target link ditolak; file yang sudah ada tidak ditimpa. Metadata tersembunyi dan `__MACOSX` tidak masuk daftar takes.

Batas baru: arsip terkompresi maksimal 512 MiB; ukuran deklarasi per entri maksimal 512 MiB; total dekompresi maksimal 1 GiB; maksimal 10.000 entri. Arsip besar/encrypted/malformed dan fitur arsip yang tidak didukung decoder dapat gagal. Decoder sinkron masih memakai memori dan CPU proses; limit ini bukan sandbox dekompresi penuh. Pemrosesan streaming/worker untuk arsip besar menjadi pekerjaan lanjutan.

## Tinjauan delapan paket rentan

Pembaruan tetap dalam rentang major yang kompatibel; tidak memakai `--force`, overrides paksa, atau mematikan verifikasi TLS/integritas npm. SDK MCP dan Zod dinaikkan batas minimalnya pada manifest. Enam paket transitif diperbarui pada lockfile di dalam rentang yang diizinkan parent.

| Paket | Sebelum | Sesudah |
| --- | --- | --- |
| `@modelcontextprotocol/sdk` | 1.30.0 | 1.32.2 |
| `zod` | 4.6.5 | 4.6.7 |
| `@hono/node-server` | 2.1.1 | 2.1.5 |
| `body-parser` | 2.3.0 | 2.4.0 |
| `fast-uri` | 3.1.8 | 3.1.9 |
| `hono` | 4.13.8 | 4.13.14 |
| `ip-address` | 10.7.2 | 10.7.5 |
| `qs` | 6.16.0 | 6.17.1 |

Dependensi baru `fflate` 0.8.3 hanya untuk decoder ZIP lokal. Playwright tetap 1.63.0 untuk membatasi perubahan driver browser yang belum dapat diuji terhadap Flow. Hasil `npm audit` pada lockfile baru: **0 vulnerability**, dibandingkan 8 paket (3 high, 5 moderate) pada audit sebelumnya. Ini hasil advisori registry saat pemeriksaan, bukan jaminan tidak ada cacat keamanan atau advisori baru di masa depan.

## Pengujian dan cara mengulang

```sh
npm ci --include=dev --include=optional --no-audit --no-fund
npm run build
npm test
npm audit
```

`npm test` sekarang melakukan build dan menjalankan Node test runner; bukan placeholder. Tidak membutuhkan key, profil login, browser atau akun Google. Test server memakai backend fixture yang hanya menyediakan operasi lokal; panggilan fetch keluar pada fixture dinonaktifkan. MCP hanya memanggil `flow_techniques`; UI diambil sebagai HTML tanpa dieksekusi. Script manual `scripts/e2e.mjs` tetap terpisah dan tidak dipanggil oleh suite.

| Pemeriksaan aktual Codex Cloud Linux | Hasil |
| --- | --- |
| Instalasi bersih lockfile | Lulus; 100 paket terpasang. |
| `npm run build` | Lulus. |
| Build + test Node 24.19.0 | 74 test lulus, 0 gagal, 0 skipped. |
| Build + test Node 22.23.4 | 74 test lulus, 0 gagal, 0 skipped. |
| `npm audit` | Lulus exit 0; 0 vulnerability. |
| Media sintetis FFmpeg 7.1.5 | Assembly dua klip menjadi video ~2 detik dengan audio, serta ekstraksi frame lulus pada kedua runtime. |
| MCP | Seluruh 20 tool masih terdaftar; initialize/list/call melalui RemoteCore lulus. |
| Studio | HTML/token, API lokal, upload/media dan autentikasi lulus; UI browser/Google tidak dijalankan. |
| Windows native / GitHub Actions | Workflow disiapkan; hasil runner Windows belum diverifikasi dari sesi cloud ini. |

Suite meliputi kedua regresi audit, nama portabel, symlink/junction pada output/upload/cache, hardlink, link menggantung, containment discard, output media/voice/caption, ekstraksi ZIP aman dan batas ukurannya, schema kredit, serialisasi/cancel/retry antrean, HTTP Host/token/allowlist, range dan MCP. Semua data memakai direktori sementara dan dibersihkan. Tidak ada login atau generasi Flow, permintaan Gemini, download model, atau kredit video yang dipakai.

`.github/workflows/offline-tests.yml` menambahkan matriks `ubuntu-latest`/`windows-latest` dengan Node 22/24, install frozen lockfile, build/test dan audit, tanpa secret dan dengan permissions `contents: read`. Junction dan hardlink wajib diuji pada Windows; tiga kasus khusus file symlink dilewati di Windows karena memerlukan Developer Mode/hak khusus. Test media sintetis dilewati secara eksplisit jika FFmpeg/ffprobe tidak tersedia. Tidak ada test wajib yang diam-diam diganti dengan pemeriksaan trivial.

`windows-latest` bukan bukti kompatibilitas GUI Windows 10 atau Windows 11. Pengujian manual pada kedua OS, SAPI/Recycle Bin, browser headed, installer dan ARM64 masih diperlukan.

## Inventaris file berubah

| File | Perubahan |
| --- | --- |
| `src/paths.ts` | Helper nama, canonical containment, link/hardlink guard dan descriptor media. |
| `src/core.ts` | Skema nama proyek; guard antrean/discard/output; galeri dan pemilihan output caption. |
| `src/server.ts` | Media aman, upload exclusive, allowlist metode, Range dan lifecycle descriptor. |
| `src/remote.ts` | Pemeriksaan file token sebelum dibaca. |
| `src/chrome.ts` | Pemeriksaan direktori profil sebelum launch. |
| `src/assemble.ts`, `src/chain.ts` | Validasi nama dan target output FFmpeg/narasi/frame. |
| `src/captions.ts` | Guard cache/model, target preview dan video/SRT caption. |
| `src/flow.ts` | Guard filesystem download/portrait/metadata; selector dan alur automation tetap. |
| `src/gemini.ts` | Guard key/PCM/output dan cleanup portable Windows. |
| `src/platform.ts` | Ekstraksi ZIP terkontrol tanpa tar/unzip. |
| `package.json`, `package-lock.json` | Test runner, update keamanan kompatibel dan decoder ZIP. |
| `tests/paths.test.mjs` | Regresi traversal, link/junction/hardlink, output dan ZIP. |
| `tests/server.test.mjs`, `tests/helpers/fixture.mjs` | Integrasi HTTP/MCP memakai backend lokal. |
| `tests/queue.test.mjs` | Antrean fake runner, validasi input/kredit dan caption alignment. |
| `tests/media.test.mjs` | Integrasi FFmpeg dengan input sintetis; opsional bila executable tidak tersedia. |
| `.github/workflows/offline-tests.yml` | Matriks CI Linux/Windows Node 22/24. |
| `README.md` | Cara menjalankan test offline dan batasannya. |
| Tiga dokumen audit TASK 01 | Penanda snapshot historis dan tautan status terbaru; audit asli tetap tersimpan. |
| `docs/SECURITY_HARDENING.md` | Ringkasan implementasi, bukti validasi dan batas keamanan ini. |

## Risiko tersisa dan skenario tidak didukung

1. **Proses lokal yang dapat memodifikasi direktori aplikasi tidak dianggap terisolasi.** Pemeriksaan path, descriptor dan identitas file mempersempit race, tetapi operasi FFmpeg/Chrome/PowerShell serta write berbasis path tidak memiliki primitive `openat`/handle-relative lintas platform. Pergantian ancestor secara bersamaan oleh proses dengan hak filesystem yang sama tidak dapat dijamin sepenuhnya tertutup. Gunakan root privat milik user, hindari writable bersama, dan jangan menjalankan sebagai administrator. Root konfigurasi tepercaya tidak boleh diganti oleh proses lain saat aplikasi berjalan.
2. **Link di bawah root ditolak secara konservatif.** Relokasi project/cache lewat symlink/junction atau pemakaian hardlink tidak didukung. Root output/home yang dikonfigurasi boleh direlokasi secara sengaja. Fitur ini tidak mengisolasi pembacaan media eksternal yang dipilih pengguna.
3. **Sesi dan secret Windows belum memakai Credential Manager/DPAPI.** Mode POSIX 0600 bukan bukti ACL Windows. Token URL media, Origin/CSP dan threat model proses lokal masih memerlukan pekerjaan lanjutan sebelum shell desktop diberi hak tambahan.
4. **Ketahanan antrean belum berubah.** State job dan slow-task masih di memori; crash bisa membuat hasil berbayar ambigu. Edit/continue tetap membutuhkan persetujuan biaya dan tidak memiliki kutipan awal yang universal. Tidak ada pengujian Google nyata dalam PR ini.
5. **Integritas model caption belum memakai checksum terpin.** TLS tetap aktif dan pemeriksaan ukuran lama tetap tersedia; transkripsi, render caption penuh dan download model belum divalidasi di sini.
6. **Kompatibilitas media/Windows belum lengkap.** Rename lintas volume (`EXDEV`), file terkunci/antivirus, disk penuh, long path OS, ACL, PowerShell/SAPI/Recycle Bin dan migrasi state memerlukan test Windows lanjutan. Nama valid menurut aturan portabel masih bisa ditolak OS karena path total atau kebijakan volume.
7. **ZIP sinkron dan batas ukuran baru dapat menolak arsip yang sebelumnya diterima.** Arsip diperlakukan sebagai file data biasa, tidak melestarikan symlink, executable mode, atau metadata khusus. Ekstraksi dapat menyisakan file di direktori temp bila gagal di tengah; pembersihan temp download lebih lanjut masih diperlukan.
8. **Belum aplikasi desktop terpaket.** Electron tidak dipasang. UI Studio, 20 tool MCP dan browser driver dipertahankan, tetapi fungsi Google Flow hanya ditinjau statis dan tidak diklaim terverifikasi end-to-end. Rilis installer/signing/upgrade dan Windows 10/11 nyata tetap pekerjaan roadmap.
