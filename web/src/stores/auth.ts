import type { Guru } from '@bersama/tipe';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api, GalatApi, panggil } from '../api/klien.js';

export interface DataUbahProfil {
  nama?: string;
  username?: string;
  passwordLama?: string;
  passwordBaru?: string;
}

export const useAuthStore = defineStore('auth', () => {
  const guru = ref<Guru | null>(null);
  /** null = belum dicek sama sekali (dipakai router guard membedakan dari "sudah dicek, tidak login") */
  const sudahDicek = ref(false);

  const sudahLogin = computed(() => guru.value !== null);

  async function cekSesi(): Promise<void> {
    try {
      const r = await api.get<{ guru: Guru }>('/api/auth/saya');
      guru.value = r.guru;
    } catch {
      guru.value = null;
    } finally {
      sudahDicek.value = true;
    }
  }

  async function masuk(username: string, password: string): Promise<void> {
    const r = await api.post<{ guru: Guru }>('/api/auth/masuk', { username, password });
    guru.value = r.guru;
    sudahDicek.value = true;
  }

  async function keluar(): Promise<void> {
    try {
      await api.post('/api/auth/keluar');
    } catch (e) {
      if (!(e instanceof GalatApi)) throw e;
    } finally {
      guru.value = null;
    }
  }

  async function ubahProfil(data: DataUbahProfil): Promise<void> {
    const r = await panggil<{ guru: Guru }>('/api/auth/saya', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    guru.value = r.guru;
  }

  return { guru, sudahLogin, sudahDicek, cekSesi, masuk, keluar, ubahProfil };
});
