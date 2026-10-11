# @pipeworx/japan-corporate-number

Japan's National Tax Agency (国税庁) corporate-number register
(法人番号公表サイト) — the complete spine of every
13-digit 法人番号 issued since 2015-10-05: legal name, katakana reading and
English name when NTA holds one, address, corporate kind (stock company,
LLC, government body, NPO, etc.) and status (active, or closed/merged with
the narrative NTA published). 5,837,980 entities as of the 2026-09-30 cut.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1769+ live data sources. This is an independent, unofficial integration — not affiliated with, endorsed by, or published by the upstream provider.

`gBizINFO` (`mcps/gbizinfo`, METI) is a **different** source hanging richer
government records — procurement, subsidies, patents, financials — off the
same corporate number, with **partial** coverage. This pack is the complete
spine (every registered number, from NTA directly); use gbizinfo for the
government-record detail once you have a number.

## Tools

- `jp_corporate_number(number)` — look up one entity by its 13-digit 法人番号.
  Validates the check digit before looking up (see "Check digit" below) and
  returns `found: false` with a `reason` for a malformed number, a
  check-digit failure, or a correctly-formed number simply not in the
  register — never an empty object.
- `jp_company_search(name, prefecture?, limit?)` — search by Japanese name
  (substring, corporate-suffix-insensitive) or, for the subset of entities
  NTA published one for, an English name/katakana reading. `prefecture`
  accepts a Japanese name, an English name, or a 2-digit code.

## Auth

Keyless. The gateway supplies the data directly — no caller-facing key, and
no vendor key of any kind (the register is published as a monthly file, not a
live API). The tools work only through the hosted gateway: a standalone build
has no data to read and returns a loud error (`StoreUnavailableError`) naming
that, never an empty result.

## Data source & reuse terms

- Japan National Tax Agency (国税庁), Corporate Number Publication Site
  (法人番号公表サイト) — the whole-country corporate-number register, published
  monthly. Pipeworx loads each monthly edition; `data_as_of` on every response
  is when the loaded edition was taken. The fetch mechanics (and the verified
  column mapping) live only in `scripts/japan-corporate-number/README.md`,
  which does not publish — CLAUDE.md step 9b (a4c024647): name the source,
  never the source file/path/form fields.
- **Terms of use** (Japan's Public Data License v1.0, quoted from NTA's
  terms-of-use page): attribution is required
  ("本コンテンツを利用する際は出典を記載してください" — when using this
  content, state the source); edits/derivative processing must be disclosed
  separately from the attribution; and edited/processed data must never be
  presented as though the government itself produced it
  ("編集・加工等した情報を、あたかも国（又は府省等）が作成したかのような
  態様で公表・利用することは禁止します"). Otherwise permissive — commercial
  reuse and redistribution are not restricted. This README and every tool
  response carry the source and `data_as_of`; the data is NTA's, reformatted
  by Pipeworx, never presented as government-produced.

### Kind codes (法人種別)

The complete set observed: `101` national government organization, `201`
local government, `301` Kabushiki Kaisha (stock company), `302` Godo Kaisha
(LLC-equivalent), `303` Gomei Kaisha, `304` Goshi Kaisha, `305` other
registered corporation (e.g. incorporated association/foundation), `399`
other, `499` foreign company etc. Labels are best-effort English glosses of
NTA's standard code table; the raw code is always returned alongside the
label.

### Status — a real correctness trap (and a second one inside it)

A corporation closed by **merger** (process_type `71`/`72`, ~31,000
entities) carries `closure_event_text` (a Japanese sentence naming the
other party) but **`closure_date` and `closure_cause_code` are NULL**
for these rows — that pair is populated by a *different* closure
mechanism entirely (mostly process_type `21`, ~784K rows), which mostly has
no `closure_event_text`. Checking `closure_date` alone misses every
merged-away entity.

The trap inside the trap: `closure_event_text` describes a merger from
**either** side, and only the wording says which. "...を合併" (absorbed
[other]) names the SURVIVOR — this entity continues (e.g. Toyota Motor
Corporation absorbing a subsidiary). "...に合併し解散" (merged INTO [other]
and DISSOLVED) names the entity that disappeared. Treating any
`closure_event_text` as closed is wrong — found live reporting an active,
operating company as closed. `status` is `closed_or_merged` when
`closure_date` is set, OR `closure_event_text` is set AND literally
contains 解散 ("dissolved").

## Check digit

A 法人番号's first digit is a check digit over the other 12 (most
significant first), weighted `2,1,2,1,...` (the most significant base digit
carries weight 2), summed, mod 9, check = `9 - (sum mod 9)`. Verified against
real numbers from the register (`1000012160153`, `1000013050386`,
`1000013050394` all pass; the naive "textbook" weighting `1,2,1,2,...`
fails all three). `jp_corporate_number` validates this before looking up, so
a malformed or impossible number gets a specific `bad_format` /
`bad_check_digit` reason rather than a bare "not found".

## "Japanese and romanised matching" — what this is and is not

`jp_company_search` matches a single FTS5 trigram index over the Japanese
core name (corporate-suffix stripped, e.g. "株式会社" / "K.K." both fold
away), the English name, and the katakana reading — whichever of these NTA
actually published for that entity. It is **not** a transliterator: a
company with no registered English name/kana will not be found by a
romanised query that NTA never recorded. `prefecture` is resolved against a
static 47-prefecture table (`src/prefectures.ts`) so it works by Japanese
name, English name, or code regardless of whether the matched *company*
registered an English address — filtering on the register's own
per-company `prefecture_en` column directly would silently miss almost
every entity in a prefecture whose companies have no English name at all.

FTS5's trigram tokenizer windows by **character**, not byte: a query under 3
characters produces no trigrams and matches nothing via `MATCH` even when
it is a real substring (verified: a 2-character Japanese query returns 0
rows via FTS, 5+ via `LIKE`, for an identical string). `jp_company_search`
falls back to a plain substring scan for any query under 3 characters.

Refresh and dupe-check notes: see `scripts/japan-corporate-number/README.md`
(operator-only, does not publish) and `gbizinfo` above.

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "japan-corporate-number": {
      "url": "https://gateway.pipeworx.io/japan-corporate-number/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/japan-corporate-number/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1769+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## No MCP client? Call it over HTTP

```bash
curl -X POST https://gateway.pipeworx.io/v1/tools/jp_corporate_number \
  -H 'Content-Type: application/json' \
  -d '{"number":"1000012160153"}'
```

No account needed for the first calls. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/jp_corporate_number`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.

## Standalone (no gateway account)

This package also runs as a local stdio MCP server — no Pipeworx account, no
gateway round-trip:

```json
{
  "mcpServers": {
    "japan-corporate-number": {
      "command": "npx",
      "args": ["-y", "@pipeworx/mcp-japan-corporate-number"]
    }
  }
}
```

Or run it directly to confirm it starts:

```bash
npx -y @pipeworx/mcp-japan-corporate-number
```

It speaks MCP over stdin/stdout and answers `initialize`/`tools/list`/`tools/call`
for **only** this pack's tools — none of the shared meta-tools the gateway
connection above adds. Same source, same tools, no ask_pipeworx routing.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Japan Corporate Number data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
