# Agent Dock

Istilah untuk koneksi dan sesi Agent Dock, serta rancangan orchestration proyek. Istilah orchestration menjelaskan model yang diusulkan; keberadaannya di dokumen ini belum menyatakan fitur sudah diimplementasikan.

## Koneksi dan pekerjaan

**Connector / Koneksi**:
Konfigurasi akses ke alat atau penyedia yang dapat menjalankan pekerjaan. Satu koneksi dapat digunakan oleh beberapa profil agent dan sesi.
_Avoid_: Agent ketika yang dimaksud hanya koneksi ke alat.

**Agent Profile / Profil agent**:
Definisi peran agent yang dapat digunakan berulang, termasuk instruksi, koneksi pilihan, kemampuan yang dibutuhkan, dan batas pekerjaannya. Profil bukan proses yang sedang berjalan.
_Avoid_: Sesi, model ketika yang dimaksud adalah peran agent.

**Project / Proyek**:
Tujuan pekerjaan beserta sumber kerja dan aturan bersama yang berlaku bagi agent yang berpartisipasi.
_Avoid_: Workspace ketika yang dimaksud juga mencakup tujuan dan aturan proyek.

**Workspace**:
Salinan sumber kerja yang digunakan untuk mengerjakan atau meninjau perubahan proyek. Satu proyek dapat mempunyai beberapa workspace yang terisolasi untuk pekerjaan berbeda.
_Avoid_: Proyek ketika yang dimaksud hanya folder kerja.

**Session / Sesi**:
Ruang interaksi dengan satu koneksi yang menyimpan percakapan atau terminal. Sesi dapat melayani beberapa tugas secara berurutan.
_Avoid_: Eksekusi workflow, tugas.

## Workflow dan eksekusi

**Workflow**:
Definisi langkah pekerjaan beserta hubungan ketergantungan dan aturan pemilihan jalurnya.
_Avoid_: Sesi, workflow run ketika yang dimaksud adalah definisi alur.

**Workflow Version / Versi workflow**:
Definisi workflow yang telah dibekukan sehingga eksekusi yang menggunakannya mempunyai acuan yang tetap.
_Avoid_: Draft ketika definisi sudah dipakai sebagai acuan eksekusi.

**Step / Langkah**:
Bagian workflow yang menentukan pekerjaan atau keputusan tertentu. Sebuah langkah dapat berupa tugas agent, otomasi, pemeriksaan, atau keputusan pengguna.
_Avoid_: Agent ketika yang dimaksud adalah simpul workflow.

**Workflow Run / Eksekusi workflow**:
Satu pelaksanaan versi workflow untuk proyek dan masukan tertentu, termasuk seluruh hasil dan keputusan selama pelaksanaannya.
_Avoid_: SessionRun, sesi ketika yang dimaksud adalah keseluruhan pelaksanaan workflow.

**Step Run / Eksekusi langkah**:
Pelaksanaan satu langkah tertentu dalam eksekusi workflow, beserta status dan hasilnya. Langkah keputusan juga mempunyai eksekusi langkah meskipun tidak menjalankan agent.
_Avoid_: Sesi ketika yang dimaksud adalah pelaksanaan simpul workflow.

**Task Run / Eksekusi tugas**:
Eksekusi langkah yang menjalankan pekerjaan melalui agent atau otomasi. Satu eksekusi tugas dapat mempunyai beberapa percobaan.
_Avoid_: Langkah ketika yang dimaksud adalah pelaksanaan tertentu.

**Attempt / Percobaan**:
Satu upaya menjalankan eksekusi tugas. Pengulangan yang diizinkan menghasilkan percobaan baru dengan hasil dan identitas tersendiri.
_Avoid_: Melanjutkan ketika pekerjaan sebenarnya dijalankan ulang.

**Artifact / Artefak**:
Hasil kerja yang mempunyai identitas dan asal yang dapat ditelusuri, misalnya rencana, kontrak API, perubahan kode, atau laporan pengujian.
_Avoid_: Log ketika yang dimaksud adalah hasil kerja yang diserahkan ke langkah lain.

**Context Package / Paket konteks**:
Kumpulan tujuan, instruksi, artefak, dan keputusan yang secara eksplisit disediakan bagi sebuah tugas.
_Avoid_: Shared memory ketika yang dimaksud adalah masukan terpilih untuk satu tugas.

**Approval / Persetujuan**:
Keputusan pengguna terhadap tindakan atau hasil tertentu beserta cakupan yang disetujuinya. Persetujuan atas hasil lama tidak mencakup hasil yang telah berubah.
_Avoid_: Konfirmasi umum ketika keputusan mengizinkan tindakan tertentu.

**Check / Pemeriksaan**:
Evaluasi dengan kriteria dan bukti yang ditetapkan untuk menentukan apakah hasil kerja dapat diteruskan.
_Avoid_: Klaim selesai ketika belum ada bukti yang memenuhi kriteria.
