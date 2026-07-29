import { api } from './klien.js';

export const apiSesi = {
  mulai: (presentasiId: number) =>
    api.post<{ sesiId: number; kode: string }>(`/api/presentasi/${presentasiId}/mulai-sesi`),

  olehKode: (kode: string) =>
    api.get<{ sesiId: number; presentasiId: number }>(`/api/sesi/oleh-kode/${kode}`),
};
