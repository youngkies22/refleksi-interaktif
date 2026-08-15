import fastifyMultipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { guruIdWajib } from '../../auth/wajibLogin.js';
import { keGalatKirim, statusDariGalat } from '../../galat.js';
import { eksporPapanSatu, importPapanSatu } from '../../layanan/backup.js';
import * as layanan from '../../layanan/papan.js';
import type { DataUbahPapan } from '../../layanan/papan.js';
import { namaBerkasAman } from '../../util/teks.js';
import { BACKUP_KONTEN } from '../../../shared/konstanta.js';

interface ParamId {
  id: string;
}

/** Semua rute di sini untuk pengelolaan papan oleh guru — bukan interaksi
 *  papan langsung (itu lewat socket, lihat realtime/papan.ts). */
export async function rutePapan(app: FastifyInstance): Promise<void> {
  await app.register(fastifyMultipart, {
    limits: { fileSize: BACKUP_KONTEN.maksByte, files: 1 },
  });

  // Statis, didaftarkan sebelum `/api/papan/:id` supaya tidak ambigu secara
  // pembacaan berdampingan dengan rute papan lainnya.
  app.post('/api/papan/impor', async (req, balas) => {
    try {
      const guruId = guruIdWajib(req);

      const berkas = await req.file();
      if (!berkas) {
        balas.status(400);
        return { galat: { kode: 'VALIDASI', pesan: 'Tidak ada berkas yang diunggah.' } };
      }

      const buffer = await berkas.toBuffer();
      let data: unknown;
      try {
        data = JSON.parse(buffer.toString('utf8'));
      } catch {
        balas.status(400);
        return { galat: { kode: 'VALIDASI', pesan: 'Berkas bukan JSON yang valid.' } };
      }

      balas.status(201);
      return importPapanSatu(guruId, data);
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.get<{ Params: ParamId }>('/api/papan/:id/ekspor', async (req, balas) => {
    try {
      const guruId = guruIdWajib(req);
      const data = eksporPapanSatu(Number(req.params.id), guruId);
      balas.header('Content-Disposition', `attachment; filename="${namaBerkasAman(data.judul)}.json"`);
      return data;
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.post<{ Params: ParamId }>('/api/papan/:id/duplikat', async (req, balas) => {
    try {
      const guruId = guruIdWajib(req);
      balas.status(201);
      return layanan.duplikatPapan(Number(req.params.id), guruId);
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.get('/api/papan', async (req, balas) => {
    try {
      const guruId = guruIdWajib(req);
      return { papan: layanan.daftarPapan(guruId) };
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.post<{ Body: { judul: string } }>('/api/papan', async (req, balas) => {
    try {
      const guruId = guruIdWajib(req);
      const hasil = layanan.buatPapan(guruId, req.body?.judul ?? '');
      balas.status(201);
      return hasil;
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.get<{ Params: ParamId }>('/api/papan/:id/kartu.csv', async (req, balas) => {
    try {
      const guruId = guruIdWajib(req);
      const csv = layanan.csvKartuPapan(Number(req.params.id), guruId);
      balas
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="papan-${req.params.id}.csv"`);
      // BOM UTF-8 supaya Excel di Windows membaca huruf beraksen dengan benar.
      return '﻿' + csv;
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  /** Kosongkan semua kartu, kolom & pengaturan dipertahankan. */
  app.post<{ Params: ParamId }>('/api/papan/:id/reset', async (req, balas) => {
    try {
      const guruId = guruIdWajib(req);
      return await layanan.resetPapan(Number(req.params.id), guruId);
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.get<{ Params: ParamId }>('/api/papan/:id', async (req, balas) => {
    try {
      const guruId = guruIdWajib(req);
      return layanan.detailPapanUntukGuru(Number(req.params.id), guruId);
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.patch<{ Params: ParamId; Body: DataUbahPapan }>('/api/papan/:id', async (req, balas) => {
    try {
      const guruId = guruIdWajib(req);
      layanan.ubahPapan(Number(req.params.id), guruId, req.body ?? {});
      return { ok: true };
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.delete<{ Params: ParamId }>('/api/papan/:id', async (req, balas) => {
    try {
      const guruId = guruIdWajib(req);
      await layanan.hapusPapan(Number(req.params.id), guruId);
      balas.status(204);
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.post<{ Params: ParamId; Body: { judul: string; warna?: string } }>(
    '/api/papan/:id/kolom',
    async (req, balas) => {
      try {
        const guruId = guruIdWajib(req);
        const hasil = layanan.tambahKolom(Number(req.params.id), guruId, req.body?.judul ?? '', req.body?.warna ?? '');
        balas.status(201);
        return hasil;
      } catch (e) {
        balas.status(statusDariGalat(e));
        return { galat: keGalatKirim(e) };
      }
    },
  );

  app.delete<{ Params: ParamId }>('/api/kolom/:id', async (req, balas) => {
    try {
      const guruId = guruIdWajib(req);
      layanan.hapusKolom(Number(req.params.id), guruId);
      balas.status(204);
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  // Aksi moderasi lewat REST ini mengubah papan yang mungkin sedang DIBUKA
  // peserta lain secara live — wajib disiarkan lewat `app.io`, bukan cuma
  // dikembalikan sebagai respons HTTP ke guru saja. Tanpa ini, kartu yang baru
  // disetujui tidak akan pernah muncul di layar peserta yang sedang menunggu.
  app.post<{ Params: ParamId }>('/api/kartu/:id/setujui', async (req, balas) => {
    try {
      const guruId = guruIdWajib(req);
      const hasil = layanan.setujuiKartu(Number(req.params.id), guruId);
      app.io.to(`papan:${hasil.papanId}`).emit('papan:kartu', { kartu: hasil.kartu });
      return { kartu: hasil.kartu };
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  // Guru bisa menghapus kartu SIAPA PUN (moderasi) lewat rute ini — beda dari
  // penghapusan lewat socket (`papan:kartu_hapus`) yang hanya untuk penulisnya
  // sendiri. `hapusKartu` menerima token kosong + guruId di sini karena guru
  // bukan peserta ber-token, kepemilikannya diverifikasi lewat papan.guru_id.
  app.delete<{ Params: ParamId }>('/api/kartu/:id', async (req, balas) => {
    try {
      const guruId = guruIdWajib(req);
      const kartuId = Number(req.params.id);
      const hasil = await layanan.hapusKartu(kartuId, '', guruId);
      app.io.to(`papan:${hasil.papanId}`).emit('papan:kartu_hapus', { kartuId });
      balas.status(204);
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });
}
