# Perbaikan keamanan dan pengujian offline

Basis: `main` pada `84b548f3aa72b749b82cdbfbb6f91cadebae8642`.
Audit dibaca dari `docs/flow-mcp-studio-windows-audit`: ARCHITECTURE.md,
WINDOWS_COMPATIBILITY.md, DEVELOPMENT_ROADMAP.md. Dokumen branch audit belum
ada di main dan tidak digabungkan ke branch perbaikan ini.

## Perubahan

- Validasi nama proyek pada skema MCP/HTTP dan pemanggilan langsung projectDir.
  Tolak `.`/`..`, path traversal, separator, drive/UNC, kontrol, trailing dot/space
  dan nama perangkat Windows; pertahankan sanitasi lama untuk nama biasa.
- Helper path bersama menggunakan relative/isAbsolute, lstat setiap komponen
  dan realpath untuk containment. Link yang sudah ada, dangling symlink dan
  junction ditolak; root berupa link juga ditolak. Tujuan yang belum ada boleh
  digunakan selama tetap berada di bawah root.
- Lindungi media HTTP pada output, uploads dan cache captions; hanya regular file
  yang disajikan. Upload memakai exclusive create. Listing output mengabaikan
  link; discard dan tujuan caption, assembly, voice, frame serta download
  menggunakan guard yang sama. Input media eksternal yang sengaja dipilih oleh
  pengguna tetap bagian kontrak fitur assembly/transkripsi, bukan sandbox file
  universal bagi seluruh Core.
- npm test memakai runner bawaan Node, build baru dan fixture backend palsu.
  Tidak ada dependensi test baru atau Electron. Workflow baru berdiri sendiri;
  konfigurasi launcher dan skrip E2E asli dipertahankan.

## Pembaruan dependency

`npm audit fix --ignore-scripts` tanpa `--force`, seluruhnya dalam rentang
manifest yang ada. Delapan paket berubah pada lockfile:

| Paket | Sebelum | Sesudah |
| --- | --- | --- |
| @modelcontextprotocol/sdk | 1.30.0 | 1.32.2 |
| zod | 4.6.5 | 4.6.7 |
| @hono/node-server | 2.1.1 | 2.1.5 |
| body-parser | 2.3.0 | 2.4.0 |
| fast-uri | 3.1.8 | 3.1.9 |
| hono | 4.13.8 | 4.13.14 |
| ip-address | 10.7.2 | 10.7.5 |
| qs | 6.16.0 | 6.17.1 |

Audit awal: 3 high dan 5 moderate. Audit setelah pembaruan: 0 kerentanan.
Advisori dapat berubah; CI tetap menjalankan npm audit terhadap registry saat itu.

## Cakupan dan batas verifikasi

Linux, Node 24.19.0, npm 11.9.0. Instalasi bersih npm ci, npm run build,
npm test (28 lulus, 0 skip) dan npm audit (0 kerentanan) lulus.
Suite offline memeriksa nama/path,
symlink/dangling link/tujuan overwrite, discard dan captions tanpa menjalankan
operasi eksternal, HTTP Host/token/schema/upload/media/Range, serta initialize,
list dan panggilan seluruh 20 tools MCP melalui RemoteCore ke backend palsu.
Queue diuji serial, cancel, retry dan tidak mengulang timeout ambigu. FFmpeg lokal
menguji assembly dua klip sintetis dengan audio dan ekstraksi frame.

CI baru: ubuntu-latest/windows-latest × Node 22/24. Junction directory diuji di
Windows tanpa hak symlink file; file symlink dilaporkan skip jika EPERM. Media
sintetis skip jika FFmpeg/ffprobe tidak tersedia. Hasil CI harus dibaca sebelum
merge; windows-latest bukan bukti pengujian PC Windows 10 dan 11.

Risiko tersisa:

- Validasi path dan operasi filesystem/subprocess bukan transaksi atomik lintas
  platform. Proses lokal dengan izin tulis yang sama dapat mengganti direktori
  setelah pemeriksaan (TOCTOU); hardlink juga bukan symlink. Gunakan root privat
  pengguna, jangan direktori yang dapat ditulis pihak tidak tepercaya. Penutupan
  penuh serangan race memerlukan operasi berbasis handle OS dan review tersendiri.
- Nama Unicode masih disanitasi seperti sebelumnya dan dapat bertabrakan;
  kebijakan overwrite file biasa tidak diubah. Link yang sebelumnya digunakan
  sebagai root/proyek tidak lagi didukung.
- Tidak mengakses Google Flow, login, Gemini, unduhan model atau kredit video.
  Tes fake membuktikan kontrak protokol, bukan selector atau generasi nyata.
- Native speech/Recycle Bin/ACL, Chrome dan rendering caption/whisper penuh,
  installer, crash recovery dan perpindahan volume masih memerlukan validasi.
