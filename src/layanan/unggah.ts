import { randomUUID } from 'node:crypto';
import { readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ListObjectsV2CommandOutput } from '@aws-sdk/client-s3';
import { DeleteObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { config } from '../config.js';
import { galatValidasi } from '../galat.js';
import { ambilKonfigS3 } from './pengaturan.js';
import { opsiAclUpload, s3Klien, urlPublikS3 } from './s3Klien.js';
import { UNGGAH } from '../../shared/konstanta.js';

/**
 * Kompres & batasi dimensi gambar sebelum disimpan — foto langsung dari HP
 * (sering 3-8 MB) turun ke puluhan/ratusan KB tanpa beda kasat mata di layar
 * kelas. `fit: 'inside'` TIDAK PERNAH memotong/mengubah rasio gambar, hanya
 * mengecilkan kalau lebih besar dari 1920px — penting karena beberapa slide
 * (`pin_jawaban`) menyimpan koordinat area jawaban sebagai PERSENTASE (0..1)
 * relatif terhadap gambar, bukan piksel; kalau rasio berubah, titik jawaban
 * lama jadi meleset.
 *
 * GIF dilewati apa adanya (tidak di-decode ulang) supaya animasinya tidak
 * rusak — resize frame-per-frame di luar cakupan fitur ini.
 */
async function kompresGambar(buffer: Buffer, mime: string): Promise<{ buffer: Buffer; ext: string; mime: string }> {
  if (mime === 'image/gif') {
    return { buffer, ext: 'gif', mime };
  }

  const hasil = await sharp(buffer)
    .rotate() // auto-orientasi dari EXIF SEBELUM EXIF-nya dibuang oleh re-encode
    .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80, effort: 4 })
    .toBuffer();

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
 * Tujuan penyimpanan: object storage S3-compatible kalau diatur lewat panel
 * admin (lihat `layanan/pengaturan.ts` — `ambilKonfigS3()`), jatuh ke disk
 * lokal (`data/unggahan/`) kalau tidak — supaya instalasi yang belum pasang
 * object storage tetap jalan seperti sebelumnya.
 */
export async function simpanGambarUnggahan(buffer: Buffer): Promise<{ path: string }> {
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
  const namaBerkas = `${randomUUID()}.${dikompres.ext}`;

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

  await writeFile(resolve(config.dirUnggahan, namaBerkas), dikompres.buffer);
  return { path: `/unggahan/${namaBerkas}` };
}

/**
 * Hapus gambar yang diunggah dari S3 atau disk lokal. Path bisa berupa:
 * - URL S3: `https://s3.nevaobjects.id/bucket/uuid.webp` atau custom domain
 * - Path lokal: `/unggahan/uuid.webp`
 *
 * Fungsi auto-detect sumber dan hapus dari tempat yang sesuai. Error dihapus
 * silent (tidak throw) supaya UI tetap responsif — if-file-not-found adalah
 * normal (sudah dihapus sebelumnya atau never-existed).
 */
export async function hapusGambarUnggahan(path: string): Promise<void> {
  if (!path) return;

  // Deteksi: path lokal atau S3
  if (path.startsWith('/unggahan/')) {
    // Path lokal: ekstrak nama file
    const namaBerkas = path.substring('/unggahan/'.length);
    const fullPath = resolve(config.dirUnggahan, namaBerkas);
    await unlink(fullPath).catch(() => {}); // silent fail kalau file tidak ada
    return;
  }

  // S3: parse path/URL untuk ekstrak bucket key
  // Bisa berupa: https://s3.nevaobjects.id/bucket/key atau https://custom.domain/key
  // atau: https://account.r2.cloudflarestorage.com/bucket/key (R2)
  const s3 = ambilKonfigS3();
  if (!s3.aktif) return; // kalau S3 tidak aktif, abaikan

  // Ekstrak key dari path:
  // - Jika URL punya bucket di pathname: https://endpoint/bucket/key → key
  // - Jika custom domain (r2.dev atau custom): key adalah pathname minus leading /
  let key = '';

  try {
    const url = new URL(path);
    const parts = url.pathname.split('/').filter((p) => p !== '');

    if (parts.length >= 2) {
      // Format: /bucket/key/.. → anggap bucket adalah parts[0]
      key = parts.slice(1).join('/');
    } else if (parts.length === 1) {
      // Format: /key → langsung jadi key (custom domain)
      key = parts[0] || '';
    }
  } catch {
    // Bukan URL valid, abaikan
    return;
  }

  if (!key) return;

  // Delete dari S3
  await s3Klien(s3)
    .send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: key }))
    .catch(() => {}); // silent fail
}

interface InfoGambar {
  nama: string;
  path: string;
  ukuranByte: number;
  tanggal: string;
  tipe: 'lokal' | 's3';
}

/**
 * List semua gambar yang diunggah (dari S3 atau disk).
 * Dengan pagination, size info, dan total storage usage.
 */
export async function daftarGambarUnggahan(
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
    // List dari disk lokal
    try {
      const files = await readdir(config.dirUnggahan);
      const infoFiles: Array<{ nama: string; stat: Awaited<ReturnType<typeof stat>> }> = [];

      for (const file of files) {
        try {
          const st = await stat(resolve(config.dirUnggahan, file));
          if (st.isFile()) {
            infoFiles.push({ nama: file, stat: st });
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
          nama: info.nama,
          path: `/unggahan/${info.nama}`,
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
