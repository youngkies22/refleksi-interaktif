import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySession from '@fastify/session';
import Fastify from 'fastify';
import { TokoSesiRedis } from './auth/tokoSesiRedis.js';
import { config } from './config.js';
import { backupSekarang, bukaDb, mulaiBackupBerkala, tutupDb } from './db/index.js';
import { seedAdmin, seedS3 } from './db/seed.js';
import { log } from './log.js';
import { buatIo, type IoServer } from './realtime/index.js';
import { redisUmum, tutupRedis } from './redis/client.js';
import { ruteAdmin } from './rute/api/admin.js';
import { ruteAuth } from './rute/api/auth.js';
import { ruteKartuPublik } from './rute/api/kartuPublik.js';
import { ruteKode } from './rute/api/kode.js';
import { rutePapan } from './rute/api/papan.js';
import { rutePengaturan } from './rute/api/pengaturan.js';
import { rutePresentasi } from './rute/api/presentasi.js';
import { ruteSesi } from './rute/api/sesi.js';
import { ruteUnggah } from './rute/api/unggah.js';
import { ruteKesehatan } from './rute/kesehatan.js';
import { ruteStatis } from './rute/statis.js';

/**
 * Titik masuk aplikasi.
 *
 * Urutan boot ini sengaja dibuat linear dan eksplisit (bukan tersebar di banyak
 * file "ajaib") supaya kalau container gagal start, log-nya menunjukkan PERSIS
 * langkah mana yang gagal — database, Redis, migrasi, atau listen port.
 */

process.on('uncaughtException', (e) => {
  log.error({ err: e }, 'GALAT TAK TERTANGANI — proses akan berhenti');
  process.exit(1);
});

process.on('unhandledRejection', (e) => {
  log.error({ err: e }, 'PROMISE DITOLAK TANPA DITANGANI — proses akan berhenti');
  process.exit(1);
});

async function tungguRedisSiap(percobaanMaks = 20): Promise<void> {
  const redis = redisUmum();
  for (let i = 1; i <= percobaanMaks; i++) {
    try {
      const pong = await redis.ping();
      if (pong === 'PONG') return;
    } catch {
      // lanjut mencoba
    }
    log.info({ percobaan: i, dariMaks: percobaanMaks }, 'Menunggu Redis...');
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Redis tidak siap setelah ${percobaanMaks} detik.`);
}

async function utama(): Promise<void> {
  log.info({ versiNode: process.version, lingkungan: config.lingkungan }, `${config.appNama} sedang memulai...`);

  // 1) Database — dibuka & dimigrasikan lebih dulu karena hampir semua rute bergantung padanya.
  bukaDb();
  seedAdmin();
  seedS3();
  mulaiBackupBerkala();

  // 2) Redis — ditunggu dengan retry supaya urutan `docker compose up` tidak jadi masalah.
  await tungguRedisSiap();

  // 3) Fastify
  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport: config.produksi ? undefined : { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
    },
    trustProxy: true,
  });

  await app.register(fastifyHelmet, {
    // Vue di-serve dari origin yang sama; CSP longgar sedikit di style-src untuk
    // Tailwind hasil build. Tidak perlu 'unsafe-inline' script — tidak ada inline script.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        // 'https:' (bukan cuma origin S3 tunggal) karena bucket-nya bisa diganti
        // admin kapan saja lewat panel (lihat layanan/pengaturan.ts) TANPA restart
        // server — daftar origin statis di sini akan langsung basi begitu itu
        // terjadi. Aman diperlonggar sejauh ini: setiap `src` gambar di aplikasi
        // SELALU nilai yang server sendiri hasilkan (hasil unggah), tidak pernah
        // URL bebas dari input pengguna, jadi tidak membuka jalur XSS/SSRF baru.
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        // Helmet menyalakan `upgrade-insecure-requests` secara bawaan. Di
        // belakang proxy yang menyajikan http://, direktif itu membuat browser
        // memaksa CSS/JS/favicon diambil lewat https — dan gagal semua dengan
        // ERR_CERT_COMMON_NAME_INVALID, halaman jadi tanpa gaya & tanpa skrip.
        // `null` menghapus direktif bawaan itu; hanya dipasang saat memang https.
        'upgrade-insecure-requests': config.pakaiHttps ? [] : null,
      },
    },
    // HSTS "lengket": sekali terkirim, browser memaksa https untuk domain itu
    // selama max-age walau servernya http — dan tidak bisa dibatalkan dari sisi
    // server begitu tersimpan. Jangan pernah dikirim kecuali https benar-benar aktif.
    hsts: config.pakaiHttps,
    // Kedua header di bawah hanya berlaku pada origin "trustworthy" (https /
    // localhost). Di http:// mereka cuma jadi peringatan merah di konsol tanpa
    // memberi perlindungan apa pun, jadi tidak usah dikirim.
    crossOriginOpenerPolicy: config.pakaiHttps,
    originAgentCluster: config.pakaiHttps,
  });

  await app.register(fastifyCookie);

  await app.register(fastifySession, {
    secret: config.sessionSecret,
    cookieName: 'refleksi_sesi',
    store: new TokoSesiRedis(redisUmum(), { ttlJam: config.sessionUmurJam }),
    cookie: {
      // 'auto' = ditentukan PER PERMINTAAN dari `request.protocol`, yang dengan
      // `trustProxy: true` ikut membaca X-Forwarded-Proto dari nginx.
      //
      // Sebelumnya `secure: config.produksi` (selalu true di production). Itu
      // membuat login MUSTAHIL saat diakses lewat http:// di belakang proxy —
      // browser menolak menyimpan cookie `Secure` pada koneksi non-https, tanpa
      // pesan galat apa pun; gejalanya "login berhasil tapi balik lagi ke form".
      // Dengan 'auto', http:// tetap bisa login dan begitu proxy dipasangi TLS
      // cookie-nya otomatis naik jadi Secure tanpa mengubah konfigurasi.
      secure: 'auto',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: config.sessionUmurJam * 3600 * 1000,
    },
  });

  await app.register(fastifyRateLimit, {
    global: false, // diaktifkan per-rute yang butuh (login, submit jawaban publik)
  });

  // Fastify melarang decorator baru ditambahkan setelah instance "started"
  // (app.ready()/app.listen()). Slot-nya disiapkan dulu di sini; nilai socket.io
  // yang sesungguhnya baru diisi belakangan lewat assignment biasa (bukan
  // decorate() lagi) — itu tetap diperbolehkan kapan saja.
  app.decorate('io', undefined as unknown as IoServer);

  // 4) Rute HTTP
  await app.register(ruteKesehatan);
  await app.register(ruteAuth);
  await app.register(ruteAdmin);
  await app.register(rutePengaturan);
  await app.register(rutePresentasi);
  await app.register(rutePapan);
  await app.register(ruteKartuPublik);
  await app.register(ruteKode);
  await app.register(ruteSesi);
  await app.register(ruteUnggah);
  await app.register(ruteStatis); // WAJIB terakhir — dia menangani fallback SPA

  // 5) Realtime — dipasang di HTTP server yang sama dengan Fastify, satu port saja.
  await app.ready();
  const io: IoServer = buatIo(app.server);
  app.io = io;

  // 6) Nyalakan
  await app.listen({ host: config.host, port: config.port });
  log.info({ host: config.host, port: config.port }, `${config.appNama} siap di :${config.port}`);

  // 7) Penutupan rapi — dipanggil oleh orkestrator Docker via SIGTERM saat rebuild/stop.
  let sedangMatikan = false;
  async function matikan(sinyal: string): Promise<void> {
    if (sedangMatikan) return;
    sedangMatikan = true;
    log.info({ sinyal }, 'Menerima sinyal berhenti, mematikan dengan rapi...');

    const batasWaktu = setTimeout(() => {
      log.error('Penutupan rapi melebihi batas waktu — paksa keluar');
      process.exit(1);
    }, 10_000);
    batasWaktu.unref();

    try {
      io.close();
      await app.close();
      await backupSekarang();
      tutupDb();
      await tutupRedis();
      log.info('Penutupan rapi selesai');
      process.exit(0);
    } catch (e) {
      log.error({ err: e }, 'Galat saat mematikan');
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => void matikan('SIGTERM'));
  process.on('SIGINT', () => void matikan('SIGINT'));
}

utama().catch((e) => {
  log.error({ err: e }, 'Gagal memulai aplikasi');
  process.exit(1);
});
