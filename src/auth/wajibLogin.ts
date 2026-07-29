import type { FastifyRequest } from 'fastify';
import { galatTidakDiizinkan } from '../galat.js';
import { cariGuruById } from '../layanan/auth.js';

/**
 * Ambil id guru dari session, atau lempar galat 401.
 *
 * Dipanggil di awal tiap handler rute yang butuh login guru — bukan lewat
 * `preHandler` global, supaya rute publik (join peserta, healthcheck) tidak
 * ikut ter-guard secara tidak sengaja saat rute baru ditambahkan.
 */
export function guruIdWajib(req: FastifyRequest): number {
  const id = req.session.guruId;
  if (!id) throw galatTidakDiizinkan('Anda harus masuk sebagai guru untuk mengakses ini.');

  // Verifikasi guru masih ada & aktif — sesi Redis bisa saja bertahan lebih
  // lama daripada akun guru yang sudah dihapus/dinonaktifkan admin.
  const guru = cariGuruById(id);
  if (!guru) throw galatTidakDiizinkan('Akun Anda sudah tidak aktif.');

  return id;
}

/** Sama seperti `guruIdWajib`, tapi juga menuntut role 'admin' — dipakai rute
 *  kelola akun guru (`/api/admin/guru/*`) supaya guru biasa tidak bisa mengakses. */
export function adminIdWajib(req: FastifyRequest): number {
  const id = guruIdWajib(req);
  const guru = cariGuruById(id);
  if (guru?.role !== 'admin') throw galatTidakDiizinkan('Hanya superadmin yang bisa mengakses ini.');
  return id;
}
