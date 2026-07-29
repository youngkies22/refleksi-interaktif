# Refleksi Interaktif

Media interaktif kelas — jajak pendapat live (ala Menti), kuis berpoin & bertimer (ala
Kahoot), dan papan kolaboratif (ala Padlet) dalam satu aplikasi. Berdiri sendiri, tidak
berbagi kode/database dengan sistem lain.

## Fitur

### Presentasi & tipe slide

Guru menyusun presentasi lewat editor drag-and-drop, terdiri dari slide bertipe:

| Tipe | Keterangan |
|---|---|
| ☁️ Word Cloud | Peserta kirim 1–3 kata, tampil sebagai awan kata live |
| 📊 Pilihan Ganda | Peserta memilih satu opsi, hasil tampil sebagai bar chart |
| 💬 Jawaban Terbuka | Peserta menulis jawaban bebas, tampil sebagai kartu |
| 📏 Skala | Peserta memilih angka pada skala, tampil sebagai distribusi |
| 🔀 Peringkat | Peserta mengurutkan opsi sesuai selera — tanpa jawaban benar |
| 🏆 Kuis Pilihan Ganda | Berpoin & bertimer, satu opsi ditandai sebagai jawaban benar |
| ✅ Benar / Salah | Berpoin & bertimer, dua tombol tetap: Benar dan Salah |
| ⌨️ Ketik Jawaban | Peserta mengetik jawaban bebas, salah ketik ringan ditoleransi |
| 🧩 Puzzle Urutan | Peserta menyusun opsi ke urutan yang benar |
| 📍 Pin di Gambar | Peserta tap satu titik di gambar, berpoin & bertimer |

### Sesi live

- Kode & QR code join sekali pakai per sesi — peserta gabung tanpa akun/instal apa pun.
- Kontrol presenter real-time (Socket.IO): buka slide, kunci jawaban, lanjut ke slide
  berikutnya, semua peserta ikut berpindah otomatis.
- Leaderboard & podium otomatis untuk slide berpoin (keluarga kuis).
- Rekap & riwayat hasil per sesi/presentasi setelah selesai.

### Papan kolaboratif

- Papan mirip Padlet: peserta menempel kartu (teks/gambar) secara real-time.
- Guru mengatur moderasi & tampilan papan.

### Akun & administrasi

- Login guru, kelola daftar akun guru (panel admin).
- Ganti kredensial & pengaturan aplikasi lewat menu Profil.
- Unggah gambar (untuk slide dan papan) dengan validasi tipe file.
- Backup panas SQLite otomatis berkala + snapshot manual dari panel admin.

## Arsitektur

```
shared/   kontrak TypeScript bersama (tipe slide, event Socket.IO) — dipakai server & Vue
src/      backend: Fastify + Socket.IO + SQLite (better-sqlite3) + Redis
web/      frontend: Vue 3 + TypeScript + Vite + Pinia
data/     (volume) refleksi.db, backup/, unggahan/ — TIDAK ikut ter-commit
```

Redis dipakai sebagai adapter Socket.IO (multi-instance) dan agregasi jawaban real-time;
SQLite sebagai penyimpanan permanen (presentasi, sesi, akun, rekap).

## Cara pasang (Docker, satu perintah)

Butuh Docker & Docker Compose terpasang.

```bash
git clone https://github.com/<username>/refleksi-interaktif.git
cd refleksi-interaktif
docker compose up -d --build
docker compose logs -f app
```

Tunggu sampai log menampilkan kredensial admin (dicetak sekali saat pertama kali database
dibuat) dan baris `Refleksi siap di :8080`. Lalu buka **http://localhost:4001** dan login
guru dengan kredensial dari log tersebut.

> Angka `:8080` di log adalah port DI DALAM container; yang dipetakan ke host adalah
> **4001** (lihat `ports` di `docker-compose.yml`). Ubah lewat `PORT` di `.env` bila perlu.

Tidak perlu file `.env` — semua nilai punya bawaan yang aman. Salin `.env.contoh` ke `.env`
hanya kalau ingin mengubah port, nama aplikasi, atau kredensial admin.

### Data aman saat rebuild

Database SQLite dan unggahan disimpan di **named Docker volume** (`refleksi_data`), bukan
di dalam image. Artinya:

```bash
docker compose down          # aman — volume tidak ikut terhapus
docker compose up -d --build # rebuild image, data tetap ada
```

Untuk benar-benar menghapus semua data (jarang dibutuhkan):
```bash
docker compose down -v
```

Selain volume, aplikasi juga membuat **backup panas** berkala ke `/data/backup` di dalam
volume yang sama (bawaan sekali sehari, simpan 7 salinan terakhir — atur lewat
`BACKUP_TIAP_MENIT` / `BACKUP_SIMPAN_TERAKHIR`). Ini jaring pengaman kedua kalau berkas
database utama korup.

## Cara pasang (pengembangan lokal, tanpa Docker)

Butuh Node.js ≥ 22 dan Redis lokal.

```bash
docker run -p 6379:6379 redis:7-alpine   # atau Redis lokal lain

npm install && cd web && npm install && cd ..
npm run dev              # backend, port 8080
cd web && npm run dev    # frontend, port 5173 (proxy ke 8080)
```

Skrip lain yang tersedia:

```bash
npm run build   # kompilasi TypeScript ke dist/
npm run start   # jalankan hasil build (dist/src/server.js)
npm run cek     # type-check tanpa build (tsc --noEmit)
npm run beban   # skrip uji beban (tools/beban.ts)
```

## Konfigurasi (`.env`)

Semua bersifat opsional — aplikasi jalan dengan nilai bawaan tanpa file `.env` sama sekali.

| Variabel | Bawaan | Keterangan |
|---|---|---|
| `PORT` | `4001` | Port di host (di dalam container selalu `8080`) |
| `APP_NAMA` | `Refleksi` | Nama aplikasi yang ditampilkan |
| `PAKAI_HTTPS` | `false` | Set `true` HANYA jika diakses lewat reverse proxy HTTPS |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `smkbudut` / `smkbudut` | Akun admin awal, dipakai hanya saat database masih kosong |
| `SESSION_SECRET` | (auto) | Kosongkan agar dibuat otomatis & disimpan permanen di volume |
| `BACKUP_TIAP_MENIT` | `1440` | Interval backup snapshot database (menit), `0` = matikan |
| `BACKUP_SIMPAN_TERAKHIR` | `7` | Jumlah salinan backup yang disimpan |
| `LOG_LEVEL` | `info` | Level log Pino |

## Status

**Fase 1 (skeleton)** selesai — Docker naik satu perintah, migrasi & seed admin otomatis,
login guru, backup panas otomatis. Editor presentasi, sesi live, dan papan kolaboratif
menyusul di fase berikutnya sesuai roadmap pengembangan.
