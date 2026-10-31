# Flow MCP Studio Desktop — Windows 10/11 x64

Status: konfigurasi installer NSIS tersedia untuk validasi. Keberhasilan build
atau CI tidak membuktikan kompatibilitas installer pada PC Windows 10/11.
Installer belum ditandatangani; jangan menyatakan siap rilis sebelum checklist
manual selesai. Tidak ada akses Google Flow atau pengeluaran kredit dalam tes.

## Menjalankan dari source

Gunakan Node.js 24 LTS (atau Node >=22.12), npm dan Google Chrome x64. Dari root:

```powershell
npm ci --include=dev --include=optional
npm test
npm run desktop
```

Layar persiapan berbahasa Indonesia memeriksa lokasi Chrome tanpa menjalankannya.
FFmpeg dan ffprobe opsional; instal `winget install Gyan.FFmpeg` untuk pemrosesan
video. Restart aplikasi setelah mengubah PATH atau variabel lingkungan. Paket
Electron membawa runtime sendiri; pengguna installer tidak memerlukan Node.js.

Jika Chrome tidak terdeteksi, atur lokasi executable sebelum menjalankan aplikasi:

```powershell
$env:FLOW_MCP_CHROME = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run desktop
```

Variabel lama tetap berlaku: `FLOW_MCP_HOME`, `FLOW_MCP_OUTPUT`, `FLOW_MCP_PORT`
(default 8787), `FLOW_MCP_CDP_PORT` (default 9333), `FLOW_MCP_FFMPEG`, dan
`FLOW_MCP_FFPROBE`. Port Studio desktop harus 1–65535. Jangan gunakan direktori
shared/tidak tepercaya untuk data pengguna. Tidak ada kredensial yang dibundel.

“Buka Studio” memuat Studio yang sama dengan `npm run studio`. Studio lama masih
berbahasa Inggris; layar awal, kegagalan launcher dan dialog penutupan desktop
berbahasa Indonesia. Studio memeriksa status Flow otomatis setelah dibuka, sehingga
dapat membuka Chrome dan menghubungi Google. Login tetap dilakukan secara normal
di Chrome eksternal. Tidak ada login Google di Electron atau bypass autentikasi.

Profil tetap `<FLOW_MCP_HOME atau ~/.flow-mcp>/chrome-profile`; desktop tidak
menyalin, menghapus, atau memigrasikannya. Data lokal dan token backend tetap pada
lokasi lama. State UI Electron tersimpan terpisah dari localStorage browser web
lama; proyek dan media menggunakan backend/lokasi output yang sama.

`npm start`, `npm run studio`, `npm run login`, bin `flow-mcp`, serta 20 tool MCP
tetap tersedia. Launcher `.cmd` lama tetap membuka versi web.

## Lifecycle dan keamanan

- Satu instance desktop per pengguna. Utility process memuat LocalCore dan server
  lama; port tetap `127.0.0.1`. CDP Chrome diberi alamat loopback eksplisit.
- Bila MCP/Studio lain memiliki port, desktop memakai owner itu. Tidak ada core
  kedua yang mengerjakan generasi. Health yang tidak dapat dikonfirmasi gagal
  tertutup; server milik proses lain tidak dihentikan atau diambil alih.
- Saat ditutup, backend milik desktop menolak berhenti selama queue atau request
  aktif. Tunggu pekerjaan selesai lalu tutup lagi. Backend MCP lain dan Chrome
  eksternal tetap hidup. Tidak ada retry generasi atau restart otomatis saat crash.
- Shutdown normal menutup server lalu utility process. Force-kill/OS crash tetap
  dapat memutus pekerjaan; queue belum persisten. Periksa hasil di Chrome sebelum
  mengulang generasi yang hasilnya belum jelas. Main-process crash/force-kill tidak
  menjamin subprocess media selesai; pemulihan crash memerlukan pekerjaan lanjut.
- contextIsolation, sandbox, webSecurity aktif; nodeIntegration/webview nonaktif.
  Studio tidak memiliki preload atau IPC. Preload layar awal hanya menyediakan
  check/start tanpa argumen; main memverifikasi sender dan main frame.
- Navigasi, redirect, permission, download browser, dan popup dibatasi. Satu link
  HTTPS AI Studio yang tepat boleh dibuka di browser eksternal setelah dialog.
  Media disimpan melalui backend, bukan download manager Electron.
- Request renderer hanya ke origin backend atau media data/blob. Font Google
  diblokir dan memakai fallback lokal. CSP Studio memakai hash inline script dari
  HTML backend; object/frame/form dan koneksi eksternal diblokir. Token HTTP,
  validasi Host, serta containment path/symlink dari main dipertahankan.
- Host lokal dengan izin pengguna yang sama bukan boundary sandbox OS. Tetap
  gunakan akun dan direktori privat. Aplikasi tidak memproteksi dari malware lokal.

## Pengujian tanpa Google

```powershell
npm test
npm run desktop:smoke
npm audit --audit-level=high
npm audit --omit=dev
```

`npm test` mencakup suite keamanan/protokol lama, registrasi/panggilan 20 tool,
backend desktop owner/client, port konflik, shutdown busy, API bertoken dan
kebijakan URL/CSP. Smoke memakai Electron asli dan backend palsu: layar awal,
peringatan FFmpeg opsional, perpindahan ke Studio, API localhost, isolasi renderer,
pemblokiran jaringan eksternal, dan penutupan yang membiarkan owner tetap hidup.
`FLOW_MCP_CHROME` pada smoke menunjuk executable Node yang hanya diperiksa
keberadaannya; fixture palsu tidak menjalankannya. Tidak ada flag `--no-sandbox`.
Linux memerlukan display/Xvfb dan dependensi sistem Electron. Tes smoke tidak
mengubah profil Chrome pengguna; semua data dibuat di direktori sementara.

Jangan jalankan `scripts/e2e.mjs` untuk validasi offline: skrip tersebut dapat
memakai Flow/kredit. Smoke menggunakan fixture dari `test/`, yang tidak dibundel.

Audit penuh dengan electron-builder 26.18.0 saat implementasi melaporkan temuan
moderate pada rantai alat packaging (minimatch), tanpa high/critical. Dependency
produksi tetap diaudit tanpa toleransi; CI lengkap memblokir high/critical dan
menampilkan temuan moderate. Tidak ada override major minimatch atau downgrade
builder untuk menyembunyikan advisori. Perbarui alat packaging ketika upstream
menyediakan perbaikan yang kompatibel.

## Membuat installer untuk validasi

Pada mesin Windows x64:

```powershell
npm ci --include=dev --include=optional
npm test
npm run desktop:smoke
npm run package:win
```

Hasil: `release/Flow-MCP-Studio-0.1.0-win-x64-setup.exe`. Target NSIS per-user,
installer interaktif, shortcut Start Menu/desktop dan pemilihan direktori.
`--publish never` mencegah publikasi. Build memasukkan `dist`, aset startup,
`studio/index.html` dan dependency runtime; tidak memasukkan profil, token,
fixture, `.env`, atau repo. Playwright di-unpack dari ASAR untuk executable lokal.
Tidak ada Chrome, FFmpeg, whisper/model atau kredensial yang dibundel.

Workflow `desktop-windows.yml` menguji Electron dengan backend palsu dan membuat
installer tanpa signing untuk review. Artefak diberi nama `unvalidated`. Hasil CI
harus dibaca; runner Windows terbaru bukan bukti Windows 10/11 atau pengujian
installer yang sudah terpasang. `npm run package:dir` membuat paket unpacked pada
platform host untuk inspeksi, bukan klaim kompatibilitas Windows. Untuk smoke
paket unpacked, set `FLOW_DESKTOP_SMOKE_EXECUTABLE` ke executable paket lalu jalankan
`npm run desktop:smoke`; opsi ini hanya dibaca runner pengujian, bukan aplikasi.

## Checklist manual Windows (belum dinyatakan lulus)

1. Uji terpisah pada Windows 10 x64 dan Windows 11 x64, akun non-admin, path dengan
   spasi/Unicode: install, shortcut, launch, uninstall, dan install ulang. Catat
   versi Windows/Electron, log, dan hasil. Uji lokasi Program Files yang read-only.
2. Tanpa Chrome: pesan dan tombol disabled. Instal Chrome machine-wide/per-user;
   cek deteksi. Tanpa FFmpeg: Studio boleh dibuka; pesan opsional tampil. Cek custom
   path dan PATH baru setelah restart. Jangan membuka Studio nyata dalam tes offline.
3. Dengan fixture offline: buka/tutup dua kali, satu instance, port konflik,
   backend MCP yang sudah ada, owner desktop, busy shutdown dan port dilepas.
   Putuskan utility process: pesan error muncul dan tidak retry otomatis.
4. Inspeksi bind dengan `Get-NetTCPConnection`: Studio dan CDP hanya loopback;
   koneksi dari perangkat LAN harus ditolak. Uji Host/token salah dan link eksternal.
5. Dengan profil Chrome yang sudah ada, lakukan pengujian login secara manual
   hanya jika diotorisasi terpisah. Jangan menghapus profil, membuka Google Flow,
   atau melakukan generasi/kredit sebagai bagian validasi task ini.
6. Uji assembly klip sintetis, upload, preview/media, serta jalur output symlink/
   junction. Uji speech/caption lokal hanya dengan dependensi yang memang tersedia.
7. Tentukan sertifikat code signing dan prosedur rilis. Jangan menonaktifkan
   SmartScreen atau menandai installer aman tanpa verifikasi. Uji update/uninstall
   mempertahankan profil dan media. Auto-update belum diimplementasikan.
