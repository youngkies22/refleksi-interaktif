import type { Socket } from 'socket.io';
import { guruIdDariSocket } from '../auth/socketAuth.js';
import { galatTidakDiizinkan, keGalatKirim } from '../galat.js';
import {
  kondisiSesi,
  kunciSlide,
  leaderboardSesi,
  pindahSlide,
  resetSlideJawaban,
  selesaikanSesi,
  sembunyikanJawaban,
  sesiUntukGuru,
} from '../layanan/sesi.js';
import { log } from '../log.js';
import { slideBerpoin } from '../../shared/tipe.js';
import type { ClientKeServer, DataSocket, ServerKeClient } from '../../shared/kontrak.js';
import type { IoServer } from './index.js';
import { siarkanHasilKuis, siarkanSekarang } from './siaran.js';

type SocketRefleksi = Socket<ClientKeServer, ServerKeClient, Record<string, never>, DataSocket>;

/**
 * Ambil guruId dari socket, dengan cache di `socket.data.guruId`.
 *
 * Dipanggil di AWAL setiap handler `presenter:*` (bukan hanya sekali saat
 * `connection`) supaya tidak ada jendela ras antara socket tersambung dan
 * lookup cookie selesai — setiap event presenter memverifikasi ulang secara
 * eksplisit alih-alih mempercayai state yang mungkin belum terisi.
 */
async function guruIdWajibSocket(socket: SocketRefleksi): Promise<number> {
  if (socket.data.guruId !== undefined) return socket.data.guruId;
  const id = await guruIdDariSocket(socket);
  if (!id) throw galatTidakDiizinkan('Sesi login tidak valid. Silakan masuk kembali.');
  socket.data.guruId = id;
  return id;
}

const kamarPeserta = (sesiId: number) => `sesi:${sesiId}`;
const kamarPresenter = (sesiId: number) => `sesi:${sesiId}:presenter`;

export function daftarkanPresenter(io: IoServer, socket: SocketRefleksi): void {
  socket.on('presenter:buka', async (d, ack) => {
    try {
      const guruId = await guruIdWajibSocket(socket);
      sesiUntukGuru(d.sesiId, guruId); // melempar 404 kalau bukan pemilik

      socket.data.sesiId = d.sesiId;
      await socket.join(kamarPresenter(d.sesiId));

      const kondisi = await kondisiSesi(d.sesiId);
      ack({ ok: true, data: { kondisi } });

      if (kondisi.slide) void siarkanSekarang(io, d.sesiId, kondisi.slide.id);
    } catch (e) {
      ack({ ok: false, galat: keGalatKirim(e) });
    }
  });

  socket.on('presenter:slide', async (d, ack) => {
    try {
      const guruId = await guruIdWajibSocket(socket);
      const sesiId = socket.data.sesiId;
      if (!sesiId) throw galatTidakDiizinkan('Belum membuka sesi ini.');

      const { dibuka } = await pindahSlide(sesiId, guruId, d.slideId);

      // Dikirim TANPA token: slide yang baru saja aktif belum pernah dijawab
      // siapa pun, jadi `sudahJawab:false` benar untuk semua peserta sekaligus.
      // Peserta yang rejoin di tengah slide mendapat nilai per-dirinya sendiri
      // lewat `peserta:join`, bukan lewat siaran ini.
      const kondisi = await kondisiSesi(sesiId);
      io.to(kamarPeserta(sesiId)).emit('sesi:kondisi', kondisi);
      io.to(kamarPresenter(sesiId)).emit('sesi:kondisi', kondisi);
      void siarkanSekarang(io, sesiId, d.slideId);

      // Kembali ke slide berpoin yang sudah pernah dijawab (mis. guru menekan
      // "Sebelumnya" untuk membahas ulang): kunci jawaban langsung ditayangkan
      // lagi, bukan menampilkan timer kosong. `pindahSlide` sudah memastikan
      // slide-nya tetap terkunci dalam kasus ini.
      if (!dibuka && kondisi.slide && slideBerpoin(kondisi.slide.tipe)) {
        void siarkanHasilKuis(io, sesiId, d.slideId);
      }

      ack({ ok: true, data: null });
    } catch (e) {
      ack({ ok: false, galat: keGalatKirim(e) });
    }
  });

  socket.on('presenter:kunci', async (d, ack) => {
    try {
      const guruId = await guruIdWajibSocket(socket);
      const sesiId = socket.data.sesiId;
      if (!sesiId) throw galatTidakDiizinkan('Belum membuka sesi ini.');

      await kunciSlide(sesiId, guruId, d.dibuka);
      const kondisi = await kondisiSesi(sesiId);
      io.to(kamarPeserta(sesiId)).emit('sesi:kondisi', kondisi);
      io.to(kamarPresenter(sesiId)).emit('sesi:kondisi', kondisi);

      // Momen "reveal" ala Kahoot: begitu slide berpoin DIKUNCI (bukan dibuka),
      // baru saat inilah jawaban benar & leaderboard boleh terbuka. Sebelum ini
      // opsi selalu dikirim tanpa penanda `benar` — lihat slideUntukPengiriman().
      if (!d.dibuka && kondisi.slide && slideBerpoin(kondisi.slide.tipe)) {
        void siarkanHasilKuis(io, sesiId, kondisi.slide.id);
      }

      ack({ ok: true, data: null });
    } catch (e) {
      ack({ ok: false, galat: keGalatKirim(e) });
    }
  });

  socket.on('presenter:sembunyikan', async (d, ack) => {
    try {
      const guruId = await guruIdWajibSocket(socket);
      const sesiId = socket.data.sesiId;
      if (!sesiId) throw galatTidakDiizinkan('Belum membuka sesi ini.');

      const { slideId } = await sembunyikanJawaban(sesiId, guruId, d.jawabanId);
      void siarkanSekarang(io, sesiId, slideId);

      ack({ ok: true, data: null });
    } catch (e) {
      ack({ ok: false, galat: keGalatKirim(e) });
    }
  });

  socket.on('presenter:reset', async (d, ack) => {
    try {
      const guruId = await guruIdWajibSocket(socket);
      const sesiId = socket.data.sesiId;
      if (!sesiId) throw galatTidakDiizinkan('Belum membuka sesi ini.');

      await resetSlideJawaban(sesiId, guruId, d.slideId);

      const kondisi = await kondisiSesi(sesiId);
      io.to(kamarPeserta(sesiId)).emit('sesi:reset', { slideId: d.slideId });
      io.to(kamarPresenter(sesiId)).emit('sesi:reset', { slideId: d.slideId });
      io.to(kamarPeserta(sesiId)).emit('sesi:kondisi', kondisi);
      io.to(kamarPresenter(sesiId)).emit('sesi:kondisi', kondisi);
      void siarkanSekarang(io, sesiId, d.slideId);

      ack({ ok: true, data: null });
    } catch (e) {
      ack({ ok: false, galat: keGalatKirim(e) });
    }
  });

  socket.on('presenter:selesai', async (ack) => {
    try {
      const guruId = await guruIdWajibSocket(socket);
      const sesiId = socket.data.sesiId;
      if (!sesiId) throw galatTidakDiizinkan('Belum membuka sesi ini.');

      await selesaikanSesi(sesiId, guruId);
      io.to(kamarPeserta(sesiId)).emit('sesi:selesai', { sesiId });
      io.to(kamarPresenter(sesiId)).emit('sesi:selesai', { sesiId });

      const top = await leaderboardSesi(sesiId, 3);
      if (top.length > 0) {
        io.to(kamarPeserta(sesiId)).emit('kuis:podium', { top });
        io.to(kamarPresenter(sesiId)).emit('kuis:podium', { top });
      }

      ack({ ok: true, data: null });
    } catch (e) {
      log.error({ err: e }, 'Gagal menyelesaikan sesi');
      ack({ ok: false, galat: keGalatKirim(e) });
    }
  });
}
