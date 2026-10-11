/**
 * Katakana -> romaji (Hepburn-ish), for SEARCH purposes only.
 *
 * Added fleet #2928 (2026-10-11 correction): a caller reported
 * jp_company_search("Toyota") missing Toyota Motor Corporation
 * (1180301018771). Investigation found that NTA's own `name_en` field is
 * genuinely empty for Toyota (and for all but 15,352 of 5,837,980 entities,
 * 0.26% — verified against the live file) — this is NOT a bug, it is a real
 * data gap, and the README already said the pack never invents an English
 * name a company has none of. But the register carries `name_kana`
 * (トヨタジドウシャ for Toyota) for 3,566,151 entities (61%) — a MUCH bigger
 * population — and a caller typing a well-known company's name in English
 * reasonably expects that to work. So this module romanises the kana
 * reading for the search index only (never stored as a fact, never returned
 * as `name_en`), so "Toyota" matches via its substring presence in
 * "toyotajidousha" (the romanised reading), the same way the PREVIOUS
 * behaviour matched a real NTA-published English name.
 *
 * This is deliberately approximate (greedy longest-match over a syllable
 * table, no attempt at perfect Hepburn long-vowel macrons or particle
 * contractions) — it exists to make substring search find the right
 * company, not to produce a linguistically correct romanisation to DISPLAY.
 * It is never exposed as `name_en`.
 */

// Two-character (youon/digraph) combinations, longest match first.
const DIGRAPHS: Record<string, string> = {
  キャ: 'kya', キュ: 'kyu', キョ: 'kyo',
  ギャ: 'gya', ギュ: 'gyu', ギョ: 'gyo',
  シャ: 'sha', シュ: 'shu', ショ: 'sho',
  ジャ: 'ja', ジュ: 'ju', ジョ: 'jo',
  チャ: 'cha', チュ: 'chu', チョ: 'cho',
  ニャ: 'nya', ニュ: 'nyu', ニョ: 'nyo',
  ヒャ: 'hya', ヒュ: 'hyu', ヒョ: 'hyo',
  ビャ: 'bya', ビュ: 'byu', ビョ: 'byo',
  ピャ: 'pya', ピュ: 'pyu', ピョ: 'pyo',
  ミャ: 'mya', ミュ: 'myu', ミョ: 'myo',
  リャ: 'rya', リュ: 'ryu', リョ: 'ryo',
  ティ: 'ti', ディ: 'di', トゥ: 'tu', ドゥ: 'du',
  デュ: 'dyu', テュ: 'tyu',
  ファ: 'fa', フィ: 'fi', フェ: 'fe', フォ: 'fo', フュ: 'fyu',
  ウィ: 'wi', ウェ: 'we', ウォ: 'wo',
  ヴァ: 'va', ヴィ: 'vi', ヴェ: 've', ヴォ: 'vo', ヴュ: 'vyu',
  クァ: 'kwa', グァ: 'gwa',
  ジェ: 'je', チェ: 'che', シェ: 'she',
};

// Single-character syllables.
const KANA: Record<string, string> = {
  ア: 'a', イ: 'i', ウ: 'u', エ: 'e', オ: 'o',
  カ: 'ka', キ: 'ki', ク: 'ku', ケ: 'ke', コ: 'ko',
  ガ: 'ga', ギ: 'gi', グ: 'gu', ゲ: 'ge', ゴ: 'go',
  サ: 'sa', シ: 'shi', ス: 'su', セ: 'se', ソ: 'so',
  ザ: 'za', ジ: 'ji', ズ: 'zu', ゼ: 'ze', ゾ: 'zo',
  タ: 'ta', チ: 'chi', ツ: 'tsu', テ: 'te', ト: 'to',
  ダ: 'da', ヂ: 'ji', ヅ: 'zu', デ: 'de', ド: 'do',
  ナ: 'na', ニ: 'ni', ヌ: 'nu', ネ: 'ne', ノ: 'no',
  ハ: 'ha', ヒ: 'hi', フ: 'fu', ヘ: 'he', ホ: 'ho',
  バ: 'ba', ビ: 'bi', ブ: 'bu', ベ: 'be', ボ: 'bo',
  パ: 'pa', ピ: 'pi', プ: 'pu', ペ: 'pe', ポ: 'po',
  マ: 'ma', ミ: 'mi', ム: 'mu', メ: 'me', モ: 'mo',
  ヤ: 'ya', ユ: 'yu', ヨ: 'yo',
  ラ: 'ra', リ: 'ri', ル: 'ru', レ: 're', ロ: 'ro',
  ワ: 'wa', ヲ: 'wo', ヴ: 'vu', ン: 'n',
  ー: '', // long-vowel mark: handled by vowel repetition below, not a literal
};

const SMALL_TSU = 'ッ'; // doubles the following consonant
const CONSONANT_OF: Record<string, string> = {}; // first letter of each syllable's romaji, for sokuon doubling
for (const [k, v] of Object.entries(KANA)) if (v) CONSONANT_OF[k] = v[0];
for (const [k, v] of Object.entries(DIGRAPHS)) CONSONANT_OF[k] = v[0];

/** Romanise a katakana reading for SEARCH matching only — approximate,
 *  never displayed as a fact. Non-katakana characters (spaces, middle dots,
 *  already-Latin text some readings mix in) pass through unchanged so a
 *  partially-katakana string still gets what we can romanise. */
export function kanaToRomaji(input: string): string {
  if (!input) return '';
  let out = '';
  let i = 0;
  const chars = Array.from(input);
  while (i < chars.length) {
    const c = chars[i];
    if (c === SMALL_TSU) {
      // Double the consonant of whatever follows (digraph or single kana).
      const two = chars[i + 1] + (chars[i + 2] ?? '');
      const nextConsonant = DIGRAPHS[two] ? CONSONANT_OF[two] : CONSONANT_OF[chars[i + 1]];
      if (nextConsonant && nextConsonant !== 'a' && nextConsonant !== 'i' && nextConsonant !== 'u' && nextConsonant !== 'e' && nextConsonant !== 'o') {
        out += nextConsonant;
      } else {
        out += 't'; // sokuon before a vowel-leading mora: approximate with 't'
      }
      i += 1;
      continue;
    }
    const two = c + (chars[i + 1] ?? '');
    if (DIGRAPHS[two]) {
      out += DIGRAPHS[two];
      i += 2;
      continue;
    }
    if (c === 'ー') {
      // Long-vowel mark: repeat the last vowel already written.
      const lastVowel = /[aiueo]([^aiueo]*)$/.exec(out)?.[0]?.[0];
      if (lastVowel) out += lastVowel;
      i += 1;
      continue;
    }
    if (KANA[c] !== undefined) {
      out += KANA[c];
      i += 1;
      continue;
    }
    // Not katakana (space, '・', Latin letters already in the string, etc.)
    out += c.toLowerCase();
    i += 1;
  }
  return out;
}
