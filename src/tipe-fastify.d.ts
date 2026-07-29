import 'fastify';
import type { IoServer } from './realtime/index.js';

/** Perluas tipe session Fastify supaya `request.session.guruId` dikenal compiler. */
declare module 'fastify' {
  interface Session {
    guruId?: number;
  }

  interface FastifyInstance {
    io: IoServer;
  }
}
