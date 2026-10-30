# Kompatibilitas Windows 10/11

Status per 30 Oktober 2026: **belum tervalidasi pada Windows**. Audit statis menemukan implementasi Windows, dan build/smoke backend lulus di Linux. Tidak ada installer Flow MCP Studio yang dihasilkan oleh repository saat ini. Target awal yang disarankan Windows x64; ARM64 perlu pengujian dan artefak tersendiri. Tentukan versi minimum/build Windows secara eksplisit sebelum rilis, termasuk kebijakan OS yang sudah di luar dukungan reguler vendor.

## Matriks kesiapan

| Area | Dukungan yang ada | Kesenjangan / verifikasi Windows |
| --- | --- | --- |
| Node dan ESM | README Node >=22; ES2022/NodeNext | Tidak ada engines/pin; uji Node 22 dan runtime terpilih. Tipe Node 26 dapat menyembunyikan ketidakcocokan runtime. |
| TypeScript | `npm run build`; native optional package Windows x64/ARM64 ada di lockfile | Instal `--include=dev --include=optional`; uji arsitektur CPU nyata. Build Linux bukan cross-build EXE. |
| Chrome | Pencarian Program Files, Program Files (x86), LOCALAPPDATA dan `FLOW_MCP_CHROME` | Uji instalasi per-user/system, path spasi, missing Chrome, upgrade Chrome dan konflik CDP 9333. Playwright-core tidak membawa Chrome. |
| Profil | Default `~/.flow-mcp/chrome-profile` via `os.homedir()` | Uji lock profil, dua instance, sesi logout, crash dan izin user. Jangan gabung dengan profil Chrome sehari-hari. |
| Studio | Server loopback, browser default melalui `cmd /c start` | Bukan aplikasi native. Uji URL/port, firewall, aplikasi pemilik port lain dan penghentian proses. |
| Launcher | `Flow Studio.cmd`: `cd /d "%~dp0"`, build jika direktori dist tidak ada | Tidak menjalankan npm ci; tidak menghentikan alur secara eksplisit saat build gagal; dist usang/parsial tidak terdeteksi. Node dan npm harus ada di PATH. |
| FFmpeg/ffprobe | `execFile`, argumen terpisah; override executable | Uji codec libx264/AAC, mixing, file spasi/Unicode, file terkunci, output beda drive. Instalasi opsional bagi Flow, wajib untuk assembly/narasi/caption. |
| Suara lokal | `powershell.exe`, System.Speech, WAV, konversi FFmpeg | Cabang Windows belum dieksekusi. Filter hanya suara `en-*`; bukan semua suara Windows/OneCore. Engine masih bernama `mac` di API. |
| Recycle Bin | Microsoft.VisualBasic FileSystem, SendToRecycleBin | Uji file/direktori, nama duplikat, ACL, volume eksternal dan pembatalan. Linux Trash bukan validasi Recycle Bin. |
| ZIP/model | `tar -xf`, fallback unzip; curl untuk model | Pastikan utilitas tersedia pada build OS target; unzip bukan bawaan yang dapat diasumsikan. Model belum memakai hash terpin. |
| whisper/caption | `whisper-cli`, model lokal; rendering Chrome headless | Memerlukan executable/DLL/model/codec/font yang sesuai; belum diuji lengkap di cloud ini. |
| Secret/token | File lokal, POSIX mode 0600 | Harus membuktikan ACL privat Windows; pertimbangkan Credential Manager/DPAPI untuk key. Jangan bundel sesi/key ke installer. |
| Distribusi | Source + dist | Belum ada installer, icon/version metadata, signing, updater, uninstall atau CI Windows. |

## Penyiapan manual yang diusulkan untuk diuji

Jalankan di PowerShell biasa, bukan sebagai administrator, di checkout yang tidak berada pada direktori OneDrive/online-only. Jangan menganggap Node/Chrome sudah terbundel.

```powershell
Set-Location 'C:\Users\anda\flow-mcp'
node --version
npm --version
npm ci --include=dev --include=optional --no-audit --no-fund
npm run build
# Opsional untuk fitur media lokal:
winget install Gyan.FFmpeg
ffmpeg -version
ffprobe -version
# Hanya setelah pengguna mengizinkan akses Flow:
# npm run login
# npm run studio
```

Perintah tersebut merupakan prosedur calon Windows, **belum dijalankan pada Windows**. Di cloud audit, hanya padanan install/build Linux yang teruji. Memasang FFmpeg dapat memerlukan terminal baru agar PATH terbarui. Untuk whisper, pilih rilis resmi whisper.cpp yang cocok dengan CPU, verifikasi integritasnya, dan pastikan DLL pendamping tersedia; audit tidak mengunduh model.

## Lokasi data dan override

| Pengaturan | Default / tujuan |
| --- | --- |
| `FLOW_MCP_HOME` | `os.homedir()/.flow-mcp`: profil Chrome, token, upload, model, cache dan file Gemini key. |
| `FLOW_MCP_OUTPUT` | `os.homedir()/flow-mcp-out`: hasil proyek. |
| `FLOW_MCP_CHROME` | Path lengkap executable Chrome jika autodetection gagal. |
| `FLOW_MCP_PORT`, `FLOW_MCP_CDP_PORT` | HTTP 8787, CDP 9333. Jangan membuka ke LAN. |
| `FLOW_MCP_FFMPEG`, `FLOW_MCP_FFPROBE` | Override executable FFmpeg/ffprobe. |
| `FLOW_MCP_WHISPER`, `FLOW_MCP_WHISPER_MODEL`, `FLOW_MCP_MODEL_BASE` | Executable, model yang sudah tersedia, dan base URL unduhan model. |
| `GEMINI_API_KEY` | Opsional untuk TTS eksternal; tidak dibutuhkan build/smoke offline. Jangan tulis nilainya dalam log/PR. |

Untuk produk terpasang, rencanakan data aplikasi pada `%LOCALAPPDATA%\Flow MCP Studio` dan output pada lokasi pilihan pengguna. Ini rekomendasi migrasi, bukan perilaku kode saat ini. Direktori instalasi bisa read-only; pisahkan runtime immutable dari state, unduhan dan temp. Uji migrasi dari `.flow-mcp` tanpa menyalin key/sesi sembarangan.

Nama proyek sekarang memakai sanitasi ASCII, sehingga nama Indonesia beraksen/Unicode dapat berubah atau bertabrakan. Nama `CON`, `NUL`, `AUX`, `COM1`, `LPT1`, titik akhir, spasi akhir, path panjang, junction dan perbedaan drive harus memiliki test. Temuan `projectDir('..')` dan symlink media dijelaskan di [ARCHITECTURE.md](ARCHITECTURE.md); validasi Windows perlu menambahkan junction/drive case.

## Pengujian penerimaan sebelum menyatakan dukungan

1. CI Windows x64: checkout bersih, instal frozen lockfile, build, test MCP stdio dan HTTP dengan backend palsu tanpa akun Google. Sertakan path checkout dengan spasi dan Unicode.
2. VM/PC Windows 10 dan 11: instal/uninstall sebagai user standar, launch pertama tanpa Node global untuk paket desktop, restart, crash recovery, port terpakai, profil Chrome terkunci dan shutdown anak proses. Catat build OS/CPU/runtime persis.
3. Media sintetis: assembly/mixing, ekstraksi frame, caption dengan transkrip fixture, nama panjang/Unicode, drive C ke D, antivirus/file handle terbuka, disk penuh, izin ditolak dan Recycle Bin dapat dipulihkan.
4. Suara Windows: enumerasi installed voices, apostrof/Unicode dalam teks dan path, narasi WAV ke M4A tanpa jaringan. Bedakan suara SAPI dari suara yang hanya tersedia melalui API lain.
5. Paket distribusi: konten HTML ikut terpasang, executable/dependency native tepat arsitektur, signature valid, upgrade mempertahankan data, uninstall tidak menghapus output pengguna tanpa persetujuan. Audit lisensi FFmpeg/build codec dan notice dependensi.
6. Pengujian Flow nyata hanya pada tahap terpisah yang diizinkan: login manual, sesi/project, perubahan selector, unduhan, dan transaksi kredit dengan persetujuan serta batas anggaran. Tidak termasuk audit ini.

Tidak boleh mengubah hasil Linux menjadi label “Windows supported/verified”. Sampai matriks tersebut lulus, gunakan status “implementasi tersedia, pengujian Windows tertunda”.
