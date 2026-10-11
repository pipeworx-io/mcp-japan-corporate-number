/**
 * The 47 prefecture codes NTA's register uses (都道府県コード, "01".."47"),
 * with Japanese and English names, so jp_company_search can filter by
 * prefecture using WHICHEVER form the caller types — independent of whether
 * the matched COMPANY itself registered an English address. (The register's
 * own `prefecture_en` column is per-company, populated only for the 15,352
 * entities with an official English name — filtering on it directly would
 * silently miss every Hokkaido company that has no English name at all,
 * which is most of them. This table is the fix.)
 */
export const PREFECTURES: Array<{ code: string; ja: string; en: string }> = [
  { code: '01', ja: '北海道', en: 'Hokkaido' },
  { code: '02', ja: '青森県', en: 'Aomori' },
  { code: '03', ja: '岩手県', en: 'Iwate' },
  { code: '04', ja: '宮城県', en: 'Miyagi' },
  { code: '05', ja: '秋田県', en: 'Akita' },
  { code: '06', ja: '山形県', en: 'Yamagata' },
  { code: '07', ja: '福島県', en: 'Fukushima' },
  { code: '08', ja: '茨城県', en: 'Ibaraki' },
  { code: '09', ja: '栃木県', en: 'Tochigi' },
  { code: '10', ja: '群馬県', en: 'Gunma' },
  { code: '11', ja: '埼玉県', en: 'Saitama' },
  { code: '12', ja: '千葉県', en: 'Chiba' },
  { code: '13', ja: '東京都', en: 'Tokyo' },
  { code: '14', ja: '神奈川県', en: 'Kanagawa' },
  { code: '15', ja: '新潟県', en: 'Niigata' },
  { code: '16', ja: '富山県', en: 'Toyama' },
  { code: '17', ja: '石川県', en: 'Ishikawa' },
  { code: '18', ja: '福井県', en: 'Fukui' },
  { code: '19', ja: '山梨県', en: 'Yamanashi' },
  { code: '20', ja: '長野県', en: 'Nagano' },
  { code: '21', ja: '岐阜県', en: 'Gifu' },
  { code: '22', ja: '静岡県', en: 'Shizuoka' },
  { code: '23', ja: '愛知県', en: 'Aichi' },
  { code: '24', ja: '三重県', en: 'Mie' },
  { code: '25', ja: '滋賀県', en: 'Shiga' },
  { code: '26', ja: '京都府', en: 'Kyoto' },
  { code: '27', ja: '大阪府', en: 'Osaka' },
  { code: '28', ja: '兵庫県', en: 'Hyogo' },
  { code: '29', ja: '奈良県', en: 'Nara' },
  { code: '30', ja: '和歌山県', en: 'Wakayama' },
  { code: '31', ja: '鳥取県', en: 'Tottori' },
  { code: '32', ja: '島根県', en: 'Shimane' },
  { code: '33', ja: '岡山県', en: 'Okayama' },
  { code: '34', ja: '広島県', en: 'Hiroshima' },
  { code: '35', ja: '山口県', en: 'Yamaguchi' },
  { code: '36', ja: '徳島県', en: 'Tokushima' },
  { code: '37', ja: '香川県', en: 'Kagawa' },
  { code: '38', ja: '愛媛県', en: 'Ehime' },
  { code: '39', ja: '高知県', en: 'Kochi' },
  { code: '40', ja: '福岡県', en: 'Fukuoka' },
  { code: '41', ja: '佐賀県', en: 'Saga' },
  { code: '42', ja: '長崎県', en: 'Nagasaki' },
  { code: '43', ja: '熊本県', en: 'Kumamoto' },
  { code: '44', ja: '大分県', en: 'Oita' },
  { code: '45', ja: '宮崎県', en: 'Miyazaki' },
  { code: '46', ja: '鹿児島県', en: 'Kagoshima' },
  { code: '47', ja: '沖縄県', en: 'Okinawa' },
];

/** Resolve any of: 2-digit code, Japanese name (with or without 都/道/府/県),
 *  English name (case-insensitive) -> the canonical 2-digit code, or null if
 *  nothing matches. */
export function resolvePrefectureCode(input: string): string | null {
  const s = input.trim();
  if (/^\d{1,2}$/.test(s)) {
    const code = s.padStart(2, '0');
    return PREFECTURES.some((p) => p.code === code) ? code : null;
  }
  const lower = s.toLowerCase();
  for (const p of PREFECTURES) {
    if (p.ja === s || p.ja.replace(/[都道府県]$/, '') === s) return p.code;
    if (p.en.toLowerCase() === lower) return p.code;
  }
  return null;
}
