import { defineStore } from 'pinia';
import { ref } from 'vue';
import { apiPengaturan } from '../api/pengaturan.js';

/**
 * Branding aplikasi (nama tab & logo header) — dimuat sekali di boot (lihat
 * main.ts) dan dipakai di mana pun header/judul tab perlu ditampilkan.
 *
 * Kegagalan memuat TIDAK boleh memblokir aplikasi: nilai bawaan "Refleksi"
 * di `state` sudah jadi fallback yang masuk akal kalau API ini kebetulan
 * gagal (mis. baru boot, database belum siap sama sekali — kasus langka
 * karena migrasi selalu jalan sebelum server menerima request).
 */
export const usePengaturanStore = defineStore('pengaturan', () => {
  const namaAplikasi = ref('Refleksi');
  const logoUrl = ref<string | null>(null);
  const dimuat = ref(false);

  function terapkanBranding(): void {
    document.title = `${namaAplikasi.value} — Media Interaktif Kelas`;
    const favicon = document.querySelector<HTMLLinkElement>('#favicon');
    if (favicon) favicon.href = logoUrl.value ?? '/favicon.svg';
  }

  async function muat(): Promise<void> {
    try {
      const r = await apiPengaturan.ambil();
      namaAplikasi.value = r.pengaturan.namaAplikasi;
      logoUrl.value = r.pengaturan.logoUrl;
    } catch {
      // biarkan nilai bawaan — jangan sampai kegagalan ini memblokir apa pun
    } finally {
      dimuat.value = true;
      terapkanBranding();
    }
  }

  /** Dipanggil setelah admin mengubah nama/logo, supaya seluruh UI (termasuk
   *  tab judul & ikon tab) langsung ikut berubah tanpa perlu reload halaman. */
  function terapkan(p: { namaAplikasi: string; logoUrl: string | null }): void {
    namaAplikasi.value = p.namaAplikasi;
    logoUrl.value = p.logoUrl;
    terapkanBranding();
  }

  return { namaAplikasi, logoUrl, dimuat, muat, terapkan };
});
