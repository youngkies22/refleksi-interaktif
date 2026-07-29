import { EventEmitter } from 'node:events';
import type { Redis } from 'ioredis';
import type { Session } from 'fastify';
import { log } from '../log.js';

type CallbackSesi = (galat: unknown, sesi?: Session | null) => void;
type CallbackKosong = (galat?: unknown) => void;

/**
 * Store session Fastify yang disokong Redis, ditulis sendiri (bukan `connect-redis`).
 *
 * Alasan menulis sendiri: `connect-redis` dirancang untuk client `node-redis` v4
 * (signature `.set(key, val, { EX })`), sedangkan seluruh aplikasi ini memakai
 * `ioredis` (signature `.set(key, val, 'EX', detik)`). Memaksakan keduanya adalah
 * jenis bug yang baru ketahuan saat sesi guru tiba-tiba tidak tersimpan — untuk
 * ~30 baris kode, lebih aman menulis store sendiri yang cocok dengan client yang
 * benar-benar dipakai.
 *
 * Kenapa session Redis (bukan cookie biasa atau in-memory)? Karena guru bisa saja
 * mem-restart container `app` di tengah mengajar — sesi login tidak boleh hilang
 * hanya karena proses Node yang menyimpannya di memori ikut mati.
 */
export class TokoSesiRedis extends EventEmitter {
  private readonly redis: Redis;
  private readonly prefiks: string;
  private readonly ttlDetik: number;

  constructor(redis: Redis, opsi: { prefiks?: string; ttlJam: number }) {
    super();
    this.redis = redis;
    this.prefiks = opsi.prefiks ?? 'rfl:sesi-guru:';
    this.ttlDetik = Math.round(opsi.ttlJam * 3600);
  }

  private kunci(sid: string): string {
    return `${this.prefiks}${sid}`;
  }

  get(sid: string, selesai: CallbackSesi): void {
    this.redis
      .get(this.kunci(sid))
      .then((mentah) => selesai(null, mentah ? (JSON.parse(mentah) as Session) : null))
      .catch((e: unknown) => {
        log.error({ err: e, sid }, 'Gagal membaca session dari Redis');
        selesai(e);
      });
  }

  set(sid: string, sesi: Session, selesai?: CallbackKosong): void {
    this.redis
      .set(this.kunci(sid), JSON.stringify(sesi), 'EX', this.ttlDetik)
      .then(() => selesai?.())
      .catch((e: unknown) => {
        log.error({ err: e, sid }, 'Gagal menyimpan session ke Redis');
        selesai?.(e);
      });
  }

  destroy(sid: string, selesai?: CallbackKosong): void {
    this.redis
      .del(this.kunci(sid))
      .then(() => selesai?.())
      .catch((e: unknown) => selesai?.(e));
  }

  touch(sid: string, _sesi: Session, selesai?: CallbackKosong): void {
    this.redis
      .expire(this.kunci(sid), this.ttlDetik)
      .then(() => selesai?.())
      .catch((e: unknown) => selesai?.(e));
  }
}
