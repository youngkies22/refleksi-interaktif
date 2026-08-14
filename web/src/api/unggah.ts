import { GalatApi } from './klien.js';

export const apiUnggah = {
  async gambar(berkas: File): Promise<{ path: string }> {
    const form = new FormData();
    form.append('berkas', berkas);

    const r = await fetch('/api/unggah/gambar', { method: 'POST', body: form, credentials: 'include' });
    const badan = await r.json().catch(() => null);
    if (!r.ok) {
      throw new GalatApi(badan?.galat ?? { kode: 'GALAT_SERVER', pesan: 'Gagal mengunggah gambar.' });
    }
    return badan as { path: string };
  },

  /** Sama seperti `gambar()`, tapi lewat rute publik (tanpa login guru) untuk
   *  lampiran kartu papan — `token` didapat dari `papan:masuk` via socket. */
  async gambarPapan(kode: string, token: string, berkas: File): Promise<{ path: string }> {
    const form = new FormData();
    form.append('berkas', berkas);

    const r = await fetch(`/api/papan/${encodeURIComponent(kode)}/unggah?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      body: form,
      credentials: 'include',
    });
    const badan = await r.json().catch(() => null);
    if (!r.ok) {
      throw new GalatApi(badan?.galat ?? { kode: 'GALAT_SERVER', pesan: 'Gagal mengunggah gambar.' });
    }
    return badan as { path: string };
  },

  /** Hapus gambar — dipanggil saat gambar dihapus dari slide atau kartu.
   *  Path bisa berupa URL dari S3 atau path lokal (/unggahan/...).
   *  Server akan auto-detect dan hapus dari S3 atau disk sesuai kebutuhan. */
  async hapusGambar(path: string): Promise<void> {
    const r = await fetch('/api/unggah/gambar', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
      credentials: 'include',
    });
    if (!r.ok) {
      const badan = await r.json().catch(() => null);
      throw new GalatApi(badan?.galat ?? { kode: 'GALAT_SERVER', pesan: 'Gagal menghapus gambar.' });
    }
  },

  /** Daftar gambar yang diunggah (dari S3 atau disk) dengan pagination */
  async daftarGambar(limit: number = 50, offset: number = 0): Promise<{
    gambar: Array<{ nama: string; path: string; ukuranByte: number; tanggal: string; tipe: 'lokal' | 's3' }>;
    total: number;
    pemakaian: { byte: number; mb: number };
  }> {
    const r = await fetch(`/api/unggah/daftar?limit=${limit}&offset=${offset}`, {
      method: 'GET',
      credentials: 'include',
    });
    const badan = await r.json().catch(() => null);
    if (!r.ok) {
      throw new GalatApi(badan?.galat ?? { kode: 'GALAT_SERVER', pesan: 'Gagal memuat daftar gambar.' });
    }
    return badan;
  },
};
