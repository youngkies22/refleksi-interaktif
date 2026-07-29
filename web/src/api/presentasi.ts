import type { DetailPresentasi, KonfigSlide, RingkasPresentasi, TipeSlide } from '@bersama/tipe';
import { api, panggil, GalatApi } from './klien.js';

export interface OpsiInput {
  teks: string;
  benar?: boolean;
}

export interface UbahSlideInput {
  pertanyaan?: string;
  konfig?: KonfigSlide;
  opsi?: OpsiInput[];
}

function patch<T>(jalur: string, data: unknown): Promise<T> {
  return panggil<T>(jalur, { method: 'PATCH', body: JSON.stringify(data) });
}

function hapus(jalur: string): Promise<void> {
  return panggil<void>(jalur, { method: 'DELETE' });
}

export const apiPresentasi = {
  daftar: () => api.get<{ presentasi: RingkasPresentasi[] }>('/api/presentasi'),

  buat: (judul: string) => api.post<{ id: number }>('/api/presentasi', { judul }),

  detail: (id: number) => api.get<{ presentasi: DetailPresentasi }>(`/api/presentasi/${id}`),

  ubah: (id: number, data: { judul?: string; deskripsi?: string }) =>
    patch<{ ok: true }>(`/api/presentasi/${id}`, data),

  hapus: (id: number) => hapus(`/api/presentasi/${id}`),

  duplikat: (id: number) => api.post<{ id: number }>(`/api/presentasi/${id}/duplikat`),

  urutkanSlide: (presentasiId: number, idUrutan: number[]) =>
    api.post<{ ok: true }>(`/api/presentasi/${presentasiId}/urutan`, { idUrutan }),

  tambahSlide: (presentasiId: number, tipe: TipeSlide) =>
    api.post<{ id: number }>(`/api/presentasi/${presentasiId}/slide`, { tipe }),

  ubahSlide: (slideId: number, data: UbahSlideInput) => patch<{ ok: true }>(`/api/slide/${slideId}`, data),

  hapusSlide: (slideId: number) => hapus(`/api/slide/${slideId}`),

  urlEkspor: (id: number) => `/api/presentasi/${id}/ekspor`,

  async impor(berkas: File): Promise<{ id: number }> {
    const form = new FormData();
    form.append('berkas', berkas);

    const r = await fetch('/api/presentasi/impor', { method: 'POST', body: form, credentials: 'include' });
    const badan = await r.json().catch(() => null);
    if (!r.ok) {
      throw new GalatApi(badan?.galat ?? { kode: 'GALAT_SERVER', pesan: 'Gagal mengimpor presentasi.' });
    }
    return badan as { id: number };
  },
};
