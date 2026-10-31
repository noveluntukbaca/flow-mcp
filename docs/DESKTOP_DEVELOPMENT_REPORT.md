# Laporan pengembangan Flow MCP Studio Desktop

Tanggal: 31 Oktober 2026 (Asia/Jakarta).
Basis: `main` commit `07c297adcac1561dce67a581e2d393839396be42`.
Branch: `feature/flow-mcp-electron-desktop`. Tidak melakukan merge.

## Implementasi

Electron 45.2.1 membungkus antarmuka Studio yang sudah ada. Utility process
menjalankan backend localhost, atau terhubung ke owner MCP yang sudah berjalan.
Tidak ada perubahan daftar tool MCP atau versi dependency produksi dari main.
Penutupan normal menunggu request/queue termasuk jeda antarpekerjaan; profil
Chrome eksternal dipertahankan. Renderer memakai sandbox/contextIsolation tanpa
Node; preload check/start hanya ada pada layar awal dan sender diverifikasi.
CSP memakai hash script Studio, request eksternal diblokir, permission/download/
popup/navigasi dibatasi. CDP Chrome diberi alamat loopback eksplisit.

Layar awal, dependensi dan dialog error berbahasa Indonesia. Antarmuka Studio
lama dipertahankan, termasuk bahasa Inggris dan pemeriksaan Flow saat dibuka.
Ada script desktop, smoke offline, packaging NSIS Windows x64, serta workflow
validasi Windows tanpa publikasi/merge otomatis.

## Berkas yang diubah atau ditambahkan

- `.github/workflows/desktop-windows.yml`: smoke Electron dan build installer Windows.
- `.github/workflows/offline-tests.yml`: audit penuh memblokir high/critical;
  audit dependency produksi tetap memblokir seluruh tingkat. Temuan moderate
  tooling terlihat dan didokumentasikan, bukan ditutupi override.
- `.gitignore`: abaikan scratch/cache `work/` dan hasil packaging `release/`.
- `package.json`, `package-lock.json`: Electron, builder, script dan konfigurasi NSIS.
- `src/chrome.ts`: alamat CDP loopback eksplisit.
- `src/core.ts`: getter pekerjaan tertunda untuk shutdown tanpa membaca Google Flow.
- `src/server.ts`: callback server owner opsional; kontrak role lama dipertahankan.
- `src/desktop/main.ts`: window, session, IPC, lifecycle dan single instance.
- `src/desktop/backend.ts`: ownership, health, request tracking dan shutdown.
- `src/desktop/backend-entry.ts`: bootstrap utility process dan pesan privat.
- `src/desktop/dependencies.ts`: deteksi Chrome, FFmpeg dan ffprobe.
- `src/desktop/policy.ts`: batas URL/port dan preferensi renderer.
- `src/desktop/csp.ts`: hash script dan kebijakan konten.
- `desktop/startup.html`, `desktop/startup.css`, `desktop/startup.js`: layar awal.
- `desktop/preload.cjs`: bridge minimal check/start.
- `test/desktop.test.mjs`: integrasi backend dan kebijakan keamanan desktop, termasuk normalisasi CRLF untuk hash CSP.
- `test/fixtures/desktop-smoke-backend.mjs`: backend palsu tanpa Chrome/Google.
- `studio/index.html`: handler tombol dialog/gambar dipindah ke script agar CSP ketat tetap berfungsi.
- `scripts/desktop-smoke.mjs`: pengujian Electron asli, source/paket unpacked.
- `README.md`: cara menjalankan dan tautan panduan Windows.
- `docs/DESKTOP_WINDOWS.md`: instalasi, lifecycle, keamanan, packaging dan checklist.
- `docs/DESKTOP_DEVELOPMENT_REPORT.md`: laporan ini.

## Hasil validasi lokal

Lingkungan Linux x64, Node 24.19.0, npm 11.9.0, Electron 45.2.1, Xvfb.

| Pemeriksaan | Hasil |
| --- | --- |
| `npm run build` | Lulus |
| `npm test` | 34 lulus, 0 gagal, 0 skip; termasuk 28 tes lama |
| Registrasi dan panggilan MCP | Seluruh 20 tool tetap terdaftar dan teruji melalui backend palsu |
| `npm run desktop:smoke` pada Xvfb | Lulus; layar awal → Studio → API localhost → shutdown client |
| Smoke executable paket Linux unpacked | Lulus, termasuk utility process dari ASAR dan preload |
| Security smoke | Sandbox/isolation/Node/preload, CSP hash, penolakan script baru, navigasi dan request eksternal |
| Paket unpacked Linux | Lulus dengan distribusi Electron lokal (`--config.electronDist=node_modules/electron/dist`) |
| Inspeksi ASAR | Runtime, startup dan HTML Studio tersedia; fixture/work/profil tidak dibundel |
| `npm audit --omit=dev` | 0 kerentanan |
| Audit penuh | 0 high, 0 critical; 15 moderate terkait alat packaging/minimatch |
| `git diff --check` | Lulus |

Percobaan packaging awal gagal karena cache default home read-only pada lingkungan
cloud. Pengujian diulang memakai distribusi Electron lokal dan berhasil; ini bukan
perbaikan/hasil installer Windows. Smoke dijalankan tanpa `--no-sandbox`. Semua
pengujian memakai data sementara, fixture lokal atau media sintetis. Tidak
mengakses Google Flow, login Google, Gemini, atau memakai kredit.

## Status packaging dan batasan

Konfigurasi Windows NSIS per-user x64 siap untuk validasi melalui
`npm run package:win`. Belum ada bukti pengujian installer terpasang di Windows
10/11, code signing, SmartScreen, upgrade/uninstall, dan Chrome/speech/caption
nyata. Workflow Windows tersedia untuk review; keberhasilan build CI bukan bukti
kompatibilitas installer. Tidak ada auto-update atau publikasi otomatis.

Queue belum persisten. Force-kill/OS crash dapat memutus pekerjaan/subprocess;
periksa hasil di Chrome sebelum mengulang pekerjaan ambigu. Startup tidak
meluncurkan Chrome, tetapi membuka Studio menjalankan pemeriksaan Flow normal
sesuai perilaku UI lama. UI Studio utama tetap berbahasa Inggris. Font eksternal
memakai fallback lokal di Electron. Temuan moderate dev tooling perlu diperbaiki
upstream; tidak ada high/critical baru pada audit saat implementasi.

Panduan reproduksi dan checklist manual: [DESKTOP_WINDOWS.md](DESKTOP_WINDOWS.md).

## Bukti CI Windows dan perbaikan lintas platform

Pada commit `7ceec17`, workflow [Windows desktop validation #3](https://github.com/noveluntukbaca/flow-mcp/actions/runs/41206157650)
lulus: tes offline, audit, smoke Electron, build installer NSIS x64 dan upload
artefak. Runner: Windows Server 2025; ini bukan pengujian installer terpasang pada
Windows 10/11. Suite offline Windows: 33 lulus, 1 skip karena FFmpeg/ffprobe tidak
tersedia. Matrix Linux/Windows × Node 22/24 juga lulus pada commit tersebut.

Validasi menemukan dua masalah yang sudah diperbaiki: trailing backslash argumen
path pada launcher smoke Windows, serta normalisasi CRLF/LF saat menghitung hash
CSP sesuai parser HTML Chromium. Smoke dengan HTML CRLF juga lulus di Linux.
Handler inline tombol dialog/gambar dipindahkan ke script yang di-hash agar CSP
tetap ketat dan tombol dialog tetap berfungsi; smoke source dan paket Linux
unpacked mencakup tombol tersebut dan lulus. Hasil CI untuk head PR terbaru dapat
dilihat pada tab Checks; catatan hasil di atas sengaja menyebut commit yang diuji.

PR review: [#2](https://github.com/noveluntukbaca/flow-mcp/pull/2). Tidak di-merge.
