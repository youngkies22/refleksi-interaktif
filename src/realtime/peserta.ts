import type { Socket } from 'socket.io';
import { galatTidakDiizinkan, keGalatKirim } from '../galat.js';
import { submitJawaban } from '../layanan/jawaban.js';
import { catatKehadiran, daftarPesertaSesi, hapusKehadiran, joinPeserta, jumlahPeserta } from '../layanan/sesi.js';
import { normalisasiKode } from '../util/kode.js';
import type { ClientKeServer, DataSocket, ServerKeClient } from '../../shared/kontrak.js';
import type { IoServer } from './index.js';
import { tandaiKotor } from './siaran.js';

type SocketRefleksi = Socket<ClientKeServer, ServerKeClient, Record<string, never>, DataSocket>;

/** Event yang dipicu peserta anonim: join sesi & tanda masih hadir. */
export function daftarkanPeserta(io: IoServer, socket: SocketRefleksi): void {
  socket.on('peserta:join', async (d, ack) => {
    try {
      const kode = normalisasiKode(d.kode ?? '');
      const hasil = await joinPeserta(kode, d.nama ?? '', d.token);

      socket.data.token = hasil.token;
      socket.data.pesertaId = hasil.pesertaId;
      socket.data.sesiId = hasil.kondisi.sesiId;

      await socket.join(`sesi:${hasil.kondisi.sesiId}`);

      ack({
        ok: true,
        data: { token: hasil.token, pesertaId: hasil.pesertaId, kondisi: hasil.kondisi },
      });

      io.to(`sesi:${hasil.kondisi.sesiId}:presenter`).emit('peserta:jumlah', {
        ...(await jumlahPeserta(hasil.kondisi.sesiId)),
        daftar: daftarPesertaSesi(hasil.kondisi.sesiId),
      });
    } catch (e) {
      ack({ ok: false, galat: keGalatKirim(e) });
    }
  });

  // Tanpa payload/ack (lihat shared/kontrak.ts) — cukup menyegarkan ZSET
  // "hadir" milik peserta yang sudah join sebelumnya lewat socket ini.
  socket.on('peserta:ping', () => {
    const { sesiId, token } = socket.data;
    if (sesiId && token) void catatKehadiran(sesiId, token);
  });

  // Tanpa ini, badge "N online" di layar presenter membeku pada angka terakhir
  // sampai kebetulan ada peserta baru join. ZSET `hadir` sendiri sudah otomatis
  // kedaluwarsa lewat ambang 30 detik, tapi presenter tidak pernah diberi tahu —
  // jadi hitungannya perlu disiarkan ulang saat ada socket peserta yang putus.
  socket.on('disconnect', () => {
    const { sesiId, token } = socket.data;
    if (!sesiId || !token) return;
    void (async () => {
      await hapusKehadiran(sesiId, token);
      io.to(`sesi:${sesiId}:presenter`).emit('peserta:jumlah', {
        ...(await jumlahPeserta(sesiId)),
        daftar: daftarPesertaSesi(sesiId),
      });
    })();
  });

  socket.on('peserta:jawab', async (d, ack) => {
    try {
      const { sesiId, token } = socket.data;
      if (!sesiId || !token) throw galatTidakDiizinkan('Anda belum bergabung ke sesi ini.');

      const hasil = await submitJawaban(sesiId, d.slideId, token, d.payload);
      tandaiKotor(sesiId, d.slideId);

      ack({ ok: true, data: { diterima: true } });

      // Umpan balik PRIBADI (hanya ke socket ini) — bukan siaran. Leaderboard
      // dengan nama peserta lain baru terbuka saat reveal (presenter:kunci),
      // supaya tidak membocorkan posisi sementara saat waktu masih berjalan.
      if (hasil.umpanBalik) {
        socket.emit('kuis:umpan_balik', { slideId: d.slideId, ...hasil.umpanBalik });
      }
    } catch (e) {
      ack({ ok: false, galat: keGalatKirim(e) });
    }
  });
}
