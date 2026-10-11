/**
 * Reads for japan-corporate-number (fleet #2928).
 *
 * Source: Japan's National Tax Agency (国税庁), corporate number register
 * (法人番号公表サイト), published monthly. A refresh script
 * (scripts/japan-corporate-number/refresh.sh — see README "Refresh")
 * downloads the current publication and loads it into a D1 database the
 * gateway hands this pack as `_d1` (pack-manifest "d1Binding": "JP_CORP_DB").
 * Table/column names here must match
 * scripts/japan-corporate-number/schema.sql.
 *
 * SOURCE below names the publisher and the register only — never
 * the download path, a file name, or a form field. CLAUDE.md step 9b
 * (a4c024647, Bruce, 2026-10-11): that mechanical detail lives ONLY in
 * refresh.sh and build-local-db.mjs, never in anything a caller reads.
 */
import { resolvePrefectureCode } from './prefectures.js';

/** The slice of Cloudflare's D1Database this pack uses, declared here so the
 *  pack needs no workers-types and a test can pass a node:sqlite stub. */
export interface D1Like {
  prepare(sql: string): D1StmtLike;
}
export interface D1StmtLike {
  bind(...values: unknown[]): D1StmtLike;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

// Publisher + dataset only -- never the download route (CLAUDE.md step 9b,
// fleet #2938). The route lives in scripts/japan-corporate-number/.
export const SOURCE = 'Japan National Tax Agency (国税庁), Corporate Number Publication Site (法人番号公表サイト) register';

export class StoreUnavailableError extends Error {
  constructor() {
    super(
      'japan-corporate-number: the register is not bound in this runtime (no _d1). These tools only answer through the Pipeworx gateway; a standalone install has no data to read.',
    );
    this.name = 'StoreUnavailableError';
  }
}
export function requireDb(d1: unknown): D1Like {
  if (!d1 || typeof (d1 as D1Like).prepare !== 'function') throw new StoreUnavailableError();
  return d1 as D1Like;
}

export async function dataAsOf(db: D1Like): Promise<string | null> {
  const r = await db.prepare(`SELECT value FROM meta WHERE key = 'data_as_of'`).first<{ value: string | null }>();
  return r?.value ?? null;
}
export async function rowCount(db: D1Like): Promise<number | null> {
  const r = await db.prepare(`SELECT value FROM meta WHERE key = 'row_count'`).first<{ value: string | null }>();
  return r?.value ? Number(r.value) : null;
}

/**
 * 法人種別 code labels. The nine codes below are the complete set observed
 * in the live whole-country CSV (verified 2026-10-11): no others appeared.
 * NTA's own PDF resource-definition page was not reachable during this
 * build, so these English glosses are best-effort — the raw `kind` code is
 * always returned alongside the label so a caller can verify independently.
 */
export const KIND_LABELS: Record<string, string> = {
  '101': 'National government organization',
  '201': 'Local government',
  '301': 'Kabushiki Kaisha (stock company)',
  '302': 'Godo Kaisha (LLC-equivalent)',
  '303': 'Gomei Kaisha (general partnership company)',
  '304': 'Goshi Kaisha (limited partnership company)',
  '305': 'Other registered corporation (e.g. incorporated association/foundation)',
  '399': 'Other',
  '499': 'Foreign company, etc.',
};

export interface CorpRow {
  corporate_number: string;
  sequence_number: number | null;
  process_type: string | null;
  correction_type: string | null;
  update_date: string | null;
  change_date: string | null;
  name: string;
  name_core: string;
  kind: string | null;
  prefecture: string | null;
  city: string | null;
  address_rest: string | null;
  prefecture_code: string | null;
  city_code: string | null;
  postal_code: string | null;
  closure_date: string | null;
  closure_cause_code: string | null;
  closure_event_text: string | null;
  successor_corporate_number: string | null;
  assignment_date: string | null;
  name_en: string | null;
  prefecture_en: string | null;
  address_en: string | null;
  name_kana: string | null;
}

const COLS = `corporate_number, sequence_number, process_type, correction_type, update_date, change_date,
  name, name_core, kind, prefecture, city, address_rest, prefecture_code, city_code, postal_code,
  closure_date, closure_cause_code, closure_event_text, successor_corporate_number, assignment_date,
  name_en, prefecture_en, address_en, name_kana`;

export async function findByNumber(db: D1Like, corporateNumber: string): Promise<CorpRow | null> {
  const r = await db
    .prepare(`SELECT ${COLS} FROM corporations WHERE corporate_number = ?`)
    .bind(corporateNumber)
    .first<CorpRow>();
  return r ?? null;
}

/** Fold width variants (full/half-width) the same way the loader did, so a
 *  query in a different width form still matches the index. */
function foldWidth(s: string): string {
  return s.normalize('NFKC').trim().replace(/\s+/g, ' ');
}
const SUFFIXES = [
  '株式会社', '合同会社', '合名会社', '合資会社', '有限会社',
  '一般社団法人', '一般財団法人', '公益社団法人', '公益財団法人',
  '特定非営利活動法人', '医療法人', '社会福祉法人', '協同組合',
];
export function coreName(name: string): string {
  const folded = foldWidth(name);
  for (const s of SUFFIXES) {
    if (folded.startsWith(s)) return foldWidth(folded.slice(s.length)).toLowerCase();
    if (folded.endsWith(s)) return foldWidth(folded.slice(0, folded.length - s.length)).toLowerCase();
  }
  return folded.toLowerCase();
}
/** Escape for an FTS5 trigram phrase MATCH. */
function ftsPhrase(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

export async function searchByName(
  db: D1Like,
  opts: { query: string; prefecture?: string; limit: number },
): Promise<CorpRow[]> {
  const folded = coreName(opts.query);
  if (!folded) return [];
  // The register's own prefecture_en/prefecture columns are per-ENTITY, not
  // per-prefecture: prefecture_en is populated only for the 15,352 entities
  // that registered an official English name, so filtering on it directly
  // would silently miss almost every entity in a prefecture that happens to
  // have no English name. resolvePrefectureCode maps whatever form the
  // caller typed (code / Japanese / English) to the canonical 2-digit code,
  // which every row has.
  const prefCode = opts.prefecture ? resolvePrefectureCode(opts.prefecture) : null;
  const selectCols = `c.${COLS.split(',').map((c) => c.trim()).join(', c.')}`;
  const params: unknown[] = [];
  let sql: string;
  // SQLite's FTS5 "trigram" tokenizer windows by CHARACTER, not byte: a
  // 2-character query ("釧路") produces zero trigrams and MATCHes nothing,
  // even though it is a real substring of many names — verified directly
  // against this database (0 rows via MATCH, 5 via LIKE, for the same
  // 2-character string). Fall back to a plain substring scan on name_core
  // for any query under 3 characters.
  // RANKING, not just matching (fleet #2928 correction). Trigram MATCH
  // alone, with no ORDER BY, returns rows in an implementation-defined
  // order — reproduced live: searching "トヨタ自動車" (Toyota Motor
  // Corporation's own core name, minus its 株式会社 suffix) with limit=3
  // returned three unrelated dealerships/unions that also contain that
  // substring, never the company itself, because dozens of other real
  // entities ("札幌トヨタ自動車株式会社", "トヨタ自動車北海道労働組合", ...)
  // match the same trigrams. And a romanised query ("Toyota") has no
  // Japanese name_core to compare against at all — it has to rank against
  // name_en (rare: 0.26% of entities) and the romanised katakana reading
  // (common: 61%) instead.
  //
  // A single TIER expression, lowest tier wins, ties broken by bm25 (FTS
  // branch only): tier 0 = exact match on name_core, lower(name_en), or
  // name_kana_romaji; tier 1 = query is a PREFIX of any of those (so
  // "ソニー" ranks "ソニーグループ株式会社" ahead of an unrelated small
  // company that happens to be named exactly "ソニー"); tier 2 = matched
  // only by trigram/substring.
  //
  // PLAIN `?` placeholders ONLY, each bound value repeated positionally —
  // deliberately NOT SQLite's `?1`/`?2` numbered-parameter shorthand. The
  // native Cloudflare D1 binding handles numbered parameters correctly,
  // but the wrangler-shell-based D1Like shim used for pre-deploy smoke
  // testing (scripts/lib/pack-smoke.mjs, and this pack's own
  // scripts/japan-corporate-number/live-proof.mjs) inlines bound values
  // with a naive `sql.replace(/\?/g, ...)`, which corrupts a numbered
  // placeholder into literal text like `'...'1` (found live, 2026-10-11,
  // verifying this very fix). Repeating the value avoids the whole class
  // of shim/driver disagreement rather than depending on every caller's
  // binding layer understanding `?N`.
  const tierSql = `CASE
      WHEN c.name_core = ? OR lower(coalesce(c.name_en,'')) = ? OR coalesce(c.name_kana_romaji,'') = ? THEN 0
      WHEN c.name_core LIKE ? || '%' OR lower(coalesce(c.name_en,'')) LIKE ? || '%' OR coalesce(c.name_kana_romaji,'') LIKE ? || '%' THEN 1
      ELSE 2
    END`;
  const tierParams = [folded, folded, folded, folded, folded, folded];
  if ([...folded].length >= 3) {
    sql = `SELECT ${selectCols} FROM corp_fts f JOIN corporations c ON c.id = f.rowid WHERE corp_fts MATCH ?`;
    params.push(ftsPhrase(folded));
  } else {
    sql = `SELECT ${selectCols} FROM corporations c WHERE c.name_core LIKE ?`;
    params.push(`%${folded}%`);
  }
  if (prefCode) {
    sql += ` AND c.prefecture_code = ?`;
    params.push(prefCode);
  }
  params.push(...tierParams);
  sql += [...folded].length >= 3
    ? ` ORDER BY ${tierSql}, bm25(corp_fts) LIMIT ?`
    : ` ORDER BY ${tierSql}, length(c.name_core) LIMIT ?`;
  params.push(opts.limit);
  const r = await db.prepare(sql).bind(...params).all<CorpRow>();
  return r.results;
}

/** Corporate-number check-digit, verified against real NTA data 2026-10-11 —
 *  a first draft weighted the base digits 1,2,1,2,... and rejected every
 *  genuine number tested; the correct weights are 2,1,2,1,... from the most
 *  significant base digit. */
export function isValidFormat(raw: string): boolean {
  return /^\d{13}$/.test(raw);
}
export function checkDigitValid(raw: string): boolean {
  if (!isValidFormat(raw)) return false;
  const digits = raw.split('').map(Number);
  const check = digits[0];
  const base = digits.slice(1);
  let sum = 0;
  for (let i = 0; i < base.length; i++) sum += base[i] * (i % 2 === 0 ? 2 : 1);
  return 9 - (sum % 9) === check;
}

/** closure_event_text (process_type 71/72, where closure_date/
 *  closure_cause_code are NULL — a SEPARATE closure path from the
 *  784,482-row closure_date one) describes a merger event from EITHER
 *  side, and NTA's own wording is the only way to tell which: "...を合併"
 *  (absorbed [other]) names the SURVIVOR — this entity continues, e.g.
 *  Toyota Motor Corporation (1180301018771) absorbing a subsidiary; "...に
 *  合併し解散" (merged INTO [other] and DISSOLVED) names the entity that
 *  disappeared. Treating ANY closure_event_text as "closed" was wrong —
 *  caught live 2026-10-11 reporting Toyota Motor Corporation itself as
 *  closed_or_merged. The reliable signal is the word 解散 (dissolved)
 *  actually appearing in the text; process_type alone does not distinguish
 *  absorber from absorbed. */
function textSaysDissolved(text: string | null): boolean {
  return text != null && text.includes('解散');
}

export function shapeCorp(row: CorpRow) {
  const closed = row.closure_date != null || textSaysDissolved(row.closure_event_text);
  return {
    corporate_number: row.corporate_number,
    name: row.name,
    name_kana: row.name_kana,
    name_en: row.name_en,
    kind: row.kind,
    kind_label: row.kind ? KIND_LABELS[row.kind] ?? null : null,
    address: {
      prefecture: row.prefecture,
      city: row.city,
      rest: row.address_rest,
      postal_code: row.postal_code,
      en: row.name_en || row.address_en ? { prefecture: row.prefecture_en, address: row.address_en } : null,
    },
    status: closed ? 'closed_or_merged' : 'active',
    closure: closed
      ? {
          date: row.closure_date,
          cause_code: row.closure_cause_code,
          successor_corporate_number: row.successor_corporate_number,
          event_text: row.closure_event_text,
        }
      : null,
    assignment_date: row.assignment_date,
    last_update_date: row.update_date,
  };
}
