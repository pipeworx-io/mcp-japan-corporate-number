interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * japan-corporate-number — Japan's National Tax Agency (国税庁) corporate
 * number register (法人番号公表サイト). Fleet #2928.
 *
 * Every Japanese corporation, government body and registered organization
 * has a 13-digit 法人番号 assigned by NTA since 2015-10-05. This pack serves
 * the whole-country register NTA publishes monthly: 5,837,980 entities as of
 * the 2026-09-30 cut, loaded into a D1 database
 * (scripts/japan-corporate-number/refresh.sh, see README "Refresh"). The
 * route NTA itself publishes this through is not repeated here — see Bruce's
 * standing rule, CLAUDE.md step 9b (a4c024647): name the source, never the
 * source file/path/form fields. That mechanical detail lives ONLY in
 * refresh.sh and build-local-db.mjs.
 *
 * gBizINFO (mcps/gbizinfo) is a DIFFERENT source (METI) hanging government
 * records — procurement, subsidies, patents, financials — off the same
 * corporate number; it has richer per-company detail but partial coverage.
 * This pack is the complete spine: every registered corporate number, name,
 * address and status, from NTA directly. Use gbizinfo for the government
 * records; use this pack to resolve a number, validate one, or find a
 * company by name.
 *
 * "Japanese and romanised matching": NTA's own file carries an official
 * English name, English address and katakana reading for a SUBSET of
 * entities (15,352 of 5,837,980 have an English name; 3,566,151 of
 * 5,837,980 have a katakana reading, measured against the 2026-09-30 cut).
 * jp_company_search matches against whichever of these NTA actually
 * published — it does not invent a romanisation for a company that has
 * none. See README "Reuse & known gaps".
 *
 * Every response carries `data_as_of` (when the loaded file was cut, per
 * NTA) and `source` (publisher + dataset). A number that is correctly formatted but
 * not found returns `found: false` with a reason, never an empty object; a
 * malformed or check-digit-invalid number is rejected with a loud message
 * naming which check failed, never silently treated as "not found".
 */
import {
  checkDigitValid,
  dataAsOf,
  findByNumber,
  isLatinQuery,
  isValidFormat,
  queryCore,
  requireDb,
  rowCount,
  searchByName,
  type SearchRow,
  shapeCorp,
  SOURCE,
} from './store.js';
import { GLEIF_SOURCE, gleifBridge } from './gleif-bridge.js';

const tools: McpToolExport['tools'] = [
  {
    name: 'jp_corporate_number',
    description:
      'Look up one Japanese corporation/organization by its 13-digit 法人番号 (corporate number) in Japan\'s National Tax Agency register: legal name, katakana reading and English name when NTA holds one, address, corporate-kind (stock company, LLC, government body, etc.) and status (active, or closed/merged with the date and successor number). Validates the check digit before looking up. Use for "what company is corporate number 1234567890123", verifying a Japanese business is real, or resolving a 法人番号 found elsewhere.',
    summary: "Look up a Japanese company/organization by its 13-digit NTA corporate number.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        number: { type: 'string', description: 'The 13-digit 法人番号 (corporate number), digits only, e.g. "1000012160153".' },
      },
      required: ['number'],
    },
  },
  {
    name: 'jp_company_search',
    description:
      'Search Japan\'s National Tax Agency corporate-number register by name — Japanese (kanji/katakana, substring match; 株式会社/(株)/㈱/有限会社/合同会社 accepted as prefix or suffix), the official English name/katakana reading NTA holds for some entities, or the English name GLEIF holds for entities with an LEI ("Sony Group", "Toyota Motor Corporation"). Optionally filter by prefecture (Japanese name, English name, or 2-digit code). Returns each match\'s corporate number, name, kind and address so you can pick the right one, then call jp_corporate_number for full detail. Covers 5.8M registered entities: companies, government bodies, NPOs, foundations.',
    summary: 'Search Japan\'s NTA corporate-number register by Japanese or romanised company name.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Company/organization name or part of it, in Japanese or (when NTA published one) English — e.g. "トヨタ", "Toyota", "株式会社".' },
        prefecture: { type: 'string', description: 'Optional prefecture filter: Japanese name ("北海道"), English name ("Hokkaido"), or 2-digit code ("01").' },
        limit: { type: 'number', description: 'Maximum results (1-50, default 10).' },
      },
      required: ['name'],
    },
  },
];

function clamp(v: unknown, lo: number, hi: number, d: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(hi, Math.max(lo, n)) : d;
}

async function numberTool(db: ReturnType<typeof requireDb>, args: Record<string, unknown>) {
  const raw = String(args.number ?? '').replace(/[^\d]/g, '');
  const asOf = await dataAsOf(db);
  if (!isValidFormat(raw)) {
    return {
      found: false,
      reason: 'bad_format',
      message: `${JSON.stringify(args.number ?? null)} is not a 13-digit 法人番号.`,
      data_as_of: asOf,
      source: SOURCE,
    };
  }
  if (!checkDigitValid(raw)) {
    return {
      found: false,
      reason: 'bad_check_digit',
      message: `${raw} has 13 digits but fails the 法人番号 check-digit formula, so it is not a valid corporate number.`,
      data_as_of: asOf,
      source: SOURCE,
    };
  }
  const row = await findByNumber(db, raw);
  if (!row) {
    return {
      found: false,
      reason: 'not_in_register',
      number: raw,
      message: `${raw} is a correctly formatted, check-digit-valid 法人番号, but is not in the register as of ${asOf ?? 'the last load'}.`,
      hint: 'A number issued after the register was last refreshed would not appear yet — see README "Refresh".',
      data_as_of: asOf,
      source: SOURCE,
    };
  }
  return { found: true, ...shapeCorp(row), data_as_of: asOf, source: SOURCE };
}

async function searchTool(db: ReturnType<typeof requireDb>, args: Record<string, unknown>) {
  const name = String(args.name ?? '').trim();
  if (!name) throw new Error('name is required');
  const limit = clamp(args.limit, 1, 50, 10);
  const prefecture = args.prefecture != null && args.prefecture !== '' ? String(args.prefecture) : undefined;
  // GLEIF bridge (fleet #3020): English names NTA never published ("Sony
  // Group", "Toyota Motor Corporation") and which of many namesakes is the
  // well-known one. Runs alongside the register read; fail-open.
  const bridgeQuery = isLatinQuery(name) ? name.normalize('NFKC').trim() : queryCore(name);
  const [asOf, bridge] = await Promise.all([dataAsOf(db), bridgeQuery ? gleifBridge(bridgeQuery) : Promise.resolve(null)]);
  const rows: SearchRow[] = await searchByName(db, { query: name, prefecture, limit, bridge: bridge?.hits });
  const nameBridge = bridge ? { source: GLEIF_SOURCE, status: bridge.status, matched: bridge.hits.length } : null;
  if (!rows.length) {
    return {
      found: false,
      reason: 'no_match',
      query: name,
      prefecture: prefecture ?? null,
      message: `No entity in the register matched ${JSON.stringify(name)}${prefecture ? ` in ${prefecture}` : ''}.`,
      hint: 'Japanese substring search needs no exact match. A romanised name matches the English names NTA published, the romanised katakana reading, or an English name GLEIF holds for an entity with an LEI.',
      name_bridge: nameBridge,
      data_as_of: asOf,
      source: SOURCE,
    };
  }
  return {
    found: true,
    query: name,
    prefecture: prefecture ?? null,
    returned: rows.length,
    results: rows.map((r) => ({
      ...shapeCorp(r),
      lei: r.lei ?? null,
      matched_via: r.lei ? 'gleif_lei_bridge' : 'register_name',
    })),
    name_bridge: nameBridge,
    data_as_of: asOf,
    source: SOURCE,
  };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const db = requireDb(args._d1);
  switch (name) {
    case 'jp_corporate_number':
      return numberTool(db, args);
    case 'jp_company_search':
      return searchTool(db, args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export { rowCount };
export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
