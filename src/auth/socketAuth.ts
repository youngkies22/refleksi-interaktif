import { Signer } from '@fastify/cookie';
import { parseCookie } from 'cookie';
import type { Socket } from 'socket.io';
import { config } from '../config.js';
import { log } from '../log.js';
import { redisUmum } from '../redis/client.js';
import { TokoSesiRedis } from './tokoSesiRedis.js';

/**
 * Kenali guru yang login dari cookie session di handshake Socket.IO.
 *
 * Socket.IO tidak lewat siklus request Fastify biasa, jadi `req.session` tidak
 * tersedia begitu saja untuk event `presenter:*`. Fungsi ini membaca ulang
 * cookie mentah dari header handshake, meng-unsign-nya dengan Signer yang
 * PERSIS sama seperti yang dipakai `@fastify/session` secara internal
 * (`new Signer(secret, 'sha256')` — diverifikasi terhadap kode sumber paketnya,
 * bukan ditebak), lalu mengambil data session dari store Redis yang sama.
 *
 * Nama cookie (`refleksi_sesi`) dan algoritma (`sha256`) HARUS selalu sinkron
 * dengan opsi yang didaftarkan di `fastifySession` pada server.ts.
 */

const NAMA_COOKIE_SESI = 'refleksi_sesi';
const penanda = new Signer(config.sessionSecret, 'sha256');
const toko = new TokoSesiRedis(redisUmum(), { ttlJam: config.sessionUmurJam });

export async function guruIdDariSocket(socket: Socket): Promise<number | null> {
  const headerMentah = socket.request.headers.cookie;
  if (!headerMentah) return null;

  let mentah: string | undefined;
  try {
    mentah = parseCookie(headerMentah)[NAMA_COOKIE_SESI];
  } catch (e) {
    log.warn({ err: e }, 'Gagal mem-parse cookie saat handshake socket');
    return null;
  }
  if (!mentah) return null;

  const hasil = penanda.unsign(mentah);
  if (!hasil.valid || !hasil.value) return null;

  return new Promise((resolve) => {
    toko.get(hasil.value as string, (err, sesi) => {
      if (err || !sesi) return resolve(null);
      const guruId = (sesi as { guruId?: number }).guruId;
      resolve(typeof guruId === 'number' ? guruId : null);
    });
  });
}
