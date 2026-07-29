import { config } from './config.js';

/**
 * Log terstruktur ringkas.
 *
 * Fastify sudah membawa pino; ini dipakai untuk kode di luar siklus request
 * (bootstrap, migrasi, backup, handler socket) supaya formatnya tetap seragam
 * dan tidak ada `console.log` liar yang sulit disaring di `docker compose logs`.
 */

const TINGKAT = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Tingkat = keyof typeof TINGKAT;

const ambang = TINGKAT[(config.logLevel as Tingkat) in TINGKAT ? (config.logLevel as Tingkat) : 'info'];

function serialkan(nilai: unknown): unknown {
  if (nilai instanceof Error) {
    return { pesan: nilai.message, nama: nilai.name, stack: nilai.stack };
  }
  return nilai;
}

function tulis(tingkat: Tingkat, konteks: unknown, pesan: string): void {
  if (TINGKAT[tingkat] < ambang) return;

  const waktu = new Date().toISOString();

  if (config.produksi) {
    const baris: Record<string, unknown> = { waktu, tingkat, pesan };
    if (konteks && typeof konteks === 'object') {
      for (const [k, v] of Object.entries(konteks as Record<string, unknown>)) {
        baris[k] = serialkan(v);
      }
    }
    process.stdout.write(`${JSON.stringify(baris)}\n`);
    return;
  }

  // Mode pengembangan: satu baris yang enak dibaca manusia.
  const label = tingkat.toUpperCase().padEnd(5);
  const ekor =
    konteks && typeof konteks === 'object' && Object.keys(konteks).length > 0
      ? ` ${JSON.stringify(konteks, (_k, v) => serialkan(v))}`
      : '';
  process.stdout.write(`${waktu} ${label} ${pesan}${ekor}\n`);
}

type Konteks = Record<string, unknown>;

export const log = {
  debug: (konteks: Konteks | string, pesan?: string) => panggil('debug', konteks, pesan),
  info: (konteks: Konteks | string, pesan?: string) => panggil('info', konteks, pesan),
  warn: (konteks: Konteks | string, pesan?: string) => panggil('warn', konteks, pesan),
  error: (konteks: Konteks | string, pesan?: string) => panggil('error', konteks, pesan),
};

/** Mengizinkan dua gaya: log.info('pesan') atau log.info({ id }, 'pesan'). */
function panggil(tingkat: Tingkat, konteks: Konteks | string, pesan?: string): void {
  if (typeof konteks === 'string') tulis(tingkat, undefined, konteks);
  else tulis(tingkat, konteks, pesan ?? '');
}
