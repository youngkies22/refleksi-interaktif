import type { Socket } from 'socket.io';
import { guruIdDariSocket } from '../auth/socketAuth.js';
import { galatTidakDiizinkan, keGalatKirim } from '../galat.js';
import * as layanan from '../layanan/papan.js';
import { normalisasiKode } from '../util/kode.js';
import type { ClientKeServer, DataSocket, ServerKeClient } from '../../shared/kontrak.js';
import type { IoServer } from './index.js';

type SocketRefleksi = Socket<ClientKeServer, ServerKeClient, Record<string, never>, DataSocket>;

const kamarPapan = (papanId: number) => `papan:${papanId}`;
const kamarPapanGuru = (papanId: number) => `papan:${papanId}:guru`;

/** Sama seperti helper identik di `presenter.ts` — verifikasi ulang di
 *  AWAL setiap handler `papan:guru_masuk`, bukan hanya sekali saat
 *  `connection`, supaya tidak ada jendela ras dengan lookup cookie. */
async function guruIdWajibSocket(socket: SocketRefleksi): Promise<number> {
  if (socket.data.guruId !== undefined) return socket.data.guruId;
  const id = await guruIdDariSocket(socket);
  if (!id) throw galatTidakDiizinkan('Sesi login tidak valid. Silakan masuk kembali.');
  socket.data.guruId = id;
  return id;
}

/** Hitungan online = jumlah socket yang sedang join room papan ini —
 *  akurat lintas-instance lewat Redis adapter, otomatis berkurang saat
 *  socket disconnect, tanpa perlu TTL/ping seperti kehadiran sesi kuis. */
async function ringkasanPeserta(
  io: IoServer,
  papanId: number,
): Promise<{ online: number; daftar: { nama: string }[] }> {
  const sockets = await io.in(kamarPapan(papanId)).fetchSockets();
  return {
    online: sockets.length,
    daftar: sockets.map((s) => ({ nama: s.data.papanNama || 'Anonim' })),
  };
}

/**
 * Event papan kolaboratif. Beda dari sesi live: tidak ada "slide aktif" atau
 * broadcaster ter-coalesce — volume kartu jauh lebih rendah daripada burst
 * jawaban kuis, jadi siaran langsung per aksi sudah cukup murah.
 */
export function daftarkanPapan(io: IoServer, socket: SocketRefleksi): void {
  socket.on('papan:masuk', async (d, ack) => {
    try {
      const kode = normalisasiKode(d.kode ?? '');
      const hasil = await layanan.masukPapan(kode, d.token);

      socket.data.token = hasil.token;
      socket.data.papanId = hasil.papan.id;
      if (d.nama) socket.data.papanNama = d.nama;

      await socket.join(kamarPapan(hasil.papan.id));

      ack({
        ok: true,
        data: { token: hasil.token, papan: hasil.papan, kolom: hasil.kolom, kartu: hasil.kartu },
      });

      io.to(kamarPapanGuru(hasil.papan.id)).emit(
        'papan:peserta_jumlah',
        await ringkasanPeserta(io, hasil.papan.id),
      );
    } catch (e) {
      ack({ ok: false, galat: keGalatKirim(e) });
    }
  });

  // Guru membuka layar lobby (`AturPapan.vue`) — join room khusus guru
  // untuk menerima siaran `papan:peserta_jumlah` tiap kali peserta join/keluar.
  socket.on('papan:guru_masuk', async (d, ack) => {
    try {
      const guruId = await guruIdWajibSocket(socket);
      layanan.papanMilikGuru(d.papanId, guruId); // melempar 404 kalau bukan pemilik

      await socket.join(kamarPapanGuru(d.papanId));
      ack({ ok: true, data: await ringkasanPeserta(io, d.papanId) });
    } catch (e) {
      ack({ ok: false, galat: keGalatKirim(e) });
    }
  });

  // Peserta papan terputus (tutup tab/hilang koneksi) — Socket.IO sudah
  // meninggalkan `kamarPapan` sebelum event ini, jadi hitungan di bawah
  // sudah otomatis berkurang.
  socket.on('disconnect', () => {
    const { papanId } = socket.data;
    if (!papanId) return;
    void (async () => {
      io.to(kamarPapanGuru(papanId)).emit('papan:peserta_jumlah', await ringkasanPeserta(io, papanId));
    })();
  });

  socket.on('papan:kartu_baru', async (d, ack) => {
    try {
      const { papanId, token } = socket.data;
      if (!papanId || !token) throw galatTidakDiizinkan('Belum bergabung ke papan ini.');

      const kartu = layanan.tambahKartu(papanId, token, socket.data.papanNama ?? null, d);
      ack({ ok: true, data: { kartu } });

      // Kartu yang masih menunggu persetujuan TIDAK disiarkan ke papan umum —
      // hanya penulisnya sendiri yang melihatnya (lewat ack di atas). Guru
      // memantau jumlah antrean lewat `papan:menunggu` dan menyetujui via REST.
      if (kartu.disetujui) {
        io.to(kamarPapan(papanId)).emit('papan:kartu', { kartu });
      } else {
        io.to(kamarPapan(papanId)).emit('papan:menunggu', { jumlah: await layanan.jumlahMenunggu(papanId) });
      }
    } catch (e) {
      ack({ ok: false, galat: keGalatKirim(e) });
    }
  });

  socket.on('papan:kartu_ubah', (d, ack) => {
    try {
      const { papanId, token } = socket.data;
      if (!papanId || !token) throw galatTidakDiizinkan('Belum bergabung ke papan ini.');

      const kartu = layanan.ubahKartu(d.kartuId, token, d);
      io.to(kamarPapan(papanId)).emit('papan:kartu_update', { kartu });
      ack({ ok: true, data: null });
    } catch (e) {
      ack({ ok: false, galat: keGalatKirim(e) });
    }
  });

  // Sengaja TERBUKA untuk siapa pun yang sudah join — drag kartu antar kolom
  // adalah soal mengorganisir papan bersama, bukan mengedit isi milik orang lain.
  socket.on('papan:kartu_pindah', (d, ack) => {
    try {
      const { papanId } = socket.data;
      if (!papanId) throw galatTidakDiizinkan('Belum bergabung ke papan ini.');

      const kartu = layanan.pindahKartu(d.kartuId, d.kolomId, d.urutan);
      io.to(kamarPapan(papanId)).emit('papan:kartu_update', { kartu });
      ack({ ok: true, data: null });
    } catch (e) {
      ack({ ok: false, galat: keGalatKirim(e) });
    }
  });

  socket.on('papan:kartu_hapus', async (d, ack) => {
    try {
      const { papanId, token, guruId } = socket.data;
      if (!papanId || !token) throw galatTidakDiizinkan('Belum bergabung ke papan ini.');

      await layanan.hapusKartu(d.kartuId, token, guruId);
      io.to(kamarPapan(papanId)).emit('papan:kartu_hapus', { kartuId: d.kartuId });
      ack({ ok: true, data: null });
    } catch (e) {
      ack({ ok: false, galat: keGalatKirim(e) });
    }
  });

  socket.on('papan:like', async (d, ack) => {
    try {
      const { papanId, token } = socket.data;
      if (!papanId || !token) throw galatTidakDiizinkan('Belum bergabung ke papan ini.');

      const hasil = await layanan.toggleLike(d.kartuId, token);
      io.to(kamarPapan(papanId)).emit('papan:like', { kartuId: d.kartuId, jumlah: hasil.jumlah });
      ack({ ok: true, data: hasil });
    } catch (e) {
      ack({ ok: false, galat: keGalatKirim(e) });
    }
  });

  socket.on('papan:komentar', (d, ack) => {
    try {
      const { papanId, token } = socket.data;
      if (!papanId || !token) throw galatTidakDiizinkan('Belum bergabung ke papan ini.');

      const komentar = layanan.tambahKomentar(d.kartuId, token, socket.data.papanNama ?? '', d.isi);
      io.to(kamarPapan(papanId)).emit('papan:komentar', { kartuId: d.kartuId, komentar });
      ack({ ok: true, data: null });
    } catch (e) {
      ack({ ok: false, galat: keGalatKirim(e) });
    }
  });
}
