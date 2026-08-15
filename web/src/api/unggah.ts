import { GalatApi } from './klien.js';

export const apiUnggah = {
  /** `konteks` (opsional) dipakai server untuk menyusun folder S3 —
   *  `presentasiId` + `slideId` kalau ada, supaya gambar pertanyaan/
   *  pin_jawaban terkumpul rapi per presentasi & slide, bukan rata di root
   *  bucket. Slide `pin_jawaban` baru belum punya id saat gambarnya
   *  diunggah — cukup kirim `presentasiId` saja untuk kasus itu. */
  async gambar(berkas: File, konteks?: { presentasiId?: number; slideId?: number }): Promise<{ path: string }> {
    const form = new FormData();
    form.append('berkas', berkas);

    const q = new URLSearchParams();
    if (konteks?.presentasiId) q.set('presentasiId', String(konteks.presentasiId));
    if (konteks?.slideId) q.set('slideId', String(konteks.slideId));
    const qs = q.toString();

    const r = await fetch(`/api/unggah/gambar${qs ? `?${qs}` : ''}`, { method: 'POST', body: form, credentials: 'include' });
    const badan = await r.json().catch(() => null);
    if (!r.ok) {
      throw new GalatApi(badan?.galat ?? { kode: 'GALAT_SERVER', pesan: 'Gagal mengunggah gambar.' });
    }
    return badan as { path: string };
  },

  /** Sama seperti `gambar()`, tapi lewat rute publik (tanpa login guru) untuk
   *  lampiran kartu papan — `token` didapat dari `papan:masuk` via socket.
   *  `kolomId` (opsional, kolom tujuan kartu) dipakai server untuk menyusun
   *  folder S3 `papan/{id}/kolom/{id}` supaya lampiran per kolom terkumpul rapi. */
  async gambarPapan(kode: string, token: string, berkas: File, kolomId?: number | null): Promise<{ path: string }> {
    const form = new FormData();
    form.append('berkas', berkas);

    const q = new URLSearchParams({ token });
    if (kolomId != null) q.set('kolomId', String(kolomId));

    const r = await fetch(`/api/papan/${encodeURIComponent(kode)}/unggah?${q.toString()}`, {
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

  /** Jelajahi galeri "Manajemen Gambar" (admin-only) — drill-down folder
   *  guru → folder papan/presentasi → gambar sesungguhnya. `path` kosong =
   *  root (daftar folder guru); isi dengan `path` sebuah folder (dari hasil
   *  panggilan sebelumnya) untuk masuk ke level berikutnya. Server yang
   *  menentukan apakah hasilnya masih berupa folder atau sudah gambar. */
  async jelajah(
    path: string = '',
    limit: number = 50,
    offset: number = 0,
  ): Promise<
    | { tipe: 'folder'; folder: Array<{ label: string; path: string; jenis: 'guru' | 'papan' | 'presentasi' }> }
    | {
        tipe: 'gambar';
        gambar: Array<{ nama: string; path: string; ukuranByte: number; tanggal: string; tipe: 'lokal' | 's3' }>;
        total: number;
        pemakaian: { byte: number; mb: number };
      }
  > {
    const q = new URLSearchParams({ path, limit: String(limit), offset: String(offset) });
    const r = await fetch(`/api/unggah/daftar?${q.toString()}`, {
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
