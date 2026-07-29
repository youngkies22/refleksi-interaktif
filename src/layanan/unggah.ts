import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { config } from '../config.js';
import { galatValidasi } from '../galat.js';
import { UNGGAH } from '../../shared/konstanta.js';

/**
 * Simpan gambar yang diunggah guru (dipakai slide `pin_jawaban`, dan papan
 * Padlet di Fase 6).
 *
 * Verifikasi tipe file lewat MAGIC BYTES (`file-type` membaca header biner
 * sesungguhnya), BUKAN dari ekstensi nama file atau `Content-Type` yang
 * diklaim klien — keduanya trivial dipalsukan. File disimpan dengan nama
 * ACAK di luar kontrol nama asli, supaya tidak ada cara memaksa ekstensi
 * berbahaya (mis. `.php`) lolos ke disk.
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

  const namaBerkas = `${randomUUID()}.${tipe.ext}`;
  await writeFile(resolve(config.dirUnggahan, namaBerkas), buffer);

  return { path: `/unggahan/${namaBerkas}` };
}
