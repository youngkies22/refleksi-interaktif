import type { FastifyInstance } from 'fastify';
import { guruIdWajib } from '../../auth/wajibLogin.js';
import { keGalatKirim, statusDariGalat } from '../../galat.js';
import { csvHasilSesi, daftarSesiPresentasi, hasilSesi } from '../../layanan/rekap.js';
import {
  cariSesiIdDariKode,
  hapusSesi,
  mulaiSesi,
  resetSeluruhSesi,
  sesiUntukGuru,
} from '../../layanan/sesi.js';
import { normalisasiKode } from '../../util/kode.js';

interface ParamId {
  id: string;
}

interface ParamKode {
  kode: string;
}

export async function ruteSesi(app: FastifyInstance): Promise<void> {
  app.post<{ Params: ParamId }>('/api/presentasi/:id/mulai-sesi', async (req, balas) => {
    try {
      const guruId = guruIdWajib(req);
      const hasil = mulaiSesi(Number(req.params.id), guruId);
      balas.status(201);
      return hasil;
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  // Dipakai halaman presenter Vue untuk menerjemahkan kode di URL menjadi
  // sesiId sebelum membuka koneksi socket (event `presenter:buka` butuh id).
  app.get<{ Params: ParamKode }>('/api/sesi/oleh-kode/:kode', async (req, balas) => {
    try {
      const guruId = guruIdWajib(req);
      const kode = normalisasiKode(req.params.kode);
      const sesiId = await cariSesiIdDariKode(kode);
      if (!sesiId) {
        balas.status(404);
        return { galat: { kode: 'TIDAK_DITEMUKAN', pesan: 'Kode sesi tidak ditemukan.' } };
      }
      const baris = sesiUntukGuru(sesiId, guruId); // melempar 404 kalau bukan pemilik
      return { sesiId, presentasiId: baris.presentasi_id };
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  // Riwayat semua sesi milik satu presentasi — pintu masuk guru untuk mengunduh
  // data kelas-kelas sebelumnya.
  app.get<{ Params: ParamId }>('/api/presentasi/:id/sesi', async (req, balas) => {
    try {
      const guruId = guruIdWajib(req);
      return { sesi: daftarSesiPresentasi(Number(req.params.id), guruId) };
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  /** Kosongkan sesi (jawaban + peserta) supaya kode yang sama bisa dipakai kelas berikutnya. */
  app.post<{ Params: ParamId }>('/api/sesi/:id/reset', async (req, balas) => {
    try {
      const guruId = guruIdWajib(req);
      return await resetSeluruhSesi(Number(req.params.id), guruId);
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.delete<{ Params: ParamId }>('/api/sesi/:id', async (req, balas) => {
    try {
      const guruId = guruIdWajib(req);
      await hapusSesi(Number(req.params.id), guruId);
      balas.status(204);
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.get<{ Params: ParamId }>('/api/sesi/:id/hasil', async (req, balas) => {
    try {
      const guruId = guruIdWajib(req);
      return { hasil: hasilSesi(Number(req.params.id), guruId) };
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.get<{ Params: ParamId }>('/api/sesi/:id/hasil.csv', async (req, balas) => {
    try {
      const guruId = guruIdWajib(req);
      const csv = csvHasilSesi(Number(req.params.id), guruId);
      balas
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="hasil-sesi-${req.params.id}.csv"`);
      // BOM UTF-8 di depan supaya Excel di Windows membaca huruf non-ASCII dengan benar.
      return '﻿' + csv;
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });
}
