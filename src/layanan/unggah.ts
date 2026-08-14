import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PutObjectCommand } from '@aws-sdk/client-s3';
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
