import { getDb } from '../db/index.js';
import type { LogAdminEntri } from '../../shared/tipe.js';

/**
 * Audit trail tindakan superadmin — siapa mengubah/menghapus/memblokir akun
 * guru apa dan kapan. Ditulis best-effort dari dalam fungsi layanan yang
 * bersangkutan, bukan lewat middleware generik: aksinya sedikit dan berbeda-beda
 * bentuk detailnya, jadi lebih jelas dicatat eksplisit di titik terjadinya.
 */

interface BarisLogAdmin {
  id: number;
  admin_nama: string;
  aksi: string;
  target_tipe: string;
  target_id: number | null;
  detail: string;
  created_at: string;
}

export function catatLogAdmin(
  adminId: number,
  adminNama: string,
  aksi: string,
  targetTipe: string,
  targetId: number | null,
  detail = '',
): void {
  getDb()
    .prepare(
      `INSERT INTO log_admin (admin_id, admin_nama, aksi, target_tipe, target_id, detail)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(adminId, adminNama, aksi, targetTipe, targetId, detail);
}

export function daftarLogAdmin(limit = 200): LogAdminEntri[] {
  const baris = getDb()
    .prepare('SELECT * FROM log_admin ORDER BY created_at DESC, id DESC LIMIT ?')
    .all(limit) as BarisLogAdmin[];

  return baris.map((b) => ({
    id: b.id,
    adminNama: b.admin_nama,
    aksi: b.aksi,
    targetTipe: b.target_tipe,
    targetId: b.target_id,
    detail: b.detail,
    createdAt: b.created_at,
  }));
}
