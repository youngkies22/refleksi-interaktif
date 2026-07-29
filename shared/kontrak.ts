/**
 * Kontrak event Socket.IO — ditulis SEKALI, dipakai server dan Vue.
 *
 * Ini alasan utama project memakai TypeScript. Kalau server mengubah nama field
 * sementara Vue tidak, tidak akan ada error apa pun saat runtime — datanya cuma
 * jadi `undefined` diam-diam, dan tidak ada test yang natural menangkapnya.
 * Dengan kontrak ini, ketidakcocokan itu jadi galat compile.
 *
 * Pemakaian:
 *   server : new Server<ClientKeServer, ServerKeClient>(httpServer)
 *   klien  : io() as Socket<ServerKeClient, ClientKeServer>
 *   (perhatikan urutan generic-nya memang terbalik — itu API Socket.IO.)
 */

import type {
  AgregatSlide,
  BarisPeringkat,
  GalatKirim,
  JawabanPayload,
  Kartu,
  Kolom,
  Komentar,
  KondisiSesi,
  Opsi,
  Papan,
} from './tipe.js';

/** Balasan seragam untuk event yang memakai acknowledgement. */
export type Balasan<T> = { ok: true; data: T } | { ok: false; galat: GalatKirim };

/* ───────────────────── Klien → Server ───────────────────── */

export interface ClientKeServer {
  /* Peserta sesi live */
  'peserta:join': (
    d: { kode: string; nama: string; token?: string },
    ack: (b: Balasan<{ token: string; pesertaId: number; kondisi: KondisiSesi }>) => void,
  ) => void;

  'peserta:jawab': (
    d: { slideId: number; payload: JawabanPayload },
    ack: (b: Balasan<{ diterima: true }>) => void,
  ) => void;

  /** Menyegarkan penanda "masih online". Tidak butuh balasan. */
  'peserta:ping': () => void;

  /* Guru / layar proyektor */
  'presenter:buka': (
    d: { sesiId: number },
    ack: (b: Balasan<{ kondisi: KondisiSesi }>) => void,
  ) => void;
  'presenter:slide': (d: { slideId: number }, ack: (b: Balasan<null>) => void) => void;
  /** `dibuka`: status BARU yang diinginkan (true = terima jawaban, false = kunci & pantas untuk reveal). */
  'presenter:kunci': (
    d: { slideId: number; dibuka: boolean },
    ack: (b: Balasan<null>) => void,
  ) => void;
  'presenter:sembunyikan': (d: { jawabanId: number }, ack: (b: Balasan<null>) => void) => void;
  'presenter:reset': (d: { slideId: number }, ack: (b: Balasan<null>) => void) => void;
  'presenter:selesai': (ack: (b: Balasan<null>) => void) => void;

  /* Papan kolaboratif */
  'papan:masuk': (
    d: { kode: string; nama?: string; token?: string },
    ack: (b: Balasan<{ token: string; papan: Papan; kolom: Kolom[]; kartu: Kartu[] }>) => void,
  ) => void;
  'papan:kartu_baru': (
    d: { kolomId: number | null; judul: string; isi: string; warna: string; lampiranPath?: string },
    ack: (b: Balasan<{ kartu: Kartu }>) => void,
  ) => void;
  'papan:kartu_ubah': (
    d: { kartuId: number; judul?: string; isi?: string; warna?: string },
    ack: (b: Balasan<null>) => void,
  ) => void;
  'papan:kartu_pindah': (
    d: { kartuId: number; kolomId: number | null; urutan: number },
    ack: (b: Balasan<null>) => void,
  ) => void;
  'papan:kartu_hapus': (d: { kartuId: number }, ack: (b: Balasan<null>) => void) => void;
  'papan:like': (d: { kartuId: number }, ack: (b: Balasan<{ jumlah: number }>) => void) => void;
  'papan:komentar': (
    d: { kartuId: number; isi: string },
    ack: (b: Balasan<null>) => void,
  ) => void;
  'papan:setujui': (d: { kartuId: number }, ack: (b: Balasan<null>) => void) => void;

  /** Guru membuka layar lobby papan — bergabung ke room khusus guru untuk
   *  menerima hitungan peserta real-time (lihat `papan:peserta_jumlah`). */
  'papan:guru_masuk': (
    d: { papanId: number },
    ack: (b: Balasan<{ online: number; daftar: { nama: string }[] }>) => void,
  ) => void;
}

/* ───────────────────── Server → Klien ───────────────────── */

export interface ServerKeClient {
  /* Sesi live */
  'sesi:kondisi': (d: KondisiSesi) => void;

  /** Dikirim ter-coalesce, maksimal 4×/detik per slide. */
  'agg:update': (d: { slideId: number; agregat: AgregatSlide }) => void;

  /** `daftar` hanya dikirim ke room presenter (lihat realtime/peserta.ts) —
   *  dipakai menampilkan nama peserta yang sudah join di layar lobby. */
  'peserta:jumlah': (d: { online: number; total: number; daftar?: { nama: string }[] }) => void;

  /**
   * Dikirim setelah timer habis. Baru DI SINILAH `benar` pada opsi terisi —
   * sebelum ini opsi dikirim tanpa penanda jawaban benar supaya tidak bocor
   * lewat payload socket (bisa dilihat siapa pun di DevTools).
   */
  'kuis:hasil': (d: {
    slideId: number;
    opsi: Opsi[];
    /** khusus pin_jawaban / puzzle: bentuk jawaban benar untuk digambar di layar */
    kunciTambahan?: unknown;
    /** khusus kuis / benar_salah: opsiId → jumlah pemilih, untuk bar sebaran
     *  jawaban saat reveal. Tidak pernah dikirim selagi timer masih berjalan. */
    sebaran?: Record<string, number>;
  }) => void;

  /** Umpan balik pribadi ke satu peserta, bukan siaran. */
  'kuis:umpan_balik': (d: {
    slideId: number;
    benar: boolean;
    ketepatan: number;
    poin: number;
    skorTotal: number;
    peringkat: number;
  }) => void;

  'kuis:leaderboard': (d: { slideId: number; top: BarisPeringkat[] }) => void;
  'kuis:podium': (d: { top: BarisPeringkat[] }) => void;

  /** Guru menghapus semua jawaban satu slide & membukanya lagi dari nol. */
  'sesi:reset': (d: { slideId: number }) => void;

  'sesi:selesai': (d: { sesiId: number }) => void;

  /* Papan kolaboratif */
  'papan:kartu': (d: { kartu: Kartu }) => void;
  'papan:kartu_update': (d: { kartu: Kartu }) => void;
  'papan:kartu_hapus': (d: { kartuId: number }) => void;
  'papan:like': (d: { kartuId: number; jumlah: number }) => void;
  'papan:komentar': (d: { kartuId: number; komentar: Komentar }) => void;
  'papan:menunggu': (d: { jumlah: number }) => void;
  /** Hanya dikirim ke room guru (`papan:guru_masuk`) — dipakai layar lobby
   *  `AturPapan.vue`, sama seperti `peserta:jumlah` di sesi live. */
  'papan:peserta_jumlah': (d: { online: number; daftar: { nama: string }[] }) => void;

  /* Umum */
  kesalahan: (d: GalatKirim) => void;
}

/* ────────────── Data yang menempel di tiap socket (sisi server) ────────────── */

export interface DataSocket {
  /** terisi untuk peserta anonim */
  token?: string;
  pesertaId?: number;
  sesiId?: number;
  papanId?: number;
  /** diisi sekali saat `papan:masuk`, dipakai ulang tiap kartu/komentar baru
   *  dari socket ini — supaya peserta tidak perlu mengetik nama berulang. */
  papanNama?: string;
  /** terisi kalau socket ini milik guru yang sudah login */
  guruId?: number;
}
