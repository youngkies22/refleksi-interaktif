import { randomUUID } from 'node:crypto';
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { ListObjectsV2CommandOutput } from '@aws-sdk/client-s3';
import { DeleteObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { galatValidasi } from '../galat.js';
import { cariGuruById } from './auth.js';
import { ambilKonfigS3 } from './pengaturan.js';
import { opsiAclUpload, s3Klien, urlPublikS3 } from './s3Klien.js';
import { UNGGAH } from '../../shared/konstanta.js';

/**
 * Slug URL-safe dari nama guru — hanya huruf kecil, angka, tanda hubung.
 * Dipakai untuk `folderGuru()` supaya folder S3 langsung terbaca di
 * browser bucket manapun (NevaObjects, MinIO, dst) tanpa perlu buka
 * aplikasi ini. ID guru tetap didahulukan di `folderGuru()` (bukan slug
 * sendirian) supaya folder tetap valid & stabil walau nama guru diganti
 * atau dua guru kebetulan sama nama.
 */
function slugAman(teks: string): string {
  const bersih = teks
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // buang diakritik (é -> e, dst)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return bersih || 'guru';
}

/** Folder S3 milik seorang guru, mis. `guru/17-budi-santoso` — dipakai
 *  sebagai prefix unggahan presentasi & papan miliknya (lihat pemanggil di
 *  `rute/api/unggah.ts` & `rute/api/kartuPublik.ts`), dan diparse balik oleh
 *  `daftarFolderGuru()` untuk drill-down galeri admin. */
export function folderGuru(guruId: number, nama: string): string {
  return `guru/${guruId}-${slugAman(nama)}`;
}

/** Target ukuran hasil kompresi — batas unggah mentah (`UNGGAH.maksByte`)
 *  jauh lebih besar dari ini (lihat shared/konstanta.ts) karena foto
 *  langsung dari HP dengan mudah 10-30 MB; nilai di bawah ini yang menjaga
 *  bucket S3 tetap ramping berapa pun besar berkas aslinya. */
const TARGET_KOMPRESI_BYTE = 1024 * 1024;

/**
 * Kompres & batasi dimensi gambar sebelum disimpan — foto langsung dari HP
 * (sering puluhan MB) turun ke sekitar 1 MB tanpa beda kasat mata di layar
 * kelas. `fit: 'inside'` TIDAK PERNAH memotong/mengubah rasio gambar, hanya
 * mengecilkan — penting karena beberapa slide (`pin_jawaban`) menyimpan
 * koordinat area jawaban sebagai PERSENTASE (0..1) relatif terhadap gambar,
 * bukan piksel; kalau rasio berubah, titik jawaban lama jadi meleset.
 *
 * Satu kali resize+encode TIDAK menjamin hasilnya di bawah target — foto
 * yang sangat detail (mis. tulisan papan tulis penuh) bisa tetap besar
 * walau sudah di-resize ke 1920px. Jadi diulang dengan kualitas & dimensi
 * diturunkan bertahap SAMPAI di bawah `TARGET_KOMPRESI_BYTE`, atau sampai
 * batas bawah (kualitas 35, lebar 800px) supaya tidak diulang tanpa henti
 * demi ukuran yang mustahil dicapai tanpa merusak gambar total.
 *
 * GIF dilewati apa adanya (tidak di-decode ulang) supaya animasinya tidak
 * rusak — resize frame-per-frame di luar cakupan fitur ini.
 */
async function kompresGambar(buffer: Buffer, mime: string): Promise<{ buffer: Buffer; ext: string; mime: string }> {
  if (mime === 'image/gif') {
    return { buffer, ext: 'gif', mime };
  }

  let lebar = 1920;
  let kualitas = 80;
  let hasil: Buffer;

  for (;;) {
    hasil = await sharp(buffer)
      .rotate() // auto-orientasi dari EXIF SEBELUM EXIF-nya dibuang oleh re-encode
      .resize({ width: lebar, height: lebar, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: kualitas, effort: 4 })
      .toBuffer();

    const sudahDiBatasBawah = kualitas <= 35 && lebar <= 800;
    if (hasil.byteLength <= TARGET_KOMPRESI_BYTE || sudahDiBatasBawah) break;

    kualitas = Math.max(35, kualitas - 15);
    lebar = Math.max(800, Math.round(lebar * 0.8));
  }

  return { buffer: hasil, ext: 'webp', mime: 'image/webp' };
}

/**
 * Simpan gambar yang diunggah guru maupun peserta papan (dipakai slide
 * `pin_jawaban`, logo branding, dan lampiran kartu papan Padlet).
 *
 * Verifikasi tipe file lewat MAGIC BYTES (`file-type` membaca header biner
 * sesungguhnya), BUKAN dari ekstensi nama file atau `Content-Type` yang
 * diklaim klien — keduanya trivial dipalsukan. File disimpan dengan nama
 * ACAK di luar kontrol nama asli, supaya tidak ada cara memaksa ekstensi
 * berbahaya (mis. `.php`) lolos ke disk/bucket.
 *
 * `folder` (opsional) jadi prefix key/path — mis.
 * `guru/17-budi-santoso/presentasi/12/slide/45` atau
 * `guru/17-budi-santoso/papan/3/kolom/7` (lihat `folderGuru()`) — supaya
 * unggahan tiap guru & tiap fitur terkumpul rapi per konteksnya, bukan
 * numpuk rata sebagai UUID lepas di root bucket. Pemanggil WAJIB
 * membangunnya hanya dari segmen yang sudah diverifikasi aman (ID angka
 * positif atau literal tetap), tidak pernah dari input mentah pemakai —
 * fungsi ini tidak melakukan sanitasi lebih lanjut terhadap `folder`.
 *
 * Tujuan penyimpanan: object storage S3-compatible kalau diatur lewat panel
 * admin (lihat `layanan/pengaturan.ts` — `ambilKonfigS3()`), jatuh ke disk
 * lokal (`data/unggahan/`) kalau tidak — supaya instalasi yang belum pasang
 * object storage tetap jalan seperti sebelumnya.
 */
export async function simpanGambarUnggahan(buffer: Buffer, folder?: string): Promise<{ path: string }> {
  if (buffer.byteLength === 0) {
    throw galatValidasi('Berkas kosong.');
  }
  if (buffer.byteLength > UNGGAH.maksByte) {
    throw galatValidasi(`Ukuran gambar maksimal ${Math.round(UNGGAH.maksByte / 1024 / 1024)} MB.`);
  }

  const tipe = await fileTypeFromBuffer(buffer);
  if (!tipe || !(UNGGAH.mimeDiizinkan as readonly string[]).includes(tipe.mime)) {
    throw galatValidasi('Format gambar tidak didukung. Gunakan PNG, JPEG, WEBP, atau GIF.');
  }

  const dikompres = await kompresGambar(buffer, tipe.mime);
  const namaBerkas = folder ? `${folder}/${randomUUID()}.${dikompres.ext}` : `${randomUUID()}.${dikompres.ext}`;

  const s3 = ambilKonfigS3();
  if (s3.aktif) {
    await s3Klien(s3).send(
      new PutObjectCommand({
        Bucket: s3.bucket,
        Key: namaBerkas,
        Body: dikompres.buffer,
        ContentType: dikompres.mime,
        ...opsiAclUpload(s3.endpoint),
      }),
    );
    return { path: urlPublikS3(s3, namaBerkas) };
  }

  // Disk lokal tidak kenal "folder" S3 — buat direktorinya kalau perlu supaya
  // struktur foldernya tetap konsisten dengan mode S3.
  const tujuan = resolve(config.dirUnggahan, namaBerkas);
  if (folder) await mkdir(dirname(tujuan), { recursive: true });
  await writeFile(tujuan, dikompres.buffer);
  return { path: `/unggahan/${namaBerkas}` };
}

/**
 * Ekstrak key/path-relatif dari sebuah `path` unggahan — URL S3 publik
 * (`https://endpoint/bucket/key`, custom domain, atau R2) ATAU path lokal
 * (`/unggahan/...`). SATU tempat dipakai bersama oleh `hapusGambarUnggahan`
 * (tahu apa yang mau dihapus) dan `pathMilikGuru` (tahu folder siapa) —
 * supaya heuristik parsingnya (asumsi segmen pertama URL adalah nama bucket
 * kalau ada ≥2 segmen, lihat komentar di bawah) tidak dobel & berisiko beda.
 */
function keyDariPath(path: string): string {
  if (path.startsWith('/unggahan/')) {
    return path.substring('/unggahan/'.length);
  }

  // Bisa berupa: https://s3.nevaobjects.id/bucket/key atau https://custom.domain/key
  // atau: https://account.r2.cloudflarestorage.com/bucket/key (R2)
  try {
    const url = new URL(path);
    const parts = url.pathname.split('/').filter((p) => p !== '');

    if (parts.length >= 2) {
      // Format: /bucket/key/.. → anggap bucket adalah parts[0]
      return parts.slice(1).join('/');
    }
    if (parts.length === 1) {
      // Format: /key → langsung jadi key (custom domain)
      return parts[0] || '';
    }
  } catch {
    // Bukan URL valid, abaikan
  }
  return '';
}

/**
 * Hapus gambar yang diunggah dari S3 atau disk lokal. Path bisa berupa URL
 * S3 (`https://s3.nevaobjects.id/bucket/uuid.webp`) atau path lokal
 * (`/unggahan/uuid.webp`) — fungsi auto-detect sumber dan hapus dari tempat
 * yang sesuai. Error dihapus silent (tidak throw) supaya UI tetap responsif
 * — if-file-not-found adalah normal (sudah dihapus sebelumnya atau
 * never-existed).
 */
export async function hapusGambarUnggahan(path: string): Promise<void> {
  if (!path) return;

  if (path.startsWith('/unggahan/')) {
    const fullPath = resolve(config.dirUnggahan, keyDariPath(path));
    await unlink(fullPath).catch(() => {}); // silent fail kalau file tidak ada
    return;
  }

  const s3 = ambilKonfigS3();
  if (!s3.aktif) return; // kalau S3 tidak aktif, abaikan

  const key = keyDariPath(path);
  if (!key) return;

  await s3Klien(s3)
    .send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: key }))
    .catch(() => {}); // silent fail
}

/**
 * True kalau `path` berada di dalam folder milik guru tsb (`guru/{id}-...`)
 * — dipakai rute DELETE (`rute/api/unggah.ts`) supaya guru biasa hanya bisa
 * menghapus gambar dari folder sendiri, sementara admin bebas menghapus dari
 * folder manapun lewat panel "Manajemen Gambar". Gambar lama tanpa folder
 * (diunggah sebelum fitur folder-per-guru ada) atau di folder `admin/*`
 * selalu mengembalikan false — hanya admin yang bisa menghapusnya.
 */
export function pathMilikGuru(path: string, guruId: number): boolean {
  const key = keyDariPath(path);
  return key.startsWith(`guru/${guruId}-`);
}

interface InfoGambar {
  nama: string;
  path: string;
  ukuranByte: number;
  tanggal: string;
  tipe: 'lokal' | 's3';
}

/**
 * List gambar yang diunggah (dari S3 atau disk), dibatasi ke `prefix` kalau
 * diisi (mis. `guru/17-budi/presentasi/12/` — dipakai galeri admin level ke-3
 * lihat `jelajahUnggahan`) atau seluruh bucket/folder unggahan kalau kosong.
 * Dengan pagination, size info, dan total storage usage (khusus `prefix` ini).
 */
export async function daftarGambarUnggahan(
  prefix: string = '',
  limit: number = 50,
  offset: number = 0,
): Promise<{ gambar: InfoGambar[]; total: number; pemakaian: { byte: number; mb: number } }> {
  const daftar: InfoGambar[] = [];
  let pemakaianByte = 0;
  let total = 0;

  const s3 = ambilKonfigS3();

  if (s3.aktif) {
    // List dari S3
    try {
      const klien = s3Klien(s3);
      let continueToken: string | undefined = undefined;
      let semua: Array<{ Key: string; Size: number; LastModified: Date }> = [];

      // Pagination di S3 (max 1000 per request)
      do {
        const resp: ListObjectsV2CommandOutput = await klien.send(
          new ListObjectsV2Command({
            Bucket: s3.bucket,
            Prefix: prefix || undefined,
            ContinuationToken: continueToken,
            MaxKeys: 1000,
          }),
        );

        if (resp.Contents) {
          semua = semua.concat(
            resp.Contents.map((o: any) => ({
              Key: o.Key || '',
              Size: Number(o.Size || 0),
              LastModified: o.LastModified || new Date(),
            })),
          );
        }

        continueToken = resp.NextContinuationToken;
      } while (continueToken);

      // Sort by date (newest first) & apply pagination
      semua.sort((a, b) => b.LastModified.getTime() - a.LastModified.getTime());
      const halaman = semua.slice(offset, offset + limit);

      for (const obj of halaman) {
        daftar.push({
          nama: obj.Key.split('/').pop() || obj.Key,
          path: urlPublikS3(s3, obj.Key),
          ukuranByte: obj.Size,
          tanggal: obj.LastModified.toISOString(),
          tipe: 's3',
        });
      }

      // Total pemakaian
      pemakaianByte = semua.reduce((sum, o) => sum + o.Size, 0);
      total = semua.length;
    } catch (e) {
      // Silent fail kalau S3 tidak accessible
    }
  } else {
    // List dari disk lokal — `recursive: true` WAJIB sekarang; unggahan
    // tersusun dalam sub-folder per konteks (presentasi/*, papan/*, dst),
    // bukan rata di root lagi (lihat `simpanGambarUnggahan`).
    try {
      const dir = resolve(config.dirUnggahan, prefix);
      const files = await readdir(dir, { recursive: true });
      const infoFiles: Array<{ relatif: string; stat: Awaited<ReturnType<typeof stat>> }> = [];

      for (const file of files) {
        const relFile = file.split(sep).join('/');
        const relatif = prefix ? `${prefix}${relFile}` : relFile;
        try {
          const st = await stat(resolve(dir, file));
          if (st.isFile()) {
            infoFiles.push({ relatif, stat: st });
            pemakaianByte += st.size;
          }
        } catch {
          // Skip file yang error
        }
      }

      // Sort by mtime (newest first) & apply pagination
      infoFiles.sort((a, b) => Number(b.stat.mtimeMs) - Number(a.stat.mtimeMs));
      total = infoFiles.length;
      const halaman = infoFiles.slice(offset, offset + limit);

      for (const info of halaman) {
        daftar.push({
          nama: info.relatif.split('/').pop() || info.relatif,
          path: `/unggahan/${info.relatif}`,
          ukuranByte: Number(info.stat.size),
          tanggal: info.stat.mtime.toISOString(),
          tipe: 'lokal',
        });
      }
    } catch (e) {
      // Dir tidak ada atau error, abaikan
    }
  }

  return {
    gambar: daftar,
    total,
    pemakaian: {
      byte: pemakaianByte,
      mb: Math.round((pemakaianByte / 1024 / 1024) * 100) / 100,
    },
  };
}

/**
 * Daftar sub-folder LANGSUNG di bawah `prefix` (satu level, bukan rekursif)
 * — dipakai untuk drill-down galeri admin: folder guru → folder papan/
 * presentasi → gambar (lihat `jelajahUnggahan`). S3 pakai `Delimiter: '/'`
 * (fitur native S3 buat listing model direktori); disk lokal baca
 * `Dirent.isDirectory()` satu level.
 */
async function subfolder(prefix: string): Promise<string[]> {
  const s3 = ambilKonfigS3();

  if (s3.aktif) {
    const hasil: string[] = [];
    try {
      const klien = s3Klien(s3);
      let continueToken: string | undefined;
      do {
        const resp = await klien.send(
          new ListObjectsV2Command({
            Bucket: s3.bucket,
            Prefix: prefix,
            Delimiter: '/',
            ContinuationToken: continueToken,
          }),
        );
        for (const cp of resp.CommonPrefixes ?? []) {
          if (cp.Prefix) hasil.push(cp.Prefix);
        }
        continueToken = resp.NextContinuationToken;
      } while (continueToken);
    } catch {
      // Silent fail kalau S3 tidak accessible
    }
    return hasil;
  }

  try {
    const dir = resolve(config.dirUnggahan, prefix);
    const ents = await readdir(dir, { withFileTypes: true });
    return ents.filter((e) => e.isDirectory()).map((e) => `${prefix}${e.name}/`);
  } catch {
    return [];
  }
}

export interface EntriFolder {
  label: string;
  path: string;
  jenis: 'guru' | 'papan' | 'presentasi';
}

/**
 * Level 1 drill-down galeri admin: satu folder per guru yang pernah
 * mengunggah gambar. Label diambil LIVE dari tabel `guru` (bukan dari slug
 * di nama folder) supaya tetap akurat walau nama guru diganti belakangan;
 * guru yang sudah dihapus/nonaktif jatuh ke slug folder apa adanya.
 */
export async function daftarFolderGuru(): Promise<EntriFolder[]> {
  const folder = await subfolder('guru/');
  return folder.map((f) => {
    const slug = f.split('/').filter(Boolean)[1] ?? '';
    const guruId = Number(slug.split('-')[0]);
    const guru = Number.isInteger(guruId) ? cariGuruById(guruId) : null;
    return { label: guru?.nama ?? slug, path: f, jenis: 'guru' as const };
  });
}

/**
 * Level 2 drill-down: gabungan folder papan & presentasi milik satu guru,
 * dilabeli judulnya (live dari DB). Folder tanpa entri DB (papan/presentasi
 * sudah dihapus tapi gambarnya belum sempat/tidak dibersihkan) tetap
 * ditampilkan dengan label fallback, supaya gambar yatim itu tetap bisa
 * ditemukan & dihapus manual lewat panel admin.
 */
export async function daftarFolderKontenGuru(folderGuruPath: string): Promise<EntriFolder[]> {
  const hasil: EntriFolder[] = [];
  const db = getDb();

  for (const jenis of ['presentasi', 'papan'] as const) {
    const folder = await subfolder(`${folderGuruPath}${jenis}/`);
    for (const f of folder) {
      const segmen = f.split('/').filter(Boolean);
      const id = Number(segmen[segmen.length - 1]);
      if (!Number.isInteger(id)) continue;

      const baris =
        jenis === 'presentasi'
          ? (db.prepare('SELECT judul FROM presentasi WHERE id = ?').get(id) as { judul: string } | undefined)
          : (db.prepare('SELECT judul FROM papan WHERE id = ?').get(id) as { judul: string } | undefined);

      hasil.push({
        label: baris?.judul ?? `${jenis === 'presentasi' ? 'Presentasi' : 'Papan'} #${id} (sudah dihapus)`,
        path: f,
        jenis,
      });
    }
  }

  return hasil;
}

export type HasilJelajah =
  | { tipe: 'folder'; folder: EntriFolder[] }
  | { tipe: 'gambar'; gambar: InfoGambar[]; total: number; pemakaian: { byte: number; mb: number } };

/**
 * Titik masuk tunggal galeri admin "Manajemen Gambar" — kedalaman `path`
 * menentukan level drill-down: 0 segmen (root) → folder guru; 2 segmen
 * (`guru/{x}`) → folder papan/presentasi guru itu; lebih dalam lagi (sudah
 * di dalam satu papan/presentasi tertentu) → gambar sesungguhnya.
 *
 * Segmen `.`/`..`/kosong dibuang sebelum dipakai membangun path disk lokal
 * — `path` datang dari query string yang diketik admin, jangan sampai bisa
 * dipakai keluar dari `config.dirUnggahan` (S3 sendiri aman dari path
 * traversal karena `Prefix` bukan operasi filesystem).
 */
export async function jelajahUnggahan(path: string, limit = 50, offset = 0): Promise<HasilJelajah> {
  const segmen = path
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s !== '' && s !== '.' && s !== '..' && !s.includes('\\'));

  if (segmen.length === 0) {
    return { tipe: 'folder', folder: await daftarFolderGuru() };
  }

  if (segmen.length === 2 && segmen[0] === 'guru') {
    return { tipe: 'folder', folder: await daftarFolderKontenGuru(`${segmen.join('/')}/`) };
  }

  const prefix = `${segmen.join('/')}/`;
  const { gambar, total, pemakaian } = await daftarGambarUnggahan(prefix, limit, offset);
  return { tipe: 'gambar', gambar, total, pemakaian };
}
