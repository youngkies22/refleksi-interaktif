import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
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
