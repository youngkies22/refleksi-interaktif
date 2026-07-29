/**
 * Normalisasi & pencocokan longgar untuk tipe `ketik_jawaban`.
 *
 * Kalau ini asal-asalan, siswa protes karena jawaban yang sebenarnya benar
 * dianggap salah oleh sistem — jadi normalisasi & toleransi salah ketik
 * dipisah jadi fungsi sendiri yang bisa diuji terpisah dari logika skor.
 */

/** lowercase → trim → rapatkan spasi ganda → buang tanda baca di ujung. */
export function normalisasiJawabanTeks(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:]+$/g, '');
}

/** Jarak edit Levenshtein standar (DP O(n·m)) — teks jawaban selalu pendek, jadi ini murah. */
export function jarakLevenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let baris = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const barisBaru = [i];
    for (let j = 1; j <= b.length; j++) {
      const biaya = a[i - 1] === b[j - 1] ? 0 : 1;
      barisBaru.push(
        Math.min(
          baris[j]! + 1, // hapus
          barisBaru[j - 1]! + 1, // sisip
          baris[j - 1]! + biaya, // ganti
        ),
      );
    }
    baris = barisBaru;
  }

  return baris[b.length]!;
}

/** Judul → nama berkas aman: spasi jadi `_`, karakter yang bisa merusak header
 *  `Content-Disposition` atau nama file di OS dibuang. */
export function namaBerkasAman(judul: string): string {
  const bersih = judul
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^\w.-]/g, '')
    .slice(0, 80);
  return bersih === '' ? 'tanpa-judul' : bersih;
}

/**
 * Peserta benar kalau jawabannya cocok PERSIS (setelah normalisasi) dengan
 * salah satu jawaban yang diterima, ATAU — kalau `cocokPersis` tidak diaktifkan
 * guru — jaraknya ≤1 edit dari salah satu jawaban yang panjangnya >4 huruf.
 * Ambang 4 huruf mencegah kata pendek (mis. "ya"/"pi") ikut ditoleransi, yang
 * bisa membuat jawaban BERBEDA dianggap sama hanya karena kebetulan pendek.
 */
export function cocokKetikJawaban(
  jawabanPeserta: string,
  diterima: string[],
  cocokPersis: boolean,
): boolean {
  const norm = normalisasiJawabanTeks(jawabanPeserta);
  if (norm === '') return false;

  for (const kandidat of diterima) {
    const normKandidat = normalisasiJawabanTeks(kandidat);
    if (normKandidat === '') continue;
    if (norm === normKandidat) return true;
    if (!cocokPersis && normKandidat.length > 4 && jarakLevenshtein(norm, normKandidat) <= 1) {
      return true;
    }
  }
  return false;
}
