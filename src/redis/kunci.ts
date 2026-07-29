/**
 * SATU-SATUNYA tempat nama key Redis dibentuk.
 *
 * Jangan pernah menulis string key Redis secara manual di tempat lain — kalau ada
 * dua tempat yang membentuk key dengan format berbeda (mis. salah taruh separator),
 * data akan "hilang" tanpa galat apa pun, karena Redis menganggapnya key yang lain.
 */

const PREFIKS = 'rfl';

export const kunci = {
  kodeSesi: (kode: string) => `${PREFIKS}:kode:sesi:${kode}`,
  kodePapan: (kode: string) => `${PREFIKS}:kode:papan:${kode}`,

  sesi: (sesiId: number) => `${PREFIKS}:sesi:${sesiId}`,
  sesiPeserta: (sesiId: number) => `${PREFIKS}:sesi:${sesiId}:peserta`,
  sesiHadir: (sesiId: number) => `${PREFIKS}:sesi:${sesiId}:hadir`,
  sesiJawab: (sesiId: number, slideId: number) => `${PREFIKS}:sesi:${sesiId}:jawab:${slideId}`,

  agregat: (sesiId: number, slideId: number) => `${PREFIKS}:agg:${sesiId}:${slideId}`,
  skor: (sesiId: number) => `${PREFIKS}:skor:${sesiId}`,

  papanHadir: (papanId: number) => `${PREFIKS}:papan:${papanId}:hadir`,

  rateJawaban: (token: string) => `${PREFIKS}:rate:jawab:${token}`,
  rateKartu: (token: string) => `${PREFIKS}:rate:kartu:${token}`,

  rateLoginAkun: (username: string) => `${PREFIKS}:rate:login:akun:${username}`,
  rateLoginIp: (ip: string) => `${PREFIKS}:rate:login:ip:${ip}`,
} as const;
