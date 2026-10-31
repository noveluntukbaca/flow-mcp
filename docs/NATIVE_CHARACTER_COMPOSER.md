# Composer karakter native dari Flow MCP Studio

Basis: branch compatibility `a1030a3`, yang sudah mencakup Electron desktop
`c19fe84`. Implementasi ini menggantikan pembuatan potret terpisah pada CREATE
CHARACTER. Laporan compatibility sebelumnya adalah catatan historis task 04.

## Alur yang didukung

UI visual yang dikonfirmasi pengguna pada Windows 11: Characters berisi **New
character**, **Create my avatar**, dan kartu karakter lama. New character membuka
sample prompt cards, textarea **Describe your character...**, **Upload**, **Add
from project**, model **Nano Banana 2.1**, dan panah submit.

Studio sekarang membuka Characters → New character → composer tersebut. Tidak
memilih avatar atau sample prompt, tidak memanggil runGeneration untuk membuat
potret perantara, dan tidak memerlukan Agent. Dukungan otomatis tetap bersyarat
pada DOM yang dapat diverifikasi (scope composer, tombol, biaya dan hasil), bukan
hanya kemiripan visual.

| Field MCP/Studio | Pemetaan |
| --- | --- |
| NAME / `name` | Nama referensi lokal, tidak diketik sebagai nama/prompt di Google |
| WHAT THEY LOOK LIKE / `describe` | Isi utama textarea native |
| PERSONALITY / `personality` | Ditambahkan setelah baris kosong sebagai `Personality: …` |
| VOICE / `voice` | Metadata lokal saja; tidak memilih atau menghasilkan suara di Flow |
| Gambar / `image` | Hanya jika dipilih eksplisit: Upload path gambar atau Add from project `asset:<title>` |
| `aspect_ratio` | Field lama tetap terdaftar, tetapi ditolak dengan pesan jelas; kontrol native belum terverifikasi |

Text-only tidak mengunggah gambar. Image-assisted dapat menggabungkan deskripsi
atau, bila kosong, memakai prompt singkat yang meminta penggunaan gambar
referensi. Gambar lokal dibatasi ke PNG/JPEG/WebP/GIF regular file hingga 20 MiB.
Tidak ada gambar/sample/avatar yang dipilih otomatis.

## Harga dan persetujuan

`max_credits` default **0**. Harga harus berupa angka kredit bulat eksplisit dalam
composer yang sama: status berlabel Generation cost/Credit cost/Biaya, link
`N credits`, atau label submit yang menyebut `(N credits)`. Saldo akun, kata
“gratis”, isi prompt/sample, kutipan ambigu, biaya rentang/per-detik dan harga
loading bukan bukti harga yang diterima.

- **Kutipan 0**: klik CREATE CHARACTER merupakan permintaan pengguna; satu submit
  dapat dijalankan setelah pemeriksaan ulang.
- **Kutipan positif**: backend mengembalikan `confirmation_required`, quote, model
  dan `confirmation_token`. Studio menampilkan tombol **Konfirmasi biaya dan buat
  karakter** serta Batal. Tidak ada panggilan kedua otomatis.
- **Biaya tidak diketahui/bertentangan**: status `blocked` dan peringatan Indonesia.
  Tidak ada tombol untuk menerima biaya yang tidak diketahui. Tampilkan kutipan
  di Flow, kemudian periksa ulang dari Studio.
- Persetujuan berlaku **120 detik**, sekali pakai, dan terikat ke proyek, nama,
  prompt/personality, voice lokal, gambar (termasuk isi file), model, harga dan
  signature referensi yang tampil. Perubahan input, prompt Chrome, model,
  attachment, harga, atau token kedaluwarsa membatalkan submit.
- `max_credits` yang tinggi saja tidak melewati konfirmasi biaya positif. Harga
  dibaca lagi tepat sebelum klik. Submit disabled/arrow ambigu diblokir.
- Untuk gambar dengan harga awal positif, review dilakukan **sebelum** Upload/Add
  from project. Jika referensi mengubah harga, aplikasi meminta review baru dan
  tidak mengunggah ulang gambar yang sudah terpasang.

Contoh MCP (tanpa menjalankannya pada layanan nyata):

```json
{"name":"Pip","describe":"A small red fox","personality":"Curious","voice":"Charon"}
```

Jika hasil `confirmation_required` menampilkan 20 kredit, asisten MCP harus
meminta persetujuan pengguna atas kutipan tersebut. Setelah disetujui, panggil
**tool yang sama** dengan field kreatif identik ditambah:

```json
{"max_credits":20,"confirmation_token":"<token dari review>"}
```

Token bukan pengganti kewajiban klien/asisten meminta persetujuan manusia. Studio
menegakkannya melalui klik tombol eksplisit; klien MCP lain harus mengikuti
instruksi tool. Tidak ada tool baru; seluruh **20 tool** tetap terdaftar.

## Hasil, identitas lokal, dan duplikasi

Sebelum klik submit, backend menulis catatan ke
`<FLOW_MCP_HOME>/native-characters.json` menggunakan temp file eksklusif, fsync dan
rename. Nama lokal dinormalisasi dan di-scope per proyek. Satu operasi berjalan
pada satu waktu. Catatan `submitted` yang hasilnya belum pasti memblokir submit
berikutnya untuk nama itu, termasuk setelah restart.

Kartu hasil harus baru dibanding baseline, memiliki ID dan tautan karakter yang
konsisten, judul, gambar selesai dimuat, tidak sedang loading/generating, dan tetap
satu-satunya kandidat selama dua scan. Jika Flow membuka editor hasil yang
terkenali, gambar Generated character image harus selesai dimuat sebelum Done
editing/Done digunakan; sesudahnya bukti kartu tetap diperlukan. Sample cards,
kartu lama, thumbnail kosong, progress, hasil ganda atau navigasi ke proyek lain
bukan sukses. Timeout normal hasil maksimal 180 detik.

Setelah berhasil, metadata menyimpan ID/judul native dan nama lokal. `flow_characters`
menampilkan alias lokal dan referensi `asset:<NAME>`. Pemilihan referensi scene dan
edit memetakan alias ke judul native; pemilihan asset lokal memakai kecocokan judul
utuh yang unik, bukan prefix seperti “Result 1” yang dapat salah memilih “Result
10”. Tidak mengganti nama native tanpa kontrol rename yang terverifikasi.

Pengulangan nama yang sudah siap mengembalikan `already_exists`, tanpa biaya atau
perubahan kreatif diam-diam. Hasil tidak pasti mengembalikan peringatan dan tidak
retry. Tidak ada fallback berbayar, submit kedua, atau penghapusan ledger otomatis.
Upload juga diberi catatan sebelum aksi: jika berubah menjadi alur legacy yang
langsung menavigasi/menciptakan hasil, operasi dihentikan dan tidak diulang.

Jika terjadi timeout/crash, periksa Characters dan kredit secara read-only sebelum
memutuskan pemulihan metadata. Jangan menghapus ledger atau mengganti nama lokal
hanya untuk melewati guard dan mengirim ulang. Rekonsiliasi otomatis hasil ambigu,
remote rename/delete, serta pemulihan ledger rusak belum disediakan. Metadata
lokal bukan enkripsi dan perlu backup/ACL akun pengguna yang benar. fsync/rename
mengurangi risiko crash, bukan transaksi lintas UI Google/OS atau jaminan power-loss.

## Pengujian tanpa Google

```powershell
npm ci --include=dev --include=optional
npm test
npm run test:flow-ui
npm run desktop:smoke
npm audit --omit=dev
npm audit --audit-level=high
npm run package:win
```

Suite Node mencakup pemetaan field, parsing quote ketat, fingerprint file,
ledger/restart/korupsi/attachment, serta seluruh regresi keamanan, queue dan 20 MCP
tools. Fixture Playwright asli di Electron sandbox mencakup UI visual yang
dikonfirmasi, teks, Upload/Add from project, review positif, unknown cost,
perubahan input/biaya, expiry, konkurensi, hasil editor/card/progress/ambigu,
restart dan duplikasi. Smoke desktop juga menguji review/Batal/input berubah dan
konfirmasi melalui UI Studio dengan backend palsu.

Semua navigasi fixture memakai `flow-fixture.invalid`, response HTML lokal, dan
user-data-dir sementara; hanya nilai URL untuk validator yang diproyeksikan
sebagai alamat Flow. Tidak login, membuka Google Flow, memakai profile Chrome
pengguna, Gemini atau kredit. Linux fixture/smoke memerlukan display/Xvfb. Workflow
Windows menjalankan fixture, smoke, audit dan build NSIS sebelum upload artefak.

## Batas verifikasi dan validasi manual Windows 11

Visual composer di atas berasal dari verifikasi pengguna. DOM/aksesibilitas,
harga, dan hasil submit **belum diverifikasi live oleh implementasi ini**. Kandidat
berikut harus dicocokkan secara read-only pada sesi Windows 11:

1. Characters dan New character mempunyai role navigation/tab/button/link yang
   terbaca; Create my avatar tidak digunakan. Placeholder harus tepat
   `Describe your character...`.
2. Textarea berada pada scope `form`, `role=form` atau `flow-base-prompt-box`.
   Model button/combobox menampilkan Nano Banana 2.1. Model lain diblokir.
3. Panah memiliki accessible name Generate/Generate character/Create character/
   Submit/Start generation atau atribut `type=submit` dalam scope composer.
   Ikon tanpa identitas yang dapat dibuktikan tidak diklik berdasarkan koordinat.
4. Kutipan adalah biaya generasi di composer, bukan saldo akun. Cocokkan role,
   label, busy/loading, update setelah prompt/reference, dan apakah angka merupakan
   **total satu submit**. Jika biaya total tidak dapat diverifikasi, jangan submit.
5. Upload/Add from project benar-benar menambahkan referensi (bukan alur legacy
   yang langsung menciptakan karakter). Chip harus mempunyai kontrol Remove
   image/Remove reference yang dikenali. Picker Asset list/option/Add media dan
   signature thumbnail perlu diverifikasi. Biaya attachment yang tidak terlihat
   tidak boleh diasumsikan gratis; hentikan jika kontrak native ini tidak sesuai.
6. Konfirmasi hasil membutuhkan `flow-character-tile`, ID melalui data-character-id
   atau link `/character/<id>`/`/characters/<id>`, judul data-character-name/aria-label,
   link cocok, dan thumbnail lengkap. Bila markup hasil berbeda, tidak ada klaim
   sukses otomatis; hasil tetap tercatat sebagai belum pasti.
7. Jalankan fixture offline pada Windows 11 terlebih dahulu. Dengan otorisasi
   terpisah untuk operasi nyata, uji satu nama unik pada kutipan terverifikasi,
   text-only dan referensi eksplisit, serta review/Batal/harga berubah. Task
   pengembangan ini tidak mengotorisasi login atau penggunaan kredit nyata.
8. Verifikasi hasil masuk daftar lokal dan dapat dipakai sebagai `asset:<NAME>`.
   Jangan mengoperasikan Chrome/otomasi lain bersamaan ketika request aktif.
   Setelah timeout, pastikan tidak ada submit ulang, termasuk setelah restart.

Tidak mengotomasi avatar, custom voice, aspect ratio, model lain, rename native,
atau DOM yang belum dikenali. Portrait remote belum diunduh otomatis ke galeri
lokal. Installer build/CI bukan bukti kompatibilitas installer terpasang atau
keberhasilan Google Flow live Windows 11. Code signing masih belum tersedia.

## Hasil pengembangan lokal dan berkas

Lingkungan Linux x64, Node 24.19.0, Electron 45.2.1, Xvfb. Build TypeScript,
65 tes Node (0 gagal/skip), fixture native dengan locator Playwright asli, smoke
Studio, serta smoke executable Linux unpacked lulus. Paket unpacked dibuat dengan
distribusi Electron lokal (`--config.electronDist=node_modules/electron/dist`).
Audit produksi 0 kerentanan; audit lengkap 0 high/critical dengan 15 moderate dari
tooling packaging yang sudah ada. Tidak menambah dependency/lockfile baru.

CI Linux/Windows Node 22/24 dan Windows native fixture/smoke/NSIS tetap digunakan;
status head PR harus dibaca pada Checks. Angka hasil lokal bukan klaim pengujian
Google Flow live atau installer Windows terpasang.

Berkas perubahan:

- `src/native-character.ts`: composer native, input, quote, consent, attachment,
  submit sekali dan verifikasi hasil.
- `src/character-store.ts`: metadata identitas/ledger atomik dan resolver alias.
- `src/flow.ts`: integrasi native, daftar karakter, pemilihan referensi alias utuh.
- `src/core.ts`, `src/index.ts`: skema/kontrak tool dan lifecycle; tetap 20 tools.
- `studio/index.html`: pemetaan input dan UI review/konfirmasi/Batal.
- `scripts/flow-ui-fixtures.mjs`, `test/fixtures/flow-ui/native-project.html`:
  fixture native tanpa Google.
- `test/native-character.test.mjs`: parsing, mapping, fingerprint dan persistence.
- `scripts/desktop-smoke.mjs`, `test/fixtures/desktop-smoke-backend.mjs`: review biaya
  dari UI dengan backend palsu, tanpa submit otomatis.
- `README.md`, `GETTING-STARTED.md`, `docs/FLOW_CHARACTER_COMPATIBILITY.md`, dokumen ini: panduan terbaru
  dan penandaan laporan compatibility lama sebagai historis.
