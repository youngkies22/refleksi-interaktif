import fastifyMultipart from '@fastify/multipart';
import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { adminIdWajib } from '../../auth/wajibLogin.js';
import {
  buatGuru,
  cariGuruById,
  daftarGuru,
  eksporGuruCsv,
  hapusGuru,
  importGuruCsv,
  templateImporGuruCsv,
  ubahGuruAdmin,
  type DataBuatGuru,
  type DataUbahGuruAdmin,
} from '../../layanan/auth.js';
import { eksporKontenJson, eksporPapanSatu, eksporPresentasiSatu, importKontenJson } from '../../layanan/backup.js';
import { backupSekarang, daftarBackup, jalurBackup, pulihkanDariBackup } from '../../db/index.js';
import { catatLogAdmin, daftarLogAdmin } from '../../layanan/logAdmin.js';
import { daftarSemuaPapan, detailPapanAdmin } from '../../layanan/papan.js';
import { ambilPengaturan, ubahLogo, ubahNamaAplikasi } from '../../layanan/pengaturan.js';
import { daftarSemuaPresentasi, detailPresentasiAdmin } from '../../layanan/presentasi.js';
import { simpanGambarUnggahan } from '../../layanan/unggah.js';
import { namaBerkasAman } from '../../util/teks.js';
import { keGalatKirim, statusDariGalat } from '../../galat.js';
import { BACKUP_KONTEN } from '../../../shared/konstanta.js';

interface ParamId {
  id: string;
}

interface ParamGuruItem {
  guruId: string;
  id: string;
}

interface ParamNamaBackup {
  nama: string;
}

/** Rute superadmin untuk kelola akun guru — semua endpoint di sini menuntut
 *  `role: 'admin'` lewat `adminIdWajib`, bukan sekadar login guru biasa. */
export async function ruteAdmin(app: FastifyInstance): Promise<void> {
  // Batas dipakai bersama oleh import CSV guru & import backup JSON (yang
  // jauh lebih besar karena lampiran gambar ter-embed base64) — satu plugin
  // multipart per-scope Fastify cuma bisa punya satu batas ukuran berkas.
  await app.register(fastifyMultipart, {
    limits: { fileSize: BACKUP_KONTEN.maksByte, files: 1 },
  });

  app.get('/api/admin/guru', async (req, balas) => {
    try {
      adminIdWajib(req);
      return { guru: daftarGuru() };
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.post<{ Body: DataBuatGuru }>('/api/admin/guru', async (req, balas) => {
    try {
      const adminId = adminIdWajib(req);
      balas.status(201);
      return { guru: buatGuru(req.body, adminId) };
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  // Statis, didaftarkan sebelum `/api/admin/guru/:id` supaya tidak ambigu
  // secara pembacaan (radix router Fastify tetap memprioritaskan rute statis
  // di atas parametrik terlepas dari urutan daftar, tapi begini lebih jelas
  // dibaca berdampingan dengan endpoint POST/GET guru lainnya).
  app.get('/api/admin/guru/impor/template', async (req, balas) => {
    try {
      adminIdWajib(req);
      balas.header('Content-Type', 'text/csv; charset=utf-8');
      balas.header('Content-Disposition', 'attachment; filename="template-akun-guru.csv"');
      return templateImporGuruCsv();
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.get('/api/admin/guru/ekspor', async (req, balas) => {
    try {
      adminIdWajib(req);
      const cap = new Date().toISOString().slice(0, 10);
      balas.header('Content-Type', 'text/csv; charset=utf-8');
      balas.header('Content-Disposition', `attachment; filename="akun-guru-${cap}.csv"`);
      return eksporGuruCsv();
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.post('/api/admin/guru/impor', async (req, balas) => {
    try {
      const adminId = adminIdWajib(req);

      const berkas = await req.file();
      if (!berkas) {
        balas.status(400);
        return { galat: { kode: 'VALIDASI', pesan: 'Tidak ada berkas yang diunggah.' } };
      }

      const buffer = await berkas.toBuffer();
      return importGuruCsv(buffer.toString('utf8'), adminId);
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  // Backup/restore SELURUH presentasi & papan (semua guru) — lihat
  // layanan/backup.ts untuk alasan format & batasan lengkapnya.
  app.get('/api/admin/backup/ekspor', async (req, balas) => {
    try {
      adminIdWajib(req);
      const cap = new Date().toISOString().slice(0, 10);
      balas.header('Content-Disposition', `attachment; filename="backup-konten-${cap}.json"`);
      return eksporKontenJson();
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.post('/api/admin/backup/impor', async (req, balas) => {
    try {
      adminIdWajib(req);

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

      return importKontenJson(data);
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  // Snapshot database utuh (bukan JSON per-item) yang dibuat backup berkala
  // server — lihat db/index.ts. Daftar & unduh murni baca berkas; pulihkan
  // MENIMPA database yang sedang aktif, jadi selalu mencadangkan kondisi
  // sekarang dulu sebelum menimpa (lihat pulihkanDariBackup).
  app.get('/api/admin/backup/snapshot', async (req, balas) => {
    try {
      adminIdWajib(req);
      return { snapshot: daftarBackup() };
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  // Pemicu manual — di luar jadwal harian, mis. sebelum melakukan perubahan
  // besar yang berisiko.
  app.post('/api/admin/backup/snapshot', async (req, balas) => {
    try {
      adminIdWajib(req);
      const tujuan = await backupSekarang();
      if (!tujuan) {
        balas.status(500);
        return { galat: { kode: 'GALAT_SERVER', pesan: 'Gagal membuat snapshot. Cek log server.' } };
      }
      return { snapshot: daftarBackup() };
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.get<{ Params: ParamNamaBackup }>('/api/admin/backup/snapshot/:nama/unduh', async (req, balas) => {
    try {
      adminIdWajib(req);
      const jalur = jalurBackup(req.params.nama);
      if (!jalur) {
        balas.status(404);
        return { galat: { kode: 'TIDAK_DITEMUKAN', pesan: 'Berkas snapshot tidak ditemukan.' } };
      }
      balas.header('Content-Type', 'application/octet-stream');
      balas.header('Content-Disposition', `attachment; filename="${req.params.nama}"`);
      return createReadStream(jalur);
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.post<{ Params: ParamNamaBackup }>('/api/admin/backup/snapshot/:nama/pulihkan', async (req, balas) => {
    try {
      const adminId = adminIdWajib(req);
      await pulihkanDariBackup(req.params.nama);
      catatLogAdmin(
        adminId,
        cariGuruById(adminId)?.nama ?? `#${adminId}`,
        'pulihkan_backup',
        'database',
        null,
        `Memulihkan database dari snapshot "${req.params.nama}" (kondisi sebelumnya otomatis dicadangkan lebih dulu)`,
      );
      return { ok: true };
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.get('/api/admin/log', async (req, balas) => {
    try {
      adminIdWajib(req);
      return { log: daftarLogAdmin() };
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  // Branding aplikasi (nama tab & logo header) — endpoint baca publiknya ada
  // di rute/api/pengaturan.ts; di sini hanya bagian yang mengubah.
  app.patch<{ Body: { namaAplikasi?: string } }>('/api/admin/pengaturan', async (req, balas) => {
    try {
      const adminId = adminIdWajib(req);
      const namaLama = ambilPengaturan().namaAplikasi;
      const namaBaru = req.body?.namaAplikasi;
      if (namaBaru === undefined) {
        return { pengaturan: ambilPengaturan() };
      }
      const pengaturan = ubahNamaAplikasi(namaBaru);
      catatLogAdmin(
        adminId,
        cariGuruById(adminId)?.nama ?? `#${adminId}`,
        'ubah_pengaturan',
        'aplikasi',
        null,
        `Nama aplikasi diubah dari "${namaLama}" ke "${pengaturan.namaAplikasi}"`,
      );
      return { pengaturan };
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.post('/api/admin/pengaturan/logo', async (req, balas) => {
    try {
      const adminId = adminIdWajib(req);

      const berkas = await req.file();
      if (!berkas) {
        balas.status(400);
        return { galat: { kode: 'VALIDASI', pesan: 'Tidak ada berkas yang diunggah.' } };
      }

      const buffer = await berkas.toBuffer();
      const { path } = await simpanGambarUnggahan(buffer);
      const pengaturan = ubahLogo(path);
      catatLogAdmin(adminId, cariGuruById(adminId)?.nama ?? `#${adminId}`, 'ubah_pengaturan', 'aplikasi', null, 'Logo aplikasi diganti');
      return { pengaturan };
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.delete('/api/admin/pengaturan/logo', async (req, balas) => {
    try {
      const adminId = adminIdWajib(req);
      const pengaturan = ubahLogo(null);
      catatLogAdmin(adminId, cariGuruById(adminId)?.nama ?? `#${adminId}`, 'ubah_pengaturan', 'aplikasi', null, 'Logo aplikasi dihapus');
      return { pengaturan };
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  // Lihat SELURUH presentasi & papan lintas semua guru dalam satu daftar —
  // superadmin saja, guru biasa tidak boleh mengintip konten sesama guru
  // lewat rute ini.
  app.get('/api/admin/konten', async (req, balas) => {
    try {
      adminIdWajib(req);
      return { presentasi: daftarSemuaPresentasi(), papan: daftarSemuaPapan() };
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  // Detail lengkap satu presentasi/papan (isi slide / isi kartu) — dipakai
  // panel "lihat konten" di superadmin, tanpa cek kepemilikan sama sekali.
  app.get<{ Params: ParamId }>('/api/admin/presentasi/:id', async (req, balas) => {
    try {
      adminIdWajib(req);
      return { presentasi: detailPresentasiAdmin(Number(req.params.id)) };
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.get<{ Params: ParamId }>('/api/admin/papan/:id', async (req, balas) => {
    try {
      adminIdWajib(req);
      return detailPapanAdmin(Number(req.params.id));
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  // `guruId` di sini datang dari path (ditentukan admin lewat panel guru
  // yang sedang dibuka), bukan dari sesi login — beda dari rute guru biasa
  // di rutePresentasi/rutePapan yang selalu memakai id sesi sendiri.
  app.get<{ Params: ParamGuruItem }>('/api/admin/guru/:guruId/presentasi/:id/ekspor', async (req, balas) => {
    try {
      adminIdWajib(req);
      const data = eksporPresentasiSatu(Number(req.params.id), Number(req.params.guruId));
      balas.header('Content-Disposition', `attachment; filename="${namaBerkasAman(data.judul)}.json"`);
      return data;
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.get<{ Params: ParamGuruItem }>('/api/admin/guru/:guruId/papan/:id/ekspor', async (req, balas) => {
    try {
      adminIdWajib(req);
      const data = eksporPapanSatu(Number(req.params.id), Number(req.params.guruId));
      balas.header('Content-Disposition', `attachment; filename="${namaBerkasAman(data.judul)}.json"`);
      return data;
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.patch<{ Params: ParamId; Body: DataUbahGuruAdmin }>('/api/admin/guru/:id', async (req, balas) => {
    try {
      const adminId = adminIdWajib(req);
      return { guru: ubahGuruAdmin(Number(req.params.id), req.body ?? {}, adminId) };
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });

  app.delete<{ Params: ParamId }>('/api/admin/guru/:id', async (req, balas) => {
    try {
      const adminId = adminIdWajib(req);
      hapusGuru(Number(req.params.id), adminId);
      balas.status(204);
    } catch (e) {
      balas.status(statusDariGalat(e));
      return { galat: keGalatKirim(e) };
    }
  });
}
