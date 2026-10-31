# Perbaikan kompatibilitas CREATE CHARACTER

Catatan historis task 04. Alur pembuatan kini digantikan oleh
[composer native dan konfirmasi harga](NATIVE_CHARACTER_COMPOSER.md).
Instruksi potret terpisah/native form ditolak di bawah menjelaskan versi lama.

Basis: branch Electron desktop `feature/flow-mcp-electron-desktop`, commit
`c19fe8428b12ca1543c16dd8c6c23f81024df23d`. Saat investigasi, `main` masih pada
`07c297a`; perubahan desktop belum digabungkan. Branch perbaikan:
`fix/flow-character-ui-compatibility`.

## Temuan

Alur lama: tombol Studio Create character → HTTP `character` → LocalCore.character
→ createCharacter. Jika input berupa deskripsi, fungsi memanggil runGeneration
untuk menggambar potret dengan batas 0 kredit, baru membuka Characters.
runGeneration selalu membaca `getByRole('button', { name: 'Agent', exact: true })`
melalui getAttribute('aria-pressed') untuk mematikan mode Agent. Tombol itu bukan
syarat logis pembuatan gambar biasa/karakter. Bila tidak ada, pembacaan menunggu
30 detik lalu gagal sebelum kontrol Characters diperiksa. Ini cocok dengan error
Windows 11 yang dilaporkan. Tidak ditemukan penyebab pada preload/IPC Electron.

Mengapa tombol Agent tidak ada pada sesi pengguna belum dapat dipastikan tanpa
DOM/aksesibilitas sesi tersebut. Perubahan UI/rollout/kapabilitas akun, posisi
halaman/editor, menu tertutup, bahasa, dan login/akses adalah kemungkinan, bukan
hasil verifikasi langsung. Keberadaan Characters tidak membuktikan Agent atau
semua metode pembuatan tersedia. Tidak ada login, akses jaringan Google Flow,
bypass pembatasan, Gemini, ataupun pemakaian kredit dalam pekerjaan ini.

## Perilaku setelah perbaikan

- Mode non-Agent menerima composer yang dikenali: satu `.ProseMirror` editable,
  `Settings trigger`, dan `Start generation`, tanpa mensyaratkan tombol Agent.
  Agent button/switch yang tampak harus memiliki status boolean yang terbaca;
  kontrol ganda/ambigu atau status tidak diketahui gagal aman. Mengaktifkan Agent
  tetap memerlukan kontrol Agent; tidak disimulasikan lewat Characters atau Create.
- Sebelum menggambar potret, buka Characters lewat navigation button/link atau tab,
  lalu verifikasi kontrol pembuatan berbasis gambar. New/Create character diterima
  sebagai navigasi hanya pada alur yang dikenali; tombol generik Create tidak
  ditebak sebagai pengganti. Form native hanya-deskripsi tidak dikirim otomatis,
  sebab arti tombol, dukungan dan biayanya belum diketahui. UI memberi petunjuk
  membuat karakter manual di Chrome lalu Reload.
- Path image/upload dan `asset:<title>` lama dipertahankan. Label Upload image
  dapat dipakai bila kontrol itu tersedia. Pembuatan dari deskripsi tetap memakai
  generator gambar lama dengan kutipan kredit yang harus terbaca dan <=0, bukan
  memaksakan native generator baru. Tidak ada janji bahwa seluruh akun mendukungnya.
- Validasi host HTTPS/proyek, batas proyek yang sama, deteksi login/beranda/proyek
  berbeda, editor karakter yang sudah terbuka, kontrol tersembunyi/ambigu, dan ID
  editor opaque menggantikan ketergantungan UUID saja untuk alur create.
- Deteksi kapabilitas/action dibatasi sekitar 5 detik per langkah, perpindahan ke
  editor maksimal 30 detik. Operasi tidak menunggu locator Agent default 30 detik
  berulang. Pesan kegagalan membedakan tahap sebelum submit dan hasil parsial;
  potret yang sudah tersimpan ditunjukkan agar dapat dipakai ulang.
- Polling daftar Characters dan tindakan lain yang menavigasi tab ditolak selama
  create/edit karakter berjalan. Pemeriksaan status tidak membuka account panel
  saat operasi ini aktif. Desktop busy/shutdown juga mengenali operasi karakter.
- Semua 20 tool MCP tetap terdaftar. Tidak ada perubahan security preferences,
  preload atau IPC desktop. UI menunjukkan pemeriksaan kapabilitas terlebih dahulu.

## Tidak mengulang generasi berbayar/ambigu

Klik submit ditandai sebelum percobaan klik (timeout klik juga bisa ambigu).
waitForNewMedia tidak menekan Retry pada tile gagal, tidak menyatakan "Nothing was
charged", dan melaporkan timeout sebagai hasil yang mungkin sudah memakai kredit.
Inspeksi error tile kini default dry-run. Queue hanya boleh mengulang kegagalan
image sebelum submit dengan kutipan biaya 0 yang benar-benar sudah terbaca;
video, biaya tidak diketahui, batch Agent tanpa kutipan, dan semua percobaan
setelah submit tidak diulang otomatis. Retry manual MCP/Studio tetap tersedia.

Batch Agent hanya dikirim sekali. Scene yang belum terkonfirmasi tidak diminta
lagi/fallback satu-per-satu secara otomatis. File yang sudah terunduh dipertahankan;
scene yang belum lengkap ditandai untuk pemeriksaan dan Retry manual. Perubahan
ini disengaja: label gambar/Agent tidak membuktikan bahwa generasi pasti gratis.

## Pengujian offline

```powershell
npm ci --include=dev --include=optional
npm test
npm run test:flow-ui
npm run desktop:smoke
```

`npm test` memakai runner Node dan mock interaksi Playwright untuk selector,
nav/login/host, Agent opsional/ambigu, native form tidak didukung, batas waktu,
error paid/ambiguous, default dry-run dan larangan retry. Suite keamanan/protokol
lama tetap menguji registrasi dan panggilan seluruh 20 tool.

`test:flow-ui` memakai Playwright locator asli di Electron sandboxed dengan HTML
sintetis, user-data-dir sementara dan jaringan dibatasi ke host invalid fixture.
URL yang dibaca lapisan validasi diproyeksikan sebagai URL proyek Flow; semua
navigasi browser tetap `flow-fixture.invalid` dan di-fulfill dari fixture lokal,
bukan Google. Tidak menyentuh profil Chrome pengguna. Stub potret menggantikan
runGeneration. Pengujian mencakup:

- create dari deskripsi pada composer tanpa Agent, satu draw stub dan satu upload;
- Characters/tab, Create character dan Upload image, ID editor non-UUID;
- penolakan native form sebelum draw/submit;
- kegagalan setelah upload memberi peringatan hasil parsial tanpa draw/upload kedua;
- Agent-only dan kontrol generik Create gagal dengan batas waktu singkat.

Linux memerlukan display/Xvfb. Workflow Windows desktop menjalankan fixture ini
sebelum smoke desktop dan packaging. Fixture adalah contoh semantik buatan, bukan
rekaman DOM produksi dan bukan bukti kompatibilitas live Google Flow.

## Selector yang belum diverifikasi live

Seluruh selector Google belum diverifikasi pada akun Windows 11 saat pekerjaan
ini. Khusus kandidat tambahan yang memerlukan validasi manual: role tab/link
Characters, label `Create character`/`Upload image`, role switch Agent dengan
aria-checked, label Indonesia, serta route plural `/characters/<id>` dan ID opaque.
Selector lama seperti `New character`, `Upload`, `Add from project`, `Asset list`,
`Add media`, `Character name`, `Character personality`, `Select a voice`,
`Add to character`, `Done`, `.ProseMirror`, `Settings trigger`, `Start generation`
juga bisa berubah. Dukungan image/asset bukan dukungan otomatis untuk semua form
native character atau semua kontrol yang kebetulan bernama Create.

## Validasi manual Windows 11 yang masih diperlukan

1. Jalankan branch/installer baru. Login Google hanya secara normal oleh pengguna
   bila diotorisasi terpisah; jangan gunakan akun/kredensial di Electron. Pekerjaan
   pengembangan ini tidak melakukan langkah login tersebut.
2. Pada proyek yang mengalami error, periksa URL dan accessibility tree secara
   read-only. Catat role, accessible name, aria-pressed/checked, disabled/visible
   untuk Characters, navigasi create, kontrol image/asset, composer dan Agent.
   Jangan menyertakan token, cookie, kunci, URL media bertanda tangan atau data akun
   dalam log/screenshot yang dibagikan.
3. Uji fixture offline pada Windows 11 terlebih dahulu. Verifikasi security
   desktop, 20 tool, serta kasus Agent hilang tanpa perlu Google/kredit.
4. Dengan izin terpisah untuk operasi nyata dan setelah memahami biaya, validasi
   satu karakter memakai gambar yang sudah ada; jangan menganggap Upload gratis.
   Validasi portrait deskripsi hanya bila kutipan 0 terbaca dan telah diotorisasi.
   Form yang belum dikenali harus berhenti sebelum generasi, bukan memilih tombol
   lain secara otomatis. Jangan menjalankan paid E2E untuk task ini.
5. Setelah timeout/error, periksa hasil/riwayat dan saldo di Chrome sebelum Retry.
   Uji bahwa tidak ada klik submit kedua; periksa hasil parsial yang sudah ada.
   Uji custom profil, bahasa, sidebar collapsed, dialog terbuka dan koneksi lambat.

Installer build/CI tidak membuktikan keberhasilan live character creation atau
kompatibilitas installer terpasang Windows 11. Catat versi Windows, Flow UI,
Chrome, commit dan hasil selector saat melakukan validasi manual.

## Hasil lokal dan berkas perubahan

Lingkungan: Linux x64, Node 24.19.0, Electron 45.2.1, Xvfb.

| Pemeriksaan | Hasil |
| --- | --- |
| TypeScript build | Lulus |
| `npm test` | 58 lulus, 0 gagal, 0 skip |
| MCP initialize/list/call | Seluruh 20 tool tetap terdaftar dan teruji |
| `npm run test:flow-ui` di Xvfb | Lulus; fixture DOM dengan locator asli, tanpa Google |
| `npm run desktop:smoke` di Xvfb | Lulus; isolasi renderer/API lokal/shutdown tetap berfungsi |
| `npm audit --omit=dev` | 0 kerentanan |
| `npm audit --audit-level=high` | Lulus; 0 high/critical, 15 moderate dev tooling yang sudah ada |
| `git diff --check` | Lulus |

Tidak ada dependency baru; lockfile produksi dan konfigurasi keamanan Electron
sama dengan branch dasar. Pengujian Windows CI ditambahkan pada workflow desktop;
status aktual head PR harus dibaca pada tab Checks. Hasil CI/fixture tidak
membuktikan selector atau layanan Google Flow live.

Berkas implementasi: `src/flow-ui.ts`, `src/flow.ts`, `src/core.ts`, `src/queue.ts`,
`src/index.ts`, `studio/index.html`. Pengujian: `test/flow-ui.test.mjs`,
`test/flow-failure.test.mjs`, `test/queue.test.mjs`,
`test/fixtures/flow-ui/current-project.json`, `mock-page.mjs`, `project.html`,
`electron.cjs`, serta `scripts/flow-ui-fixtures.mjs`. Integrasi/dokumentasi:
`package.json`, `.github/workflows/desktop-windows.yml`, `README.md` dan dokumen ini.
