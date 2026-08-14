import type {
  DetailPresentasi,
  GuruAdmin,
  Kartu,
  Kolom,
  LogAdminEntri,
  Papan,
  PengaturanAplikasi,
  PengaturanS3Admin,
  RingkasPapanAdmin,
  RingkasPresentasiAdmin,
} from '@bersama/tipe';
import { api, panggil, GalatApi } from './klien.js';

export interface InfoBackupSnapshot {
  nama: string;
  ukuranByte: number;
  dibuatPada: string;
}

export interface DataBuatGuru {
  username: string;
  nama: string;
  password: string;
  role?: 'admin' | 'guru';
}

export interface DataUbahGuruAdmin {
  nama?: string;
  username?: string;
  password?: string;
  role?: 'admin' | 'guru';
  aktif?: boolean;
}

export interface HasilImporGuru {
  berhasil: GuruAdmin[];
  gagal: { baris: number; pesan: string }[];
}

export interface DataUbahS3 {
  endpoint?: string;
  region?: string;
  bucket?: string;
  accessKey?: string;
  /** Kosong/tidak diisi = biarkan secret key lama tersimpan. */
  secretKey?: string;
  /** Selalu ditulis kalau field ini dikirim (walau string kosong) — beda dari
   *  field lain di atas. Lihat `DataUbahS3` versi server (layanan/pengaturan.ts). */
  urlPublik?: string;
}

interface HasilBagianKonten {
  berhasil: number;
  gagal: { judul: string; pesan: string }[];
}

export interface HasilImporKonten {
  presentasi: HasilBagianKonten;
  papan: HasilBagianKonten;
}

function patch<T>(jalur: string, data: unknown): Promise<T> {
  return panggil<T>(jalur, { method: 'PATCH', body: JSON.stringify(data) });
}
function hapus(jalur: string): Promise<void> {
  return panggil<void>(jalur, { method: 'DELETE' });
}

export const apiAdmin = {
  daftarGuru: () => api.get<{ guru: GuruAdmin[] }>('/api/admin/guru'),

  buatGuru: (data: DataBuatGuru) => api.post<{ guru: GuruAdmin }>('/api/admin/guru', data),

  ubahGuru: (id: number, data: DataUbahGuruAdmin) => patch<{ guru: GuruAdmin }>(`/api/admin/guru/${id}`, data),

  hapusGuru: (id: number) => hapus(`/api/admin/guru/${id}`),

  urlTemplateImpor: () => '/api/admin/guru/impor/template',

  urlEksporGuru: () => '/api/admin/guru/ekspor',

  async imporGuru(berkas: File): Promise<HasilImporGuru> {
    const form = new FormData();
    form.append('berkas', berkas);

    const r = await fetch('/api/admin/guru/impor', { method: 'POST', body: form, credentials: 'include' });
    const badan = await r.json().catch(() => null);
    if (!r.ok) {
      throw new GalatApi(badan?.galat ?? { kode: 'GALAT_SERVER', pesan: 'Gagal mengimpor akun guru.' });
    }
    return badan as HasilImporGuru;
  },

  semuaKonten: () => api.get<{ presentasi: RingkasPresentasiAdmin[]; papan: RingkasPapanAdmin[] }>('/api/admin/konten'),

  detailPresentasi: (id: number) => api.get<{ presentasi: DetailPresentasi }>(`/api/admin/presentasi/${id}`),

  detailPapan: (id: number) => api.get<{ papan: Papan; kolom: Kolom[]; kartu: Kartu[] }>(`/api/admin/papan/${id}`),

  urlEksporPresentasiGuru: (guruId: number, presentasiId: number) =>
    `/api/admin/guru/${guruId}/presentasi/${presentasiId}/ekspor`,

  urlEksporPapanGuru: (guruId: number, papanId: number) => `/api/admin/guru/${guruId}/papan/${papanId}/ekspor`,

  urlEksporKonten: () => '/api/admin/backup/ekspor',

  async imporKonten(berkas: File): Promise<HasilImporKonten> {
    const form = new FormData();
    form.append('berkas', berkas);

    const r = await fetch('/api/admin/backup/impor', { method: 'POST', body: form, credentials: 'include' });
    const badan = await r.json().catch(() => null);
    if (!r.ok) {
      throw new GalatApi(badan?.galat ?? { kode: 'GALAT_SERVER', pesan: 'Gagal mengimpor backup konten.' });
    }
    return badan as HasilImporKonten;
  },

  daftarLog: () => api.get<{ log: LogAdminEntri[] }>('/api/admin/log'),

  daftarSnapshot: () => api.get<{ snapshot: InfoBackupSnapshot[] }>('/api/admin/backup/snapshot'),

  buatSnapshotSekarang: () => api.post<{ snapshot: InfoBackupSnapshot[] }>('/api/admin/backup/snapshot'),

  urlUnduhSnapshot: (nama: string) => `/api/admin/backup/snapshot/${encodeURIComponent(nama)}/unduh`,

  pulihkanSnapshot: (nama: string) =>
    api.post<{ ok: true }>(`/api/admin/backup/snapshot/${encodeURIComponent(nama)}/pulihkan`),

  ubahNamaAplikasi: (namaAplikasi: string) =>
    patch<{ pengaturan: PengaturanAplikasi }>('/api/admin/pengaturan', { namaAplikasi }),

  async unggahLogo(berkas: File): Promise<{ pengaturan: PengaturanAplikasi }> {
    const form = new FormData();
    form.append('berkas', berkas);

    const r = await fetch('/api/admin/pengaturan/logo', { method: 'POST', body: form, credentials: 'include' });
    const badan = await r.json().catch(() => null);
    if (!r.ok) {
      throw new GalatApi(badan?.galat ?? { kode: 'GALAT_SERVER', pesan: 'Gagal mengunggah logo.' });
    }
    return badan as { pengaturan: PengaturanAplikasi };
  },

  hapusLogo: () => panggil<{ pengaturan: PengaturanAplikasi }>('/api/admin/pengaturan/logo', { method: 'DELETE' }),

  ambilPengaturanS3: () => api.get<{ pengaturan: PengaturanS3Admin }>('/api/admin/pengaturan/s3'),

  ubahPengaturanS3: (data: DataUbahS3) => patch<{ pengaturan: PengaturanS3Admin }>('/api/admin/pengaturan/s3', data),

  hapusPengaturanS3: () => panggil<{ pengaturan: PengaturanS3Admin }>('/api/admin/pengaturan/s3', { method: 'DELETE' }),

  ujiPengaturanS3: (data: DataUbahS3) => panggil<{ ok: true }>('/api/admin/pengaturan/s3/uji', { method: 'POST', body: JSON.stringify(data) }),
};
