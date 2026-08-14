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
};
