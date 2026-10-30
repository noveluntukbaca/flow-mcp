# Roadmap Flow MCP Studio

> Snapshot audit TASK 01. Untuk perbaikan TASK 02, hasil test terkini dan risiko tersisa, lihat [SECURITY_HARDENING.md](SECURITY_HARDENING.md).

Tujuan: aplikasi desktop Windows 10/11 dengan backend Flow MCP yang dapat diuji, pengeluaran kredit eksplisit, distribusi aman dan alur lokal yang tetap berguna tanpa login. Audit dokumentasi ini tidak mengubah fungsi utama. Prioritas berdasar [temuan arsitektur](ARCHITECTURE.md) dan [matriks Windows](WINDOWS_COMPATIBILITY.md).

## Tahap 0 — baseline dan keputusan produk

**Hasil:** spesifikasi rilis awal, kontrak yang dipertahankan dan matriks OS/CPU/runtime. Pertahankan stdio MCP agar integrasi klien yang ada tetap berjalan.

- Putuskan baseline Windows 10/11 yang benar-benar diuji, x64 terlebih dahulu, dan strategi Node runtime terbundel.
- Inventarisasi state pengguna, profil Chrome, output, key dan aturan migrasi/uninstall. Tetapkan bahwa sesi Google tidak disimpan ke artefak build atau snapshot bersama.
- Pisahkan fitur wajib (Studio lokal, antrean, MCP, impor/assembly) dari opsional (FFmpeg, whisper, TTS Gemini) dengan indikator kapabilitas.
- Rekonsiliasi versi package `0.1.0` dan MCP `0.2.0`, entrypoint `main`, pin toolchain dan pernyataan kompatibilitas README pada PR implementasi tersendiri.

**Kriteria selesai:** spesifikasi penerimaan disepakati dan setiap klaim dukungan memiliki check yang dapat dijalankan. Klaim kredit gratis/kuota harus merujuk ketentuan layanan terkini, bukan asumsi audit.

## Tahap 1 — keamanan path, dependensi dan test offline (P1)

**Hasil:** baseline yang bisa diregresikan tanpa Google atau biaya.

- Perbaiki containment project `..`, canonical path media serta junction/symlink; tambahkan kasus nama perangkat Windows, Unicode, drive dan overwrite. Uji semua operasi file yang berhubungan, termasuk discard dan caption output.
- Tinjau upgrade SDK MCP/Zod serta paket transitif berdasarkan advisori. Jangan mengubah lockfile tanpa menjalankan regresi. Target penerimaan: tidak ada advisori high/critical yang belum ditangani atau diberi justifikasi jalur risiko yang terdokumentasi.
- Ganti placeholder `npm test` dengan suite nyata. Gunakan runner Node atau alat yang disepakati; jangan memasukkan pengujian berbayar ke default test.
- Tambahkan fake browser/driver boundary, test queue serial/cancel/retry, schema validation, timeout/task, owner-client, konflik port, token/Host, upload/range/media containment serta assembly sintetis.
- Jalankan matriks Linux dan Windows. Verifikasi Node minimum dan runtime distribusi; pastikan optional binary TypeScript tersedia.

**Kriteria selesai:** install/build/test offline lulus pada runner target, A1/A2 memiliki regression test, laporan dependency audit ditinjau. Tidak ada permintaan ke akun Flow pada job default.

## Tahap 2 — pemisahan backend dan ketahanan pekerjaan

**Hasil:** backend reusable bagi MCP, HTTP dan shell desktop.

- Pisahkan adapter Flow, media, secret store dan filesystem dari orkestrasi `LocalCore` dengan dependency injection. Pertahankan nama/skema tool atau dokumentasikan migrasi.
- Tambahkan journal job dan state recovery. Setelah crash, tandai hasil ambigu dan rekonsiliasi aset; jangan otomatis mengulang aksi yang mungkin sudah menggunakan kredit.
- Satukan kebijakan kepemilikan backend/profil/CDP, termasuk instance dengan port HTTP berbeda; tambahkan shutdown dan restart yang dapat diprediksi.
- Bedakan status backend lokal dari status akun Flow. Buat mode offline agar boot UI tidak memanggil `status`/`characters` ke Google sampai pengguna memilih menghubungkan.
- Tambahkan konfirmasi biaya khusus untuk edit/continue yang tidak punya kutipan; cap pada generate bukan perlindungan universal. Kebijakan UI dan MCP harus konsisten.
- Tangani cross-volume rename, file lock, disk penuh dan log yang meredaksi token/key/prompt sensitif. Hindari pekerjaan FFmpeg panjang memblokir respons UI.

**Kriteria selesai:** kedua frontend memakai backend yang sama, recovery tidak menduplikasi aksi berbayar, dan seluruh skenario kegagalan utama punya test offline.

## Tahap 3 — shell desktop Windows dan data pengguna

**Rekomendasi awal:** prototipe Electron karena backend saat ini Node/TypeScript dan UI vanilla HTML. Ini pilihan desain untuk dievaluasi, belum dependensi repository. Tauri lebih kecil tetapi menambah Rust, WebView2 dan distribusi sidecar Node; pilih bila ukuran/resource memberi manfaat terukur.

- Bundel runtime Node dan UI beserta file `studio/index.html`; jangan berasumsi folder dist cukup. Tentukan backend sebagai proses terpisah atau modul main dengan kontrak lifecycle jelas.
- Renderer tanpa Node integration, context isolation dan sandbox; preload/IPC minimum dengan validasi input. Jangan memberikan arbitrary filesystem/shell kepada renderer.
- Batasi navigasi, tautan eksternal dan API localhost; tinjau CSP, Origin, token URL serta persistensi localStorage. Pertahankan Chrome eksternal untuk login Google.
- Sediakan setup wizard berisi deteksi Chrome, FFmpeg/whisper opsional dan lokasi output. Tombol login hanya membuka profil khusus; pengguna memasukkan kredensial sendiri.
- Simpan data writable per-user, key lewat penyimpanan OS yang sesuai, dan migrasi backup dari state lama. Tambahkan single-instance, tray jika diperlukan, dialog close saat pekerjaan aktif dan diagnostik aman.

**Kriteria selesai:** aplikasi dapat dibuka pada Windows bersih tanpa Node global, UI offline berfungsi, tidak ada kredensial dalam renderer/log/paket, dan klien MCP eksternal masih dapat terhubung.

## Tahap 4 — media dan distribusi Windows

- Validasi FFmpeg/ffprobe, codec dan lisensi distribusi; tentukan bundling versus instalasi opsional dengan deteksi versi dan integritas.
- Verifikasi System.Speech, Recycle Bin, unzip/tar/curl, path Unicode/spasi/panjang, volume berbeda, font caption, model whisper dan kebutuhan DLL/CPU.
- Tambahkan checksum model terpin dan alur download yang dapat dilanjutkan/diperiksa; jangan menonaktifkan TLS/checksum untuk melewati kegagalan.
- Buat installer per-user (misalnya NSIS melalui electron-builder jika Electron dipilih), metadata/icon, code signing, SBOM/notice, channel rilis dan updater dengan verifikasi signature.
- CI harus memproduksi artefak deterministik sejauh memungkinkan, menjalankan pemeriksaan install/upgrade/uninstall dan menyimpan laporan. Pisahkan credential signing dari log dan repository.

**Kriteria selesai:** matriks Windows 10/11 lulus sesuai dokumen kompatibilitas, upgrade menjaga state/output, uninstall terkontrol, dan artefak bertanda tangan dapat diverifikasi. Build desktop harus berjalan pada runner yang sesuai; cloud Linux ini belum membuktikannya.

## Tahap 5 — integrasi Flow dan rilis terbatas

Tahap ini membutuhkan izin terpisah untuk mengakses Google Flow. Audit sekarang melarang akses tersebut, termasuk generasi gambar yang disebut gratis.

- Login manual pada akun uji milik pengguna, lalu cek status/project dan selector UI sesuai DOM aktual. Jangan menebak selector atau memakai mekanisme menghindari deteksi bot.
- Jalankan transaksi video hanya setelah persetujuan dan anggaran eksplisit. Catat kutipan, saldo, output dan status ambigu; uji guard biaya tanpa sengaja mengeluarkan kredit tambahan.
- Uji perubahan bahasa, profil terkunci, sleep/resume, jaringan putus, download tertunda, retry dan dua klien MCP/Studio. Hindari regenerasi sekadar karena file belum terlihat.
- Tinjau ketentuan Google, privasi, telemetri opt-in dan panduan pemulihan sebelum distribusi publik.

**Kriteria selesai:** hasil Windows dan transaksi terotorisasi terdokumentasi, tidak ada blocker P1 terbuka, serta reviewer menyetujui rilis. Merge dan publikasi tetap tindakan terpisah; audit ini tidak mengotorisasi merge otomatis.

## Status audit dan tindak lanjut review

Selesai di Codex Cloud: dependency install, build TypeScript, 10 smoke check lokal, reproduksi 2 temuan path dan audit npm (8 paket rentan). `npm test` gagal sebagai placeholder; Windows native, browser Flow, whisper penuh, installer dan signing belum dijalankan. Rincian versi dan batas bukti ada di ARCHITECTURE.md.

PR dokumentasi harus hanya berisi tiga dokumen ini. Perbaikan fungsi, test permanen, perubahan dependency dan desktop shell masuk PR lanjutan per tahap agar mudah ditinjau. Instruksi install/startup cloud disimpan pada draft environment secara terpisah, bukan mengubah kode aplikasi. Helper smoke di luar checkout hanya tersedia pada mesin/snapshot audit, bukan bagian paket produk.
