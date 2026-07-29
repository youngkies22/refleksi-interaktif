import type { PengaturanAplikasi } from '@bersama/tipe';
import { api } from './klien.js';

export const apiPengaturan = {
  ambil: () => api.get<{ pengaturan: PengaturanAplikasi }>('/api/pengaturan'),
};
