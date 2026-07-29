import { createAdapter } from '@socket.io/redis-adapter';
import { Server as SocketIoServer } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import type { ClientKeServer, DataSocket, ServerKeClient } from '../../shared/kontrak.js';
import { log } from '../log.js';
import { redisPub, redisSub } from '../redis/client.js';
import { daftarkanPapan } from './papan.js';
import { daftarkanPeserta } from './peserta.js';
import { daftarkanPresenter } from './presenter.js';
import { mulaiBroadcaster } from './siaran.js';

export type IoServer = SocketIoServer<ClientKeServer, ServerKeClient, Record<string, never>, DataSocket>;

/**
 * Socket.IO dipasang dengan Redis adapter dari awal, sekalipun untuk sekarang
 * hanya berjalan 1 instance `app`. Ini keputusan sadar: menambah replica nanti
 * (mis. saat dipakai serentak satu sekolah) hanya perlu mengubah `docker-compose.yml`
 * — bukan menulis ulang lapisan realtime.
 */
export function buatIo(httpServer: HttpServer): IoServer {
  const io: IoServer = new SocketIoServer(httpServer, {
    // Tanpa opsi `cors` sama sekali: Vue disajikan dari origin yang sama dengan
    // API ini, jadi tidak perlu header CORS. Diamkan bawaan Engine.IO menolak
    // origin lain, alih-alih mengonfigurasi CORS lalu melonggarkannya nanti.
    adapter: createAdapter(redisPub(), redisSub()),
  });

  io.on('connection', (socket) => {
    log.debug({ socketId: socket.id }, 'Socket terhubung');

    daftarkanPeserta(io, socket);
    daftarkanPresenter(io, socket);
    daftarkanPapan(io, socket);

    socket.on('disconnect', (alasan) => {
      log.debug({ socketId: socket.id, alasan }, 'Socket terputus');
    });
  });

  mulaiBroadcaster(io);

  log.info('Socket.IO siap (Redis adapter aktif)');
  return io;
}
