import { getDb } from '../db/index.js';
import { galatValidasi } from '../galat.js';
import { BATAS } from '../../shared/konstanta.js';
import type { PengaturanAplikasi } from '../../shared/tipe.js';

/**
 * Branding aplikasi (nama tab browser + logo header) — baris tunggal, diedit
 * superadmin lewat panel Kelola Guru. Dibaca PUBLIK (tanpa login) karena
 * halaman login & gabung sesi pun perlu menampilkannya.
 */

interface BarisPengaturan {
  nama_aplikasi: string;
  logo_path: string | null;
}

function keTipe(b: BarisPengaturan): PengaturanAplikasi {
  return { namaAplikasi: b.nama_aplikasi, logoUrl: b.logo_path };
}

export function ambilPengaturan(): PengaturanAplikasi {
  const b = getDb().prepare('SELECT nama_aplikasi, logo_path FROM pengaturan WHERE id = 1').get() as BarisPengaturan;
  return keTipe(b);
}

export function ubahNamaAplikasi(nama: string): PengaturanAplikasi {
  const n = nama.trim();
  if (n === '') throw galatValidasi('Nama aplikasi wajib diisi.');
  if (n.length > BATAS.namaAplikasi) {
    throw galatValidasi(`Nama aplikasi maksimal ${BATAS.namaAplikasi} karakter.`);
  }
  getDb().prepare(`UPDATE pengaturan SET nama_aplikasi = ?, updated_at = datetime('now') WHERE id = 1`).run(n);
  return ambilPengaturan();
}

/** `path` null = hapus logo (kembali ke lambang huruf bawaan di frontend). */
export function ubahLogo(path: string | null): PengaturanAplikasi {
  getDb().prepare(`UPDATE pengaturan SET logo_path = ?, updated_at = datetime('now') WHERE id = 1`).run(path);
  return ambilPengaturan();
}
