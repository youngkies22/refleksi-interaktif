import type { TipeSlide } from '@bersama/tipe';

export interface MetaTipe {
  label: string;
  ikon: string;
  keluarga: 'menti' | 'kahoot';
  butuhOpsi: boolean;
  opsiTetap?: boolean;
  keterangan: string;
}

/**
 * Metadata tampilan untuk tiap tipe slide — label & ikon Indonesia, dipakai
 * editor (Fase 2) dan nanti dipakai lagi sebagai kunci pemilihan komponen
 * render presenter/peserta di Fase 4/5.
 */
export const META_TIPE: Record<TipeSlide, MetaTipe> = {
  wordcloud: {
    label: 'Word Cloud',
    ikon: '☁️',
    keluarga: 'menti',
    butuhOpsi: false,
    keterangan: 'Peserta kirim 1–3 kata, tampil sebagai awan kata.',
  },
  pilihan_ganda: {
    label: 'Pilihan Ganda',
    ikon: '📊',
    keluarga: 'menti',
    butuhOpsi: true,
    keterangan: 'Peserta memilih satu opsi, hasil tampil sebagai bar chart.',
  },
  open_ended: {
    label: 'Jawaban Terbuka',
    ikon: '💬',
    keluarga: 'menti',
    butuhOpsi: false,
    keterangan: 'Peserta menulis jawaban bebas, tampil sebagai kartu.',
  },
  skala: {
    label: 'Skala',
    ikon: '📏',
    keluarga: 'menti',
    butuhOpsi: false,
    keterangan: 'Peserta memilih angka pada skala, tampil sebagai distribusi.',
  },
  peringkat: {
    label: 'Peringkat',
    ikon: '🔀',
    keluarga: 'menti',
    butuhOpsi: true,
    keterangan: 'Peserta mengurutkan opsi sesuai selera — tanpa jawaban benar.',
  },
  kuis: {
    label: 'Kuis Pilihan Ganda',
    ikon: '🏆',
    keluarga: 'kahoot',
    butuhOpsi: true,
    keterangan: 'Berpoin & bertimer. Tandai salah satu opsi sebagai jawaban benar.',
  },
  benar_salah: {
    label: 'Benar / Salah',
    ikon: '✅',
    keluarga: 'kahoot',
    butuhOpsi: true,
    opsiTetap: true,
    keterangan: 'Berpoin & bertimer, dua tombol tetap: Benar dan Salah.',
  },
  ketik_jawaban: {
    label: 'Ketik Jawaban',
    ikon: '⌨️',
    keluarga: 'kahoot',
    butuhOpsi: false,
    keterangan: 'Peserta mengetik jawaban. Salah ketik ringan tetap ditoleransi.',
  },
  puzzle: {
    label: 'Puzzle Urutan',
    ikon: '🧩',
    keluarga: 'kahoot',
    butuhOpsi: true,
    keterangan: 'Peserta menyusun opsi ke urutan yang benar. Urutan opsi di sini = kunci jawaban.',
  },
  pin_jawaban: {
    label: 'Pin di Gambar',
    ikon: '📍',
    keluarga: 'kahoot',
    butuhOpsi: false,
    keterangan: 'Peserta tap satu titik di gambar. Berpoin & bertimer seperti kuis.',
  },
};

export const DAFTAR_TIPE = Object.keys(META_TIPE) as TipeSlide[];
