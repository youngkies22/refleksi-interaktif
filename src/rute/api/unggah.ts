import fastifyMultipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { adminIdWajib, guruIdWajib } from '../../auth/wajibLogin.js';
import { keGalatKirim, statusDariGalat } from '../../galat.js';
import { cariGuruById } from '../../layanan/auth.js';
import { ambilPresentasiMilik } from '../../layanan/presentasi.js';
import { folderGuru, hapusGambarUnggahan, jelajahUnggahan, pathMilikGuru, simpanGambarUnggahan } from '../../layanan/unggah.js';
import { UNGGAH } from '../../../shared/konstanta.js';

/** Angka positif dari query string, atau `null` kalau kosong/tidak valid —
 *  dipakai untuk menyusun folder S3, jadi HARUS lolos cek ini sebelum ikut
 *  dirangkai jadi key (lihat `simpanGambarUnggahan`). */
function idPositifDariQuery(nilai: unknown): number | null {
  if (nilai === undefined || nilai === null || nilai === '') return null;
  const n = Number(nilai);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function ruteUnggah(app: FastifyInstance): Promise<void> {
  await app.register(fastifyMultipart, {
    limits: { fileSize: UNGGAH.maksByte, files: 1 },
  });

  app.post<{ Querystring: { presentasiId?: string; slideId?: string } }>('/api/unggah/gambar', async (req, balas) => {
    try {
      const guruId = guruIdWajib(req);

      // Konteks opsional (diisi editor presentasi) — dipakai HANYA untuk
      // menyusun folder S3 `guru/{id}-nama/presentasi/{id}/slide/{id|baru}/...`
      // supaya gambar pertanyaan & pin_jawaban tidak numpuk rata di root bucket.
      // `slideId` boleh belum ada (slide `pin_jawaban` baru dibuat SETELAH
      // gambar diunggah), tapi kepemilikan `presentasiId` selalu divalidasi
      // dulu supaya foldernya tidak bisa dipaksa mengarah ke presentasi guru lain.
      const presentasiId = idPositifDariQuery(req.query?.presentasiId);
      const slideId = idPositifDariQuery(req.query?.slideId);

      let folder: string | undefined;
      if (presentasiId !== null) {
        ambilPresentasiMilik(presentasiId, guruId);
        const guru = cariGuruById(guruId);
        folder = `${folderGuru(guruId, guru?.nama ?? `#${guruId}`)}/presentasi/${presentasiId}/slide/${slideId ?? 'baru'}`;
      }

      const berkas = await req.file();
      if (!berkas) {
        balas.status(400);
        return { galat: { kode: 'VALIDASI', pesan: 'Tidak ada berkas yang diunggah.' } };
      }

      const buffer = await berkas.toBuffer();
      const hasil = await simpanGambarUnggahan(buffer, folder);
      return hasil;
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.delete('/api/unggah/gambar', async (req, balas) => {
    try {
      const guruId = guruIdWajib(req);

      const body = (req.body as any) ?? {};
      const path = body.path;
      if (!path || typeof path !== 'string') {
        balas.status(400);
        return { galat: { kode: 'VALIDASI', pesan: 'Path gambar tidak valid.' } };
      }

      // Guru biasa cuma boleh hapus gambar dari folder sendiri (mis. ganti
      // gambar pertanyaan di slide-nya sendiri) — di luar itu (folder guru
      // lain, folder admin, atau gambar lama tanpa folder) wajib admin,
      // dipakai panel "Manajemen Gambar" untuk bersih-bersih lintas guru.
      if (!pathMilikGuru(path, guruId)) {
        adminIdWajib(req);
      }

      await hapusGambarUnggahan(path);
      return { ok: true };
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  // Galeri "Manajemen Gambar" — admin-only (lihat `web/src/halaman/AdminGuru.vue`),
  // drill-down folder guru → papan/presentasi → gambar (lihat `jelajahUnggahan`).
  app.get('/api/unggah/daftar', async (req, balas) => {
    try {
      adminIdWajib(req);

      const q = req.query as any;
      const path = typeof q?.path === 'string' ? q.path : '';
      const limit = Math.min(parseInt(q?.limit ?? '50'), 100);
      const offset = parseInt(q?.offset ?? '0');

      const hasil = await jelajahUnggahan(path, limit, offset);
      return hasil;
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });
}
