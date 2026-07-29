import type { FastifyInstance } from 'fastify';
import { cariPapanIdDariKode } from '../../layanan/papan.js';
import { cariSesiIdDariKode } from '../../layanan/sesi.js';
import { normalisasiKode } from '../../util/kode.js';

/**
 * Deteksi jenis kode 6 karakter — SATU form "Masukkan Kode" di halaman depan
 * dipakai untuk dua hal (sesi live & papan Padlet), jadi harus ada cara
 * membedakan sebelum diarahkan. Rute publik, tanpa login — sama seperti
 * halaman depan yang memanggilnya.
 */
export async function ruteKode(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { kode: string } }>('/api/kode/:kode', async (req) => {
    const kode = normalisasiKode(req.params.kode);

    const sesiId = await cariSesiIdDariKode(kode);
    if (sesiId) return { tipe: 'sesi' as const };

    const papanId = await cariPapanIdDariKode(kode);
    if (papanId) return { tipe: 'papan' as const };

    return { tipe: null };
  });
}
