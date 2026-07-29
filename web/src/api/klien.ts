import type { GalatKirim } from '@bersama/tipe';

/** Dilempar oleh `panggil()` supaya komponen bisa menampilkan pesan yang konsisten. */
export class GalatApi extends Error {
  readonly kode: string;
  constructor(galat: GalatKirim) {
    super(galat.pesan);
    this.name = 'GalatApi';
    this.kode = galat.kode;
  }
}

/**
 * Pembungkus fetch tipis. Semua endpoint backend mengembalikan bentuk yang sama
 * (`{ galat: GalatKirim }` saat gagal), jadi penanganannya disatukan di sini —
 * komponen tidak perlu mengulang try/catch parsing response di banyak tempat.
 */
export async function panggil<T>(
  jalur: string,
  opsi: RequestInit = {},
): Promise<T> {
  let respons: Response;
  try {
    respons = await fetch(jalur, {
      credentials: 'include',
      // Header `Content-Type: application/json` HANYA dipasang kalau memang
      // ada body yang dikirim. Fastify menolak (400 FST_ERR_CTP_EMPTY_JSON_BODY)
      // kombinasi content-type JSON dengan body kosong — kena tiap aksi tanpa
      // payload seperti "mulai sesi", "keluar", atau semua DELETE (hapus slide/
      // papan/kolom/kartu). Dipasang di sini, satu tempat, bukan di tiap call site.
      headers: { ...(opsi.body ? { 'Content-Type': 'application/json' } : {}), ...opsi.headers },
      ...opsi,
    });
  } catch {
    throw new GalatApi({ kode: 'JARINGAN', pesan: 'Tidak bisa menghubungi server. Periksa koneksi Anda.' });
  }

  const isJson = respons.headers.get('content-type')?.includes('application/json');
  const badan = isJson ? await respons.json().catch(() => null) : null;

  if (!respons.ok) {
    const galat: GalatKirim = badan?.galat ?? { kode: 'GALAT_SERVER', pesan: `Permintaan gagal (${respons.status}).` };
    throw new GalatApi(galat);
  }

  return badan as T;
}

export const api = {
  get: <T>(jalur: string) => panggil<T>(jalur),
  post: <T>(jalur: string, data?: unknown) =>
    panggil<T>(jalur, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
};
