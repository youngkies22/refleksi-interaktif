import fastifyMultipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { guruIdWajib } from '../../auth/wajibLogin.js';
import { keGalatKirim, statusDariGalat } from '../../galat.js';
import { eksporPresentasiSatu, importPresentasiSatu } from '../../layanan/backup.js';
import * as layanan from '../../layanan/presentasi.js';
import type { DataUbahSlide } from '../../layanan/presentasi.js';
import { namaBerkasAman } from '../../util/teks.js';
import { BACKUP_KONTEN } from '../../../shared/konstanta.js';

interface ParamId {
  id: string;
}

/** Semua rute di sini butuh login guru — dicek di baris pertama tiap handler. */
export async function rutePresentasi(app: FastifyInstance): Promise<void> {
  await app.register(fastifyMultipart, {
    limits: { fileSize: BACKUP_KONTEN.maksByte, files: 1 },
  });

  // Statis, didaftarkan sebelum `/api/presentasi/:id` supaya tidak ambigu
  // secara pembacaan berdampingan dengan rute presentasi lainnya.
  app.post('/api/presentasi/impor', async (req, balas) => {
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
      return importPresentasiSatu(guruId, data);
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.get<{ Params: ParamId }>('/api/presentasi/:id/ekspor', async (req, balas) => {
    try {
      const guruId = guruIdWajib(req);
      const data = eksporPresentasiSatu(Number(req.params.id), guruId);
      balas.header('Content-Disposition', `attachment; filename="${namaBerkasAman(data.judul)}.json"`);
      return data;
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.post<{ Params: ParamId }>('/api/presentasi/:id/duplikat', async (req, balas) => {
    try {
      const guruId = guruIdWajib(req);
      balas.status(201);
      return layanan.duplikatPresentasi(Number(req.params.id), guruId);
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.get('/api/presentasi', async (req, balas) => {
    try {
      const guruId = guruIdWajib(req);
      return { presentasi: layanan.daftarPresentasi(guruId) };
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.post<{ Body: { judul: string } }>('/api/presentasi', async (req, balas) => {
    try {
      const guruId = guruIdWajib(req);
      const hasil = layanan.buatPresentasi(guruId, req.body?.judul ?? '');
      balas.status(201);
      return hasil;
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.get<{ Params: ParamId }>('/api/presentasi/:id', async (req, balas) => {
    try {
      const guruId = guruIdWajib(req);
      const presentasi = layanan.detailPresentasi(Number(req.params.id), guruId);
      return { presentasi };
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.patch<{ Params: ParamId; Body: { judul?: string; deskripsi?: string } }>(
    '/api/presentasi/:id',
    async (req, balas) => {
      try {
        const guruId = guruIdWajib(req);
        layanan.ubahPresentasi(Number(req.params.id), guruId, req.body ?? {});
        return { ok: true };
      } catch (e) {
        balas.status(statusDariGalat(e));
        return { galat: keGalatKirim(e) };
      }
    },
  );

  app.delete<{ Params: ParamId }>('/api/presentasi/:id', async (req, balas) => {
    try {
      const guruId = guruIdWajib(req);
      layanan.hapusPresentasi(Number(req.params.id), guruId);
      balas.status(204);
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.post<{ Params: ParamId; Body: { idUrutan: number[] } }>(
    '/api/presentasi/:id/urutan',
    async (req, balas) => {
      try {
        const guruId = guruIdWajib(req);
        layanan.urutkanSlide(Number(req.params.id), guruId, req.body?.idUrutan ?? []);
        return { ok: true };
      } catch (e) {
        balas.status(statusDariGalat(e));
        return { galat: keGalatKirim(e) };
      }
    },
  );

  app.post<{ Params: ParamId; Body: { tipe: string } }>(
    '/api/presentasi/:id/slide',
    async (req, balas) => {
      try {
        const guruId = guruIdWajib(req);
        const hasil = layanan.tambahSlide(Number(req.params.id), guruId, req.body?.tipe ?? '');
        balas.status(201);
        return hasil;
      } catch (e) {
        balas.status(statusDariGalat(e));
        return { galat: keGalatKirim(e) };
      }
    },
  );

  app.patch<{ Params: ParamId; Body: DataUbahSlide }>('/api/slide/:id', async (req, balas) => {
    try {
      const guruId = guruIdWajib(req);
      layanan.ubahSlide(Number(req.params.id), guruId, req.body ?? {});
      return { ok: true };
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.delete<{ Params: ParamId }>('/api/slide/:id', async (req, balas) => {
    try {
      const guruId = guruIdWajib(req);
      layanan.hapusSlide(Number(req.params.id), guruId);
      balas.status(204);
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });
}
