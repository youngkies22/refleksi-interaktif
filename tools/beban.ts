/**
 * Uji beban: N peserta join sesi lalu submit jawaban SEREMPAK, mengukur:
 *   - throughput broadcast agregat (harus ter-coalesce ≤4x/detik, bukan 1:1)
 *   - tidak ada jawaban yang hilang (jumlah baris `jawaban` = jumlah submit)
 *   - konsumsi RAM container `app` saat beban puncak
 *
 * Skrip ini membuat presentasi & sesi UJI SENDIRI (bukan menerima --kode dari
 * sesi yang sudah ada) — lebih mudah diulang tanpa siapan manual, dan hasilnya
 * selalu bisa dibandingkan apple-to-apple antar run.
 *
 * Pakai:  npm run beban -- --peserta 300
 */
import { execSync } from 'node:child_process';
import { io, type Socket } from 'socket.io-client';

const BASE = process.env.REFLEKSI_URL ?? 'http://localhost:8080';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const argJumlah = process.argv.find((a) => a.startsWith('--peserta='));
const JUMLAH_PESERTA = argJumlah ? Number(argJumlah.split('=')[1]) : 300;

function log(label: string, ...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log(`[${label}]`, ...args);
}

async function loginGuru(): Promise<string> {
  if (!ADMIN_PASSWORD) {
    throw new Error(
      'Set env ADMIN_PASSWORD dulu (lihat password admin di `docker compose logs app`).\n' +
        'Contoh: ADMIN_PASSWORD=xxxx npm run beban -- --peserta=300',
    );
  }
  const r = await fetch(`${BASE}/api/auth/masuk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
  });
  const cookie = r.headers.get('set-cookie');
  if (!r.ok || !cookie) throw new Error('Login guru gagal — cek ADMIN_USERNAME/ADMIN_PASSWORD.');
  return cookie.split(';')[0]!;
}

function tunggu<T = unknown>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve as (d: T) => void));
}

interface Balasan<T> {
  ok: boolean;
  data?: T;
  galat?: { kode: string; pesan: string };
}
function emitAck<T>(socket: Socket, event: string, data?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const cb = (b: Balasan<T>) => (b.ok ? resolve(b.data as T) : reject(new Error(b.galat?.pesan)));
    if (data === undefined) socket.emit(event, cb);
    else socket.emit(event, data, cb);
  });
}

function ramContainer(): string {
  try {
    return execSync('docker stats --no-stream --format "{{.MemUsage}}" refleksi-app-1', {
      encoding: 'utf8',
    }).trim();
  } catch {
    return '(tidak bisa membaca — jalankan di host yang punya akses docker)';
  }
}

async function main(): Promise<void> {
  log('setup', `Menyiapkan sesi uji untuk ${JUMLAH_PESERTA} peserta...`);
  const cookie = await loginGuru();

  const rBuat = await fetch(`${BASE}/api/presentasi`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ judul: `Uji Beban ${new Date().toISOString()}` }),
  });
  const { id: presentasiId } = (await rBuat.json()) as { id: number };

  const rSlide = await fetch(`${BASE}/api/presentasi/${presentasiId}/slide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ tipe: 'pilihan_ganda' }),
  });
  const { id: slideId } = (await rSlide.json()) as { id: number };
  await fetch(`${BASE}/api/slide/${slideId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      pertanyaan: 'Uji beban',
      opsi: [{ teks: 'A' }, { teks: 'B' }, { teks: 'C' }, { teks: 'D' }],
    }),
  });
  const detail = (await (
    await fetch(`${BASE}/api/presentasi/${presentasiId}`, { headers: { Cookie: cookie } })
  ).json()) as { presentasi: { slide: { opsi: { id: number }[] }[] } };
  const idOpsi = detail.presentasi.slide[0]!.opsi.map((o) => o.id);

  const rMulai = await fetch(`${BASE}/api/presentasi/${presentasiId}/mulai-sesi`, {
    method: 'POST',
    headers: { Cookie: cookie },
  });
  const { sesiId, kode } = (await rMulai.json()) as { sesiId: number; kode: string };
  log('setup', `Sesi ${kode} siap (sesiId=${sesiId}, slideId=${slideId})`);

  const socketGuru = io(BASE, { extraHeaders: { Cookie: cookie }, transports: ['websocket'] });
  await tunggu(socketGuru, 'connect');
  await emitAck(socketGuru, 'presenter:buka', { sesiId });

  let jumlahBroadcast = 0;
  socketGuru.on('agg:update', () => jumlahBroadcast++);

  log('join', `Menyambungkan ${JUMLAH_PESERTA} peserta...`);
  const tJoinMulai = Date.now();
  const peserta = await Promise.all(
    Array.from({ length: JUMLAH_PESERTA }, async (_v, i) => {
      const s = io(BASE, { transports: ['websocket'] });
      await tunggu(s, 'connect');
      await emitAck(s, 'peserta:join', { kode, nama: `Uji-${i}` });
      return s;
    }),
  );
  log('join', `${JUMLAH_PESERTA} peserta tersambung dalam ${Date.now() - tJoinMulai}ms`);

  log('ram', 'Sebelum submit serempak:', ramContainer());

  log('submit', `Mengirim ${JUMLAH_PESERTA} jawaban SEREMPAK (Promise.all, tanpa jeda)...`);
  const tSubmitMulai = Date.now();
  let gagal = 0;
  await Promise.all(
    peserta.map((s, i) =>
      emitAck(s, 'peserta:jawab', {
        slideId,
        payload: { tipe: 'pilihan_ganda', opsiId: idOpsi[i % idOpsi.length] },
      }).catch(() => gagal++),
    ),
  );
  const durasiSubmitMs = Date.now() - tSubmitMulai;
  log('submit', `Selesai dalam ${durasiSubmitMs}ms (${gagal} ditolak rate-limit/lainnya)`);

  // Beri waktu sedikit untuk broadcast ter-coalesce terakhir sampai ke presenter.
  await new Promise((r) => setTimeout(r, 500));
  log('ram', 'Setelah submit serempak:', ramContainer());

  const perkiraanBroadcastMaks = Math.ceil(durasiSubmitMs / 250) + 4; // +buffer siklus ekor
  log(
    'broadcast',
    `Presenter menerima ${jumlahBroadcast} 'agg:update' selama ${durasiSubmitMs}ms ` +
      `(batas wajar dgn coalescing 250ms: ~${perkiraanBroadcastMaks}, TANPA coalescing akan setara ${JUMLAH_PESERTA})`,
  );

  await emitAck(socketGuru, 'presenter:selesai');
  const rHasil = await fetch(`${BASE}/api/sesi/${sesiId}/hasil`, { headers: { Cookie: cookie } });
  const { hasil } = (await rHasil.json()) as { hasil: { slide: { jumlahJawaban: number }[] } };
  const tersimpan = hasil.slide[0]!.jumlahJawaban;
  const seharusnya = JUMLAH_PESERTA - gagal;

  console.log('\n========== HASIL UJI BEBAN ==========');
  console.log(`Peserta                 : ${JUMLAH_PESERTA}`);
  console.log(`Waktu submit serempak    : ${durasiSubmitMs}ms`);
  console.log(`Broadcast diterima       : ${jumlahBroadcast} (vs ${JUMLAH_PESERTA} tanpa coalescing)`);
  console.log(`Jawaban tersimpan di DB  : ${tersimpan} / ${seharusnya} seharusnya`);
  console.log(`RAM container            : ${ramContainer()}`);

  if (tersimpan !== seharusnya) {
    console.error(`\n❌ GAGAL: ${seharusnya - tersimpan} jawaban HILANG — tidak konsisten dengan jumlah submit.`);
    process.exitCode = 1;
  } else if (jumlahBroadcast > JUMLAH_PESERTA * 0.5) {
    console.error('\n⚠️  PERINGATAN: broadcast terlalu banyak — coalescing mungkin tidak bekerja semestinya.');
    process.exitCode = 1;
  } else {
    console.log('\n✅ LULUS: tidak ada jawaban hilang, dan broadcast ter-coalesce dengan baik.');
  }

  process.exit(process.exitCode ?? 0);
}

main().catch((e) => {
  console.error('Uji beban gagal dijalankan:', e);
  process.exit(1);
});
