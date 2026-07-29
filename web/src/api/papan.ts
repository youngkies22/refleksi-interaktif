import type { Kartu, Kolom, Komentar, Papan, RingkasPapan } from '@bersama/tipe';
import { api, panggil, GalatApi } from './klien.js';

export interface DataUbahPapan {
  judul?: string;
  deskripsi?: string;
  tataLetak?: 'kolom' | 'dinding';
  anonim?: boolean;
  perluPersetujuan?: boolean;
  izinkanLike?: boolean;
  izinkanKomentar?: boolean;
  terkunci?: boolean;
}

function patch<T>(jalur: string, data: unknown): Promise<T> {
  return panggil<T>(jalur, { method: 'PATCH', body: JSON.stringify(data) });
}
function hapus(jalur: string): Promise<void> {
  return panggil<void>(jalur, { method: 'DELETE' });
}

export const apiPapan = {
  daftar: () => api.get<{ papan: RingkasPapan[] }>('/api/papan'),

  buat: (judul: string) => api.post<{ id: number; kode: string }>('/api/papan', { judul }),

  detail: (id: number) =>
    api.get<{ papan: Papan; kolom: Kolom[]; kartu: Kartu[] }>(`/api/papan/${id}`),

  ubah: (id: number, data: DataUbahPapan) => patch<{ ok: true }>(`/api/papan/${id}`, data),

  hapus: (id: number) => hapus(`/api/papan/${id}`),

  duplikat: (id: number) => api.post<{ id: number; kode: string }>(`/api/papan/${id}/duplikat`),

  urlCsv: (id: number) => `/api/papan/${id}/kartu.csv`,

  reset: (id: number) => api.post<{ dihapus: number }>(`/api/papan/${id}/reset`),

  tambahKolom: (papanId: number, judul: string, warna?: string) =>
    api.post<{ id: number }>(`/api/papan/${papanId}/kolom`, { judul, warna }),

  hapusKolom: (kolomId: number) => hapus(`/api/kolom/${kolomId}`),

  setujuiKartu: (kartuId: number) => api.post<{ kartu: Kartu }>(`/api/kartu/${kartuId}/setujui`),

  hapusKartu: (kartuId: number) => hapus(`/api/kartu/${kartuId}`),

  komentarKartu: (kartuId: number) => api.get<{ komentar: Komentar[] }>(`/api/kartu/${kartuId}/komentar`),

  urlEkspor: (id: number) => `/api/papan/${id}/ekspor`,

  async impor(berkas: File): Promise<{ id: number }> {
    const form = new FormData();
    form.append('berkas', berkas);

    const r = await fetch('/api/papan/impor', { method: 'POST', body: form, credentials: 'include' });
    const badan = await r.json().catch(() => null);
    if (!r.ok) {
      throw new GalatApi(badan?.galat ?? { kode: 'GALAT_SERVER', pesan: 'Gagal mengimpor papan.' });
    }
    return badan as { id: number };
  },
};
