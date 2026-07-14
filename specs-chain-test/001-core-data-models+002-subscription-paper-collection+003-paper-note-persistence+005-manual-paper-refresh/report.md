# Chain-test report

**Chain**: `001-core-data-models → 002-subscription-paper-collection → 003-paper-note-persistence → 005-manual-paper-refresh` (upstream → downstream)

- **Source branch**: `develop-feature/005-manual-paper-refresh`
- **Date**: 2026-07-11
- **`tsc --noEmit`**: PASS (src/ type-checks)
- **Result**: **11 passed / 0 failed / 1 skipped**

## Verification method

Derived cross-spec scenarios at both required levels — per-seam (`C1`–`C10`) and
whole-system end-to-end (`E1`, `E2`) — and ran them against the **real** `src/` exports of
all four specs via esbuild + node (the repo's no-test-runner convention). Each chain
scenario builds an artifact with the upstream spec's real API and consumes it with the
downstream spec's real API, asserting the downstream integration invariant.

`obsidian` is aliased to a **programmable** `requestUrl` shim (`_obsidian-shim.ts`) and a
`DOMParser` polyfill reconstructs fake `<entry>` elements, so 002's real batch-enrichment
client and 005's real arXiv/Semantic Scholar clients + parsers run end-to-end against
deterministic responses — **no live network call**. The 002 leg is driven through the real
`runCollectionPass` (candidates supplied directly, so no arXiv discovery network is
needed; enrichment flows through the shim), exercising the genuine dedup → enrich →
`promote` (001 `toPaper`) → baseline-embedding attach (002 FR-044) → persist-hook (003
`PaperStore.upsert`) path.

Run command (bare-specifier `obsidian` alias is CLI-legal; the `@huggingface/transformers`
dynamic import on the unused local-transformer path is external):

```bash
CID="001-core-data-models+002-subscription-paper-collection+003-paper-note-persistence+005-manual-paper-refresh"
npx esbuild "specs-chain-test/$CID/$CID.chain-test.ts" --bundle --platform=node --format=cjs \
  --alias:obsidian=./specs-chain-test/$CID/_obsidian-shim.ts \
  --external:@huggingface/transformers --outfile="$TMP" && node "$TMP"; rm -f "$TMP"
```

## Seam map

| Adjacent pair | Seam(s) | Status |
|---------------|---------|--------|
| 001 → 002 | `promote()`/`toPaper()` lifts a `PaperCandidate` to a validated `Paper`; enrichment sets `citationsKnown`; missing/NaN year is held back | **Exercised** (both sides implemented) — C1, C2 |
| 002 → 001 | `computeBaselineEmbedding` output populates `Paper.embedding`/`embeddingModel`/`embeddingSource`, still `isValidPaper` (incl. pending null) | **Exercised** — C3 |
| 002/001 → 003 | promoted `Paper` wrapped into the record + note pairing; note frontmatter mirrors the shared subset only | **Exercised** — C4, C5 |
| 002 → 005 | refresh recomputes embedding via 002's `computeBaselineEmbedding`; applies citations via 002's `parseSemanticScholarPaper`/`toPaperSourceId` (version-stripped) | **Exercised** — C6, C7 |
| 003 → 005 | refresh reads via `PaperStore.get`, writes via `PaperStore.upsert`, preserving the user note body; absent sourceId short-circuits with no provider call/write | **Exercised** — C8, C9 |
| 002/003 → 005 (bulk) | `runBulkRefresh` batches both the arXiv content re-fetch (FR-015, corrected 2026-07-11) and the Semantic Scholar citation lookup (FR-018) into one request each for the whole matched set, then applies each result through 003's real pairing; the FR-009 last-year window still excludes older papers | **Exercised** — C10 |

All seams in this chain are implemented; there are **no SKIP-for-missing-downstream**
links. (004 summarization is not part of this chain and is injected as a hook that both
002 and 005 leave off here.)

## Whole-system flow

Threaded a single artifact head-to-tail through **every** implemented seam in chain order:

```
candidate (001 shape)
  → runCollectionPass (002): dedup → batched enrich (shim) → promote (001 toPaper)
    → attach baseline embedding (002 FR-044) → persist hook (003 PaperStore.upsert)
  → refreshOne (005): arXiv content re-fetch (newer revision) + S2 citations
    → recompute embedding (002 fn) → write through 003 pairing
  → PaperStore.get (003): read back
```

The artifact travelled the **entire** chain (no seam was unimplemented). `E1` asserts the
emergent, whole-chain invariants that no single-seam or single-spec test catches:

- the artifact stays `isValidPaper` (001) after `001→002→003→005→003`;
- enrichment (citations + version-stripped reference sourceId) threaded through promotion
  survives persistence and is read back;
- the baseline embedding attached at collection (002) and the one recomputed at refresh
  (005) both equal 002's own `computeBaselineEmbedding` of the then-current content;
- `publicationYear` (the 002 year-gate / 005 bulk-window key) stayed stable across the
  whole chain;
- the user-owned note region written between collection and refresh is untouched end-to-end.

`E2` (an LLM-canonical embedding threaded through the same chain) is SKIP: 002's
`upgradeEmbedding` returns `undefined` for the `llm` provider (a 004-owned stub), so the
non-bundled canonical path has no implemented behavior to thread yet. The chain is fully
exercised on the bundled canonical provider by `E1`.

## Results

| id | pair / seam | status | note |
|----|-------------|--------|------|
| C1 | [001→002] promote → valid Paper; citationsKnown mirrors enrichment | PASS | enriched & un-enriched both covered |
| C2 | [001→002 negative] rejected candidate (missing/NaN year) never promotes | PASS | producer gate protects everything downstream |
| C3 | [002→001] baseline embedding → 001-valid embedded Paper | PASS | 2048-dim; pending null also valid |
| C4 | [002/001→003] Paper round-trips through store; frontmatter mirrors subset | PASS | get() deep-equals; 5 shared fields checked |
| C5 | [001/002→003 negative] non-subset fields don't leak into frontmatter | PASS | references/schemaVersion/timestamps/embedding/abstract absent |
| C6 | [002→005] content-change refresh recomputes embedding via 002 fn | PASS | equals computeBaselineEmbedding(new content) |
| C7 | [002→005] refresh applies citations via 002 parser | PASS | version suffix stripped across the seam |
| C8 | [003→005] refresh reads/writes via 003 store; user body preserved | PASS | |
| C9 | [003→005 negative] absent sourceId: no provider call, no write | PASS | |
| C10 | [002/003→005 bulk] batched arXiv+S2 across multiple real 002/003 papers, out-of-window untouched, user note preserved | PASS | one arXiv call + one S2 batch call cover both in-window papers |
| E1 | [system] candidate → 002 pipeline → 003 → 005 → 003 stays 001-valid | PASS | whole-chain emergent invariants |
| E2 | [system] LLM-canonical embedding threaded through the chain | SKIP | 002's llm upgrade is a 004-owned stub (returns undefined) |

## Known residual limitations

Cross-spec behaviors outside this suite's asserted scope (notes, not failures):

- **Semantic Scholar transient-failure retry** (429/networkError with a real 3 s backoff in
  `semanticScholarClient.ts`) is not threaded through the chain; provider-absence uses the
  immediate `404`/`terminalAbsence` form to keep runtime bounded. The carried-through-on-
  failure behavior is identical for either shape at the 002/005 boundaries.
- **arXiv Atom parsing** in the 005 leg runs through a fake-element `DOMParser` polyfill
  (real `fetchArxivEntryById`/`parseArxivEntry` control flow), not literal Atom XML bytes,
  because `@xmldom/xmldom` is not installed on this branch. Raw-XML tokenization is 002's
  concern and covered by 002's own spec-test.
- **The non-bundled canonical embedding seam** (002 `local-transformer`/`llm` upgrade
  threaded into 005's recompute) is not exercised end-to-end (E2 SKIP) — 002's `llm`
  upgrade is a stub and the `local-transformer` path requires a user-supplied model.
- **003 write ordering / crash-recovery** (tombstones, orphan reconciliation) is 003's
  internal concern, not a cross-spec seam; not asserted here.

No behavior asserted by this suite contradicts a stated cross-spec integration invariant.

## Raw test run output

```text
[PASS] C1 — [001→002] promote() lifts a candidate to a 001-valid Paper; citationsKnown mirrors enrichment
[PASS] C2 — [001→002 negative] a candidate 001 rejects (missing/NaN year) never promotes — nothing can flow downstream
[PASS] C3 — [002→001 embedding] 002's baseline embedding produces a 001-valid embedded Paper
[PASS] C4 — [002/001→003] a promoted+embedded Paper round-trips through 003 store; note frontmatter mirrors the shared subset
[PASS] C5 — [001/002→003 negative] fields OUTSIDE the shared subset do not leak into the note frontmatter (003 FR-002)
[PASS] C6 — [002→005] a content-changing refresh recomputes the embedding via 002's computeBaselineEmbedding
[PASS] C7 — [002→005] a single refresh applies citations parsed by 002's parseSemanticScholarPaper/toPaperSourceId
[PASS] C8 — [003→005] refresh reads via 003 get() and writes via 003 upsert(); the user-owned note body is preserved
[PASS] C9 — [003→005 negative] refresh of a sourceId absent from the 003 store makes no provider call and writes nothing
[PASS] C10 — [002/003→005 bulk] runBulkRefresh batches arXiv content + S2 citations across multiple 002/003-real papers, applies each through 003, leaves out-of-window papers and user notes untouched
[PASS] E1 — [system] candidate → REAL 002 pipeline → 003 store → 005 refresh → 003 read-back stays 001-valid throughout
[SKIP] E2 — [system] LLM-canonical embedding threaded through collection + refresh (the 004-owned LLM embedding provider is a stub in 002 (upgradeEmbedding returns undefined for llm); the whole chain is exercised on the bundled canonical provider by E1)

Summary: 11 passed, 0 failed, 1 skipped
```
