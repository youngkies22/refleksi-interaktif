import type { ClientKeServer, ServerKeClient } from '@bersama/kontrak';
import { io, type Socket } from 'socket.io-client';

export type SocketRefleksi = Socket<ServerKeClient, ClientKeServer>;

/**
 * Satu instance socket dipakai bersama seluruh aplikasi (bukan satu per
 * komponen) — supaya pindah halaman di dalam SPA (mis. presenter → hasil)
 * tidak memutus koneksi yang sedang dipakai peserta lain untuk terus menerima
 * siaran. `withCredentials` mengirim cookie sesi guru saat handshake, dipakai
 * `guruIdDariSocket` di server untuk mengenali koneksi milik guru mana.
 */
let instance: SocketRefleksi | null = null;

export function useSocket(): SocketRefleksi {
  if (!instance) {
    instance = io({ withCredentials: true, autoConnect: true });
  }
  return instance;
}
