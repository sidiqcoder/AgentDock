# Agent Dock (`@sidiq/agentdock`)

[![npm version](https://img.shields.io/npm/v/@sidiq/agentdock.svg)](https://www.npmjs.com/package/@sidiq/agentdock)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22.12-brightgreen.svg)](https://nodejs.org/)

Dashboard lokal dan orchestrator untuk mengawasi agent CLI, berbicara dengan model melalui 9router atau API kompatibel OpenAI, dan menjalankan workflow n8n. Pengguna tetap memegang kendali penuh, memberi instruksi, dan menyetujui keputusan secara langsung.

---

## Memulai Cepat (Quick Start via npx)

Jalankan langsung tanpa perlu clone repositori:

```sh
npx @sidiq/agentdock
```

Atau pasang secara global di sistem Anda:

```sh
npm install -g @sidiq/agentdock
agentdock
```

Dashboard otomatis terbuka di browser pada **http://127.0.0.1:4310**.

---

## Menjalankan dari Kode Sumber (Development)

Prasyarat: Node.js **22.12+**, npm, dan Windows 10 1809+ / macOS / Linux yang didukung paket PTY.

```sh
# Clone repositori
git clone https://github.com/sidiq/agentdock.git
cd agentdock

# Pasang dependensi
npm install

# Jalankan server pengembangan (Hot Reload Vite + API)
npm run dev
```

Buka **http://127.0.0.1:4310**. Frontend dan backend memakai satu port terpadu.

Untuk mode produksi lokal:

```sh
npm run build
npm start
```

Ubah port dengan variabel lingkungan `PORT`. Ubah direktori penyimpanan menggunakan `AGENT_DOCK_DATA_DIR`. Data default pada clone lokal disimpan di `.data/state.json` (diabaikan oleh Git), dan pada instalasi global npm disimpan di `~/.agent-dock`.

## Alur v1

1. Buka **Koneksi**. Preset Codex, Claude Code, dan Gemini hanya konfigurasi perintah; preset tidak menyatakan CLI telah terpasang.
2. Tambahkan koneksi CLI lain, model API, atau webhook.
3. Buat sesi. Untuk CLI atau Model API dengan **Agent proyek** aktif, isi **Workspace (direktori kerja)** atau tekan **Telusuri** untuk memilih folder proyek dan drive. Folder ini menjadi workspace sesi. Pilihan disimpan per sesi; satu koneksi dapat dipakai untuk beberapa proyek. Sesi baru berstatus **belum berjalan**.
4. Untuk CLI, tekan **Jalankan agent**. Untuk API atau webhook, kirim tugas pertama.
5. Periksa terminal / percakapan dan jawab permintaan masukan dari panel yang sama.
6. Buka **Ringkasan** untuk hasil tugas. Kirim instruksi lanjutan dalam sesi yang sama.

Direktori kerja juga dapat dipilih di panel Terminal sebelum menekan **Jalankan agent** atau **Jalankan ulang**. Folder harus sudah ada dan dapat diakses oleh server lokal. Folder pada proses yang sedang aktif tidak dapat diganti; hentikan proses terlebih dahulu. Riwayat proses menyimpan direktori yang digunakan sebelumnya. Sesi lama yang belum memiliki pilihan folder mengikuti direktori koneksi.

Jika **Telusuri** menampilkan “Endpoint tidak ditemukan” atau fitur belum tersedia pada server, tutup Agent Dock melalui ikon tray lalu jalankan kembali dan muat ulang dashboard. Server yang berjalan di background perlu dimulai ulang setelah pembaruan kode server. Menjalankan aplikasi lagi saat port masih dipakai hanya membuka dashboard dari proses yang sudah berjalan. Selesaikan tugas CLI aktif sebelum restart.

Tombol **Coba demo lokal** menjalankan proses Node.js sungguhan yang meminta masukan dan melaporkan status. Demo tidak memanggil model dan tidak mengeksekusi tugas AI.

## Sessions dan History

Menu **Sessions** menampilkan sesi yang belum berjalan dan sesi yang masih aktif. Satu koneksi agent dapat dipakai oleh beberapa sesi sekaligus: buat sesi lain melalui **Sesi baru** atau tombol **+** di detail sesi. Setiap sesi memiliki proses CLI atau konteks percakapan sendiri; berpindah sesi dan menghentikan satu sesi tidak menghentikan sesi lainnya. Kartu **Koneksi** menampilkan jumlah sesi aktif dan tautan sesi serta riwayat per agent. Runtime yang memakai panel IDE bersama tetap mengikuti batas isolasi dari IDE tersebut.

Menu **History** menampilkan sesi yang selesai, gagal, atau dihentikan setelah prosesnya tidak lagi aktif. Filter berdasarkan agent dan status, cari nama / isi percakapan / ringkasan, atau urutkan berdasarkan waktu pembaruan. Buka sesi untuk membaca terminal, percakapan, ringkasan, dan aktivitas, atau melanjutkannya melalui kontrol yang tersedia. Sesi CLI berstatus selesai dengan proses yang masih hidup tetap berada di **Sessions**.

Ketika CLI dijalankan ulang, output, ringkasan, status, dan waktu proses sebelumnya disimpan pada tab **Riwayat proses**. Output proses saat ini tetap berada di tab **Terminal**. Riwayat tersimpan setelah server dimulai ulang dan tetap ada sampai sesi dihapus; setiap proses menyimpan maksimal 256.000 karakter output. Riwayat yang sudah terhapus sebelum fitur ini tersedia tidak bisa dipulihkan. History hanya mencakup sesi yang dibuat di Agent Dock; percakapan di aplikasi agent lain belum diimpor.

## Tiga jenis runtime

| Runtime       | Pengaturan                                    | Interaksi dan status                                                                    |
| ------------- | --------------------------------------------- | --------------------------------------------------------------------------------------- |
| CLI lokal     | Perintah shell dan direktori proyek           | PTY interaktif, input keyboard, persetujuan bawaan CLI, hook status, kode keluar proses |
| Model API     | Base URL, ID model, key / variabel lingkungan | Percakapan teks, streaming, riwayat konteks, hasil akhir                                |
| n8n / webhook | URL POST, bearer token opsional               | Tugas, callback status, pertanyaan, respons pengguna, hasil workflow                    |

**Batas v1:** CLI harus diluncurkan dari dashboard agar input dan output dapat dikendalikan. Proses terminal yang sudah berjalan di luar aplikasi belum bisa diambil alih. Menutup tab browser tidak menghentikan proses; menghentikan server akan mengakhiri proses yang dikelolanya. Setelah restart, riwayat tersedia dan sesi aktif ditandai dihentikan. Memulai ulang CLI membuat proses baru; gunakan perintah resume milik CLI jika ingin memulihkan konteks agent.

Koneksi model menyediakan **Mode percakapan** dan **Agent proyek**. Mode percakapan tidak memiliki akses file. Agent proyek menyediakan tool filesystem di folder sesi, dengan persetujuan untuk perubahan. Eksekusi shell, instalasi paket, penghapusan file, dan tool jaringan tetap melalui CLI agent atau workflow. Dashboard tidak menahan semua aksi CLI secara otomatis; gunakan mode izin interaktif bawaan CLI agar persetujuan muncul di terminal dashboard.

### Agent proyek melalui 9router / Model API

1. Saat membuat sesi Model API, centang **Agent proyek**, lalu pilih direktori kerja. Sesi lama dapat diubah lewat **Aktifkan Agent proyek** pada detail sesi.
2. Kirim tugas, misalnya membuat folder dokumentasi dan mengisi README. Model harus mendukung function calling / tool calling pada API Chat Completions.
3. Agent dapat mendaftar folder dan membaca file teks di dalam proyek. Untuk membuat folder atau membuat / mengganti isi file, dashboard menampilkan path dan isi baru. Pilih **Setujui perubahan** atau **Tolak perubahan**. Instruksi berikutnya dikirim setelah tugas selesai.
4. Hasil tool dikirim kembali ke model sampai ringkasan akhir tersedia. Aktivitas mencatat hasil eksekusi. Setiap permintaan model pada rangkaian tool dihitung dalam pemakaian.

Path di luar proyek dan symlink ke luar proyek ditolak. File yang berubah selama menunggu persetujuan tidak ditimpa. File teks dibatasi 128 KB, daftar folder 500 entri, satu respons maksimal 8 panggilan tool, dan satu tugas maksimal 12 langkah / lima menit. Hentikan sesi untuk membatalkan persetujuan yang masih menunggu; perubahan yang sudah selesai tetap ada. Persetujuan lama tidak berlaku setelah restart. Sesi lama tetap dalam mode percakapan sampai akses proyek diaktifkan.

Tombol **Uji koneksi** pada kartu Model API mengirim satu pesan `AGENT_DOCK_OK` tanpa tool dan tanpa mengubah percakapan. Uji ini memakai inferensi provider dan masuk hitungan pemakaian. Daftar model yang berhasil dibaca belum membuktikan inferensi atau tool calling pada model tersebut berhasil. Error provider seperti `malformed_function_call`, jawaban terpotong, filter konten, dan respons yang hanya berisi penalaran ditampilkan secara khusus. Penalaran internal tidak ditampilkan sebagai jawaban akhir dan tidak ada percobaan ulang berbayar secara otomatis.

## Menghubungkan 9router dan model lainnya

### Mengimpor instalasi lokal

Buka **Koneksi → Hubungkan instalasi lokal** untuk mendeteksi Codex, OpenCode, Antigravity IDE, dan 9router. Impor dapat diulang tanpa menggandakan koneksi. Koneksi dengan sesi aktif dipertahankan; hentikan sesi itu sebelum mengimpor ulang. Impor tidak menjalankan tugas atau memasang / memperbarui alat.

- **Codex:** executable lokal, login dan konfigurasi yang sudah ada, mode terminal inline. `--no-daemon` membuat sesi dashboard terpisah dari daemon bersama; percakapan Codex yang sedang berjalan di aplikasi lain tidak diambil alih.
- **OpenCode:** executable lokal, provider, plugin, dan konfigurasi dari instalasi pengguna. Tidak mengubah konfigurasi OpenCode.
- **9router:** menemukan endpoint loopback port `20128`, mengambil daftar `/v1/models`, dan menggunakan konfigurasi router dari `~/.config/opencode/opencode.json` bila tersedia. Kredensial provider cloud lain tidak diimpor. Key router mengikuti penyimpanan lokal Agent Dock yang dijelaskan di bagian keamanan.
- **Antigravity IDE:** mendeteksi instalasi IDE lokal. Adapter berjalan di terminal dashboard dan mengirim prompt melalui ekstensi **Agent Dock Bridge** yang memanggil perintah panel native `antigravity.sendPromptToAgentPanel`.

Pada sesi **Model API**, ID model dapat dipilih dari daftar model yang terdeteksi. Pilihan disimpan pada sesi tersebut sehingga beberapa sesi dari satu koneksi 9router bisa memakai model yang berbeda. Daftar model menandakan katalog endpoint; keberhasilan inferensi tetap bergantung pada akun dan provider di router.

### Antigravity IDE: pengiriman tugas dan callback

1. Buat paket ekstensi dengan `npm run bridge:package` (paket sudah dibuat untuk instalasi lokal ini).
2. Di Antigravity IDE, pilih **Extensions → ⋯ → Install from VSIX**, lalu pilih `.data/agent-dock-antigravity-bridge.vsix`. Paket juga dapat diunduh dari kartu koneksi Antigravity di dashboard.
3. Buka folder proyek Agent Dock di IDE dan jalankan **Developer: Reload Window**. Ekstensi aktif otomatis; perintah **Agent Dock: Connect workspace** dapat menghubungkannya ulang.
4. Jalankan `npm run bridge:check` atau tombol **Periksa bridge** pada kartu koneksi. Pemeriksaan harus mengonfirmasi perintah panel native. File pairing `.data/antigravity-bridge.json` dibuat oleh ekstensi dan memuat token lokal yang tidak dikirim ke frontend.
5. Jalankan sesi dari koneksi **Antigravity IDE · lokal** dan kirim tugas. Adapter menyimpan konteks di `.data/ide-handoffs/SESSION/task.md` dan mengirim teksnya ke panel native melalui bridge HTTP loopback. Tugas serta persetujuan tetap dikerjakan oleh IDE.

Paket bridge menggunakan API ekstensi VS Code dan perintah native yang diverifikasi dari instalasi IDE lokal. Perintah native tersebut bukan kontrak API publik yang stabil; perubahan versi Antigravity dapat memerlukan pembaruan bridge. Pemeriksaan akan gagal jika perintahnya tidak tersedia. Jika pemasangan CLI dibatasi akses filesystem, pasang VSIX melalui UI IDE / terminal pengguna biasa.

Agent IDE diminta melapor melalui `scripts/report-ide.mjs`. Helper mengambil kredensial callback dari file lokal `current.json`; token tidak dimasukkan ke prompt atau dicetak ke terminal. Helper menolak task ID yang sudah digantikan. Laporan `waiting` menampilkan pertanyaan di dashboard dan laporan `completed` menampilkan ringkasan.

**Batas integrasi:** adapter menerima konfirmasi dari perintah panel native, bukan dari kode keluar launcher. Tanpa bridge aktif, pengiriman ditolak dengan petunjuk pemasangan; tidak ada fallback ke CLI `chat` yang mengklaim berhasil tanpa konfirmasi. Agent IDE masih perlu menjalankan hook agar status dan ringkasan kembali otomatis. V1 belum berlangganan seluruh event internal chat Antigravity dan tidak membaca percakapan IDE yang sudah ada. Jika hasil belum dilaporkan, periksa chat / login / persetujuan IDE atau gunakan status manual setelah memeriksa tugas. Keberlanjutan percakapan mengikuti panel agent di jendela tempat bridge aktif.

Ketik `/exit` di sesi adapter untuk memutus koneksi tanpa menutup aplikasi IDE. Menghentikan adapter tidak membatalkan task yang sudah berjalan di IDE. Token callback tidak berlaku setelah proses adapter dihentikan. Jangan mengubah atau memperbarui versi paket PTY tanpa menjalankan tes lifecycle Windows; pembersihan resource build PTY yang dipakai diisolasi di `server/pty-cleanup.ts`.

### Konfigurasi koneksi manual

Tambahkan koneksi **Model API**:

```text
Nama:       9router lokal
Base URL:   http://localhost:20128/v1
ID model:   salin ID persis dari router yang kamu gunakan
API key:    key router, jika diwajibkan
```

Base URL dapat diganti untuk Ollama dengan endpoint kompatibel OpenAI atau penyedia lain. Aplikasi memanggil `POST {baseUrl}/chat/completions` dengan `messages`, `model`, dan `stream: true`. Balasan SSE dan fallback JSON didukung. Autentikasi menggunakan `Authorization: Bearer …`. Mode Agent proyek menambahkan definisi tool dan meneruskan hasilnya sebagai pesan tool. Mode percakapan menolak tool dengan petunjuk mengaktifkan akses proyek.

Riwayat percakapan dikirim pada setiap giliran. Untuk tugas yang panjang, buat sesi baru saat konteks model sudah penuh. Tidak ada pemotongan konteks tersembunyi. Permintaan HTTP dibatasi lima menit; workflow yang lama sebaiknya segera membalas `202` dan mengirim hasil melalui callback.

## Usage & Quota

Menu **Usage & Quota** menampilkan pemakaian per koneksi, sisa limit yang dapat dibaca, dan waktu reset. Gunakan **Perbarui** untuk pemeriksaan manual, atau biarkan pembaruan otomatis setiap 60 detik selama halaman terbuka. Pemeriksaan tidak mengirim prompt, menyisipkan perintah ke terminal aktif, atau menjalankan inferensi berbayar.

- **Codex lokal:** membaca `account/rateLimits/read` melalui app-server terpisah, dengan login lokal yang sudah ada. Jika didukung versi CLI, `account/usage/read` juga menyediakan total token aktivitas akun. Jika API tidak dapat dihubungi, catatan `token_count` terbaru di direktori sesi Codex menjadi fallback; sumber dan waktu pengamatan tetap ditampilkan. Persentase dan durasi mengikuti jendela yang benar-benar dilaporkan, termasuk ketika hanya satu jendela tersedia. Kuota paket ChatGPT tidak tersedia untuk login API key.
- **Model API / 9router:** pemakaian token di Agent Dock dicatat dari payload `usage` pada balasan JSON atau streaming. Permintaan streaming menyertakan `stream_options.include_usage`. Sisa limit diambil dari header `x-ratelimit-*` bila disediakan provider. Limit ini mengikuti model pada respons terakhir, bukan seluruh saldo akun. API kompatibel OpenAI tidak menyediakan endpoint saldo universal.
- **Statistik 9router lokal:** membaca agregat harian `usageDaily` dari database router dalam mode hanya-baca. Lokasi default Windows adalah `%APPDATA%/9router/db/data.sqlite`; Linux/macOS dicari di `~/.9router/db` dan `~/.config/9router/db`. Data ini meliputi seluruh aplikasi yang memakai router dan ditampilkan terpisah agar tidak dihitung dua kali. Database tidak dibuat atau diubah dan kredensial provider tidak dibaca. Untuk kuota masing-masing akun provider, gunakan **Buka Usage 9router** dan login ke dashboard router. Router jarak jauh atau lokasi penyimpanan khusus diperiksa melalui dashboard asal.
- **Antigravity IDE, OpenCode, Claude Code, Gemini CLI, CLI lain, dan webhook:** kartu tetap tersedia, dengan penjelasan bila kuota belum dapat dibaca otomatis. Bridge Antigravity saat ini tidak menyediakan kuota akun IDE. Akun IDE dan akun provider router tidak diasumsikan sama. Pemeriksaan native seperti `/usage` di Claude Code atau `/stats` di Gemini CLI tetap dilakukan pengguna di aplikasi asal.

**Cakupan pemakaian:** jumlah permintaan HTTP dan token Agent Dock dicatat sejak fitur ini aktif, tersimpan di `.data/state.json`, dan tetap ada ketika sesi dihapus. Permintaan gagal tetap masuk hitungan percobaan; jumlah permintaan yang memiliki data token ditampilkan terpisah. Riwayat sebelum fitur aktif, input CLI, dan token yang tidak dilaporkan provider tidak diperkirakan. Token cache sudah termasuk token masuk sehingga tidak ditambahkan lagi ke total. Tanda **—** berarti belum tersedia, bukan nol atau tanpa batas.

**Kesegaran data:** cache pemeriksaan akun berlaku 60 detik; pembaruan manual dibatasi minimum 10 detik untuk menghindari pemeriksaan bertumpuk. Data lebih dari lima menit atau melewati waktu reset diberi label **Data lama**. Aplikasi tidak mengasumsikan kuota pulih setelah reset tanpa pengamatan baru. Waktu reset ditampilkan dalam zona waktu browser.

API `GET /api/usage` memakai autentikasi cookie dashboard yang sama. `?refresh=1` meminta pembaruan manual. Pembacaan kuota memakai akun Codex lokal yang ditemukan di server, sehingga koneksi dengan wrapper CLI atau akun khusus mungkin perlu diperiksa langsung di CLI.

Referensi: [Codex App Server: pembacaan akun dan rate limit](https://developers.openai.com/codex/app-server), [header rate limit OpenAI](https://developers.openai.com/api/docs/guides/rate-limits), dan [payload usage Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).

## Status dan ringkasan CLI

CLI generik tidak menyediakan protokol universal untuk “menunggu masukan” atau “giliran selesai”. Karena itu Agent Dock tidak menebak status dari teks terminal. Status berubah berdasarkan:

- Proses diluncurkan → `running`.
- Proses keluar 0 → `completed`; kode lain → `failed`.
- Hook agent → `running`, `waiting`, `completed`, atau `failed`.
- Kontrol **Status CLI** → perubahan manual, tercatat di aktivitas.
- Pengguna menghentikan proses → `stopped`.

Hook `completed` dapat menandai tugas selesai saat proses CLI masih hidup untuk tugas berikutnya. Hook menyediakan ringkasan agent. Tanpa hook, ketika proses berakhir aplikasi hanya menampilkan **cuplikan output terakhir**, bukan ringkasan buatan AI.

Setiap proses CLI menerima variabel berikut:

```text
AGENT_DOCK_SESSION
AGENT_DOCK_HOOK_URL
AGENT_DOCK_HOOK_TOKEN
```

Hubungkan hook dari CLI / wrapper yang kamu gunakan ke skrip ini (gunakan path absolut jika direktori kerja berbeda):

```sh
node scripts/report-event.mjs waiting "Boleh menjalankan migrasi?"
node scripts/report-event.mjs running
node scripts/report-event.mjs completed "Refactor selesai. Validasi lulus."
node scripts/report-event.mjs failed "Pengujian gagal."
```

Ketersediaan lifecycle hook bergantung pada CLI yang dipakai. Skrip tersebut adalah kontrak integrasi Agent Dock; v1 belum memasang hook native tiap CLI secara otomatis.

## Menghubungkan n8n

Template siap impor tersedia di [`public/workflows/agent-dock-n8n.json`](public/workflows/agent-dock-n8n.json). Template ini menguji webhook, balasan `202`, callback terautentikasi, serta pertanyaan dan balasan sesi. Template belum menjalankan agent AI atau pekerjaan bisnis; tambahkan langkah otomasi sebelum node callback untuk pekerjaan nyata.

Untuk n8n yang terpasang lokal, jalankan `npm run n8n:start`. Launcher memakai penyimpanan proyek `.data/n8n/.n8n`, mengikat port **5678** ke loopback, dan dapat menemukan instalasi global melalui PATH. `N8N_CLI_PATH` dapat menunjuk skrip `n8n/bin/n8n` untuk instalasi lain. Penyimpanan proyek terpisah dari `~/.n8n`; perubahan di kedua lokasi tidak disinkronkan. Jika belum ada database proyek, n8n membuka pengaturan akun baru. Untuk memindahkan instalasi lama, database, konfigurasi enkripsi, file biner, dan custom nodes perlu dicadangkan sesuai kebutuhan workflow.

Impor template, pasang credential **Header Auth** pada node Webhook dengan nama header `Authorization` dan nilai `Bearer TOKEN`, lalu aktifkan workflow. Di Agent Dock, buat koneksi **n8n / Webhook** dengan URL `http://127.0.0.1:5678/webhook/agent-dock` dan isi token yang sama pada kolom API key (tanpa awalan `Bearer`). Buat sesi dan kirim pesan untuk menguji hasil akhir, atau `/tanya` untuk menguji **Butuh masukan**, kemudian balas di sesi yang sama. Callback template dibatasi ke `127.0.0.1:4310`; sesuaikan ekspresi URL bila port Agent Dock diubah. Template tidak menyimpan payload eksekusi agar token callback tidak masuk riwayat n8n.

1. Buat node **Webhook** dengan metode **POST**. Gunakan URL production untuk workflow yang sudah diaktifkan atau URL test ketika n8n sedang mendengarkan.
2. Pilih balasan dari **Respond to Webhook** untuk mengembalikan status atau hasil terstruktur. Untuk proses panjang, balas `202` terlebih dahulu lalu kirim callback.
3. Masukkan URL itu sebagai koneksi **n8n / Webhook** di Agent Dock. Opsi token menggunakan bearer header; konfigurasi Header Auth di n8n agar cocok.

Payload tugas dari dashboard:

```json
{
  "sessionId": "uuid",
  "runId": "uuid",
  "message": "Buat laporan penjualan",
  "messages": [{ "role": "user", "content": "Buat laporan penjualan" }],
  "callbackUrl": "http://127.0.0.1:4310/api/hooks/SESSION/RUN",
  "callbackToken": "token-acak-khusus-run"
}
```

Workflow boleh membalas langsung:

```json
{ "status": "waiting", "question": "Laporan untuk bulan apa?" }
```

atau:

```json
{ "status": "completed", "message": "Laporan siap.", "summary": "Ringkasan laporan…" }
```

Respons `202` atau JSON bawaan “Workflow was started” berarti tugas diterima dan dashboard menunggu callback. Untuk melapor kemudian, tambahkan node **HTTP Request**, metode **POST**, URL `{{ $json.body.callbackUrl }}`, header `Authorization: Bearer {{ $json.body.callbackToken }}`, dan body salah satu payload status di atas. Pastikan data callback dari node Webhook diteruskan atau dirujuk dari node asal.

Ketika pengguna membalas pertanyaan, Agent Dock melakukan POST lagi ke webhook awal dengan `sessionId` dan `runId` yang sama serta `message` baru. **Workflow perlu melakukan routing balasan berdasarkan `sessionId` / `runId`**; balasan ini tidak otomatis melanjutkan node Wait n8n. Setelah tugas selesai, perintah berikutnya mendapat `runId` baru.

Callback harus dapat menjangkau server lokal. V1 mengikat server ke loopback; jalankan n8n pada mesin yang sama untuk callback langsung. n8n cloud / Docker tidak otomatis dapat mengakses `127.0.0.1` milik host. Mode jaringan, URL callback yang dapat dikonfigurasi, dan autentikasi untuk akses jarak jauh belum disediakan.

Tombol **Hentikan pemantauan** membatalkan permintaan lokal dan mencabut token callback. Workflow yang berjalan di n8n mungkin tetap berjalan; hentikan eksekusinya dari n8n bila diperlukan. Callback lama ditolak setelah sesi dihentikan atau run berakhir.

## Data dan keamanan lokal

- Backend hanya mendengarkan `127.0.0.1` dan memvalidasi Host / Origin.
- REST yang mengelola koneksi dan proses serta WebSocket memerlukan cookie browser `HttpOnly`, `SameSite=Strict`.
- Callback memakai token acak per run, bukan cookie atau key provider.
- API key disimpan dalam file lokal `.data/state.json`, **tanpa enkripsi**. Key tidak dikirim kembali ke frontend. Gunakan nama variabel lingkungan sebagai alternatif; variabel harus tersedia saat server dijalankan. Key langsung lebih diprioritaskan daripada variabel lingkungan jika keduanya diisi.
- Output terminal, hasil model, dan pesan tersimpan lokal dan dapat berisi informasi sensitif. Batasi akses ke direktori `.data`. Buffer terminal dibatasi 256.000 karakter per sesi, aktivitas 200 entri per sesi. Riwayat percakapan disimpan sampai sesi dihapus.
- Koneksi HTTPS / HTTP hanya dihubungi saat tugas dikirim. Tidak ada task otomatis atau CLI yang diluncurkan hanya karena preset tersedia.
- Satu pengguna lokal adalah cakupan v1. Jangan mempublikasikan server ini melalui proxy / tunnel tanpa lapisan autentikasi tambahan.

## Arsitektur

```text
React dashboard ── REST + WebSocket ── Node.js server (localhost)
                                          ├── PTY → agent CLI lokal
                                          ├── HTTP / SSE → 9router / model API
                                          ├── POST + callback → n8n / webhook
                                          └── atomic JSON store → .data/
```

`server/manager.ts` mengelola lifecycle dan runtime, `server/protocol.ts` mengurai SSE dan memvalidasi kontrak, `server/store.ts` menyimpan state melalui antrean penulisan atomik. `shared/types.ts` menyatukan tipe status untuk server dan UI. Penambahan runtime lain dapat mengikuti kontrak lifecycle yang sama.

## Validasi

```sh
npm test
npm run build
```

Pengujian menggunakan HTTP mock lokal dan proses PTY lokal; tidak menghubungi model berbayar. Mencakup streaming terfragmentasi, stream terputus, token hook, tindak lanjut percakapan, n8n meminta masukan, pembatalan, persistensi, dan lifecycle proses.

## Referensi integrasi

- [9router: integrasi tool kompatibel OpenAI](https://github.com/decolua/9router/blob/master/gitbook/content/en/integration/other-tools.md)
- [OpenAI Docs: Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
- [n8n: Webhook node](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/)
- [node-pty](https://github.com/microsoft/node-pty) dan [xterm.js](https://xtermjs.org/docs/)

## Lisensi

Proyek ini dilisensikan di bawah lisensi [MIT](LICENSE). Bebas digunakan, dimodifikasi, dan didistribusikan untuk keperluan pribadi maupun komersial.
