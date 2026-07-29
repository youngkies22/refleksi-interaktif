import { api, panggil } from './klien.js';

export interface BarisLeaderboardRekap {
  nama: string;
  skor: number;
  peringkat: number;
}

export interface RingkasanSlideRekap {
  slideId: number;
  tipe: string;
  pertanyaan: string;
  jumlahJawaban: number;
  jumlahBenar: number | null;
}

export interface HasilSesi {
  judul: string;
  kode: string;
  status: string;
  mulaiAt: string | null;
  selesaiAt: string | null;
  jumlahPeserta: number;
  leaderboard: BarisLeaderboardRekap[];
  slide: RingkasanSlideRekap[];
}

export interface RingkasSesiRiwayat {
  sesiId: number;
  kode: string;
  status: string;
  mulaiAt: string | null;
  selesaiAt: string | null;
  jumlahPeserta: number;
  jumlahJawaban: number;
}

export const apiRekap = {
  hasil: (sesiId: number) => api.get<{ hasil: HasilSesi }>(`/api/sesi/${sesiId}/hasil`),
  urlCsv: (sesiId: number) => `/api/sesi/${sesiId}/hasil.csv`,

  riwayatSesi: (presentasiId: number) =>
    api.get<{ sesi: RingkasSesiRiwayat[] }>(`/api/presentasi/${presentasiId}/sesi`),

  resetSesi: (sesiId: number) => api.post<{ kode: string }>(`/api/sesi/${sesiId}/reset`),

  hapusSesi: (sesiId: number) => panggil<void>(`/api/sesi/${sesiId}`, { method: 'DELETE' }),
};
