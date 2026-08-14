import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { galatValidasi } from '../galat.js';

export interface KredensialS3 {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  /** Override URL publik — WAJIB untuk Cloudflare R2 (lihat `adalahR2`), lihat
   *  `urlPublikS3()`. Kosong = turunkan dari endpoint+bucket. */
  urlPublik: string;
}

/**
 * Cloudflare R2 butuh perlakuan beda dari penyedia S3-compatible lain
 * (NevaObjects, MinIO, Ceph RGW, dll) di DUA hal:
 *
 * 1. Endpoint S3-nya (`<account>.r2.cloudflarestorage.com`) PRIVAT — hanya
 *    bisa diakses dengan kredensial SigV4, tidak bisa jadi src `<img>`
 *    langsung. Akses publik R2 WAJIB lewat custom domain atau subdomain
 *    `*.r2.dev` yang di-bind terpisah di dashboard R2 — makanya ada field
 *    `urlPublik` yang WAJIB diisi untuk R2 (lihat `urlPublikS3()`).
 * 2. API-nya MENOLAK KERAS (galat, bukan diabaikan) header ACL selain
 *    `private` — mengirim `x-amz-acl: public-read` bikin `PutObject`
 *    gagal total. Penyedia S3-compatible lain umumnya menerimanya normal.
 */
export function adalahR2(endpoint: string): boolean {
  try {
    return new URL(endpoint).hostname.endsWith('.r2.cloudflarestorage.com');
  } catch {
    return false;
  }
}

/**
 * Dibuat baru tiap dipanggil, bukan singleton — konfigurasinya bisa berubah
 * kapan saja lewat panel admin (lihat `layanan/pengaturan.ts`), dan membuat
 * `S3Client` itu murah (tidak ada koneksi jaringan dibuka sampai `.send()`
 * pertama). Menyimpan cache di sini cuma menambah risiko memakai kredensial
 * basi tanpa manfaat nyata untuk volume unggahan aplikasi kelas ini.
 *
 * `forcePathStyle: true` WAJIB untuk NevaObjects/R2/kebanyakan S3-compatible
 * lain di luar AWS sungguhan — URL objeknya berbentuk
 * `https://s3.nevaobjects.id/<bucket>/<key>`, BUKAN gaya virtual-hosted
 * `<bucket>.s3.nevaobjects.id/<key>` yang jadi bawaan SDK.
 */
export function s3Klien(k: KredensialS3): S3Client {
  return new S3Client({
    endpoint: k.endpoint,
    region: k.region,
    forcePathStyle: true,
    credentials: { accessKeyId: k.accessKey, secretAccessKey: k.secretKey },
  });
}

/** Kosong `urlPublik` = turunkan path-style dari endpoint+bucket (cocok untuk
 *  penyedia yang endpoint S3-nya memang publik, mis. NevaObjects). Diisi =
 *  dipakai apa adanya — WAJIB untuk R2 (custom domain atau `*.r2.dev`). */
export function urlPublikS3(k: Pick<KredensialS3, 'endpoint' | 'bucket' | 'urlPublik'>, key: string): string {
  if (k.urlPublik) return `${k.urlPublik.replace(/\/$/, '')}/${key}`;
  return `${k.endpoint.replace(/\/$/, '')}/${k.bucket}/${key}`;
}

/** ACL `public-read` DITOLAK KERAS oleh R2 (lihat `adalahR2`) — dilewati di
 *  sana, bucket publiknya diatur admin lewat dashboard R2 sendiri. Dipakai
 *  bersama oleh `unggah.ts` dan `ujiKoneksiS3` supaya logikanya satu tempat. */
export function opsiAclUpload(endpoint: string): { ACL: 'public-read' } | Record<string, never> {
  return adalahR2(endpoint) ? {} : { ACL: 'public-read' };
}

/**
 * Uji koneksi nyata: unggah berkas kecil, pastikan URL publiknya benar bisa
 * diakses, lalu bersihkan. Dipakai tombol "Uji Koneksi" di panel admin supaya
 * salah ketik access key/secret/bucket/URL publik ketahuan SAAT diisi, bukan
 * nanti saat guru/siswa pertama kali mencoba unggah gambar.
 */
export async function ujiKoneksiS3(k: KredensialS3): Promise<void> {
  const klien = s3Klien(k);
  const key = `_uji-koneksi-${randomUUID()}.txt`;
  const isi = Buffer.from('Uji koneksi Refleksi — aman dihapus.');

  try {
    await klien.send(
      new PutObjectCommand({ Bucket: k.bucket, Key: key, Body: isi, ContentType: 'text/plain', ...opsiAclUpload(k.endpoint) }),
    );
  } catch (e) {
    throw galatValidasi(`Gagal mengunggah ke bucket "${k.bucket}": ${pesanRingkas(e)}`);
  }

  try {
    if (!k.urlPublik && adalahR2(k.endpoint)) {
      throw galatValidasi(
        'Berhasil unggah, tapi "URL Publik" belum diisi — WAJIB untuk Cloudflare R2 karena endpoint S3-nya privat. ' +
          'Isi dengan domain publik bucket (custom domain atau subdomain *.r2.dev) dari dashboard R2.',
      );
    }
    const urlPublik = urlPublikS3(k, key);
    const r = await fetch(urlPublik);
    if (!r.ok) {
      throw galatValidasi(
        `Berkas berhasil diunggah, tapi URL publiknya (${urlPublik}) mengembalikan status ${r.status}. ` +
          `Pastikan bucket "${k.bucket}" diset publik-baca (atau isi "URL Publik" kalau memakai custom domain/R2).`,
      );
    }
  } finally {
    await klien.send(new DeleteObjectCommand({ Bucket: k.bucket, Key: key })).catch(() => {});
  }
}

function pesanRingkas(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
