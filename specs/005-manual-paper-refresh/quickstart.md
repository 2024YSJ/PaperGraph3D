# Quickstart: Manual Paper Refresh

Validates this feature end-to-end offline, without a live network call, using stubbed provider functions and 003's `InMemoryFileStore` fake — no persisted test suite exists in this repo (`CLAUDE.md`).

## Prerequisites

- `npm install`
- 002's embedding modules (`src/collection/embedding.ts`, `embeddingUpgrade.ts`) are present on this branch (merged from `develop`, tasks.md T001, completed 2026-07-10).
- A scratch script run via the project's existing `esbuild` devDependency + `node` (matching 001/002/003's own `quickstart.md` approach).

## Setup

1. Build an `InMemoryFileStore` (003) and a `PaperStore` over it.
2. Seed the store with two `PaperRecord`s via `store.upsert(...)`:
   - **Paper A** (`arxiv:2301.00001`): `publicationYear` = current year, `citationCount = 0`, `citationsKnown = true`, a known `abstract`, `embedding` = a known non-null baseline vector, `embeddingModel` = `local-hashtf-v1-d2048`.
   - **Paper B** (`arxiv:2020.00002`): `publicationYear` = 5 years ago (outside the bulk window), `citationCount = 3`.
3. Create a `ConcurrencyGuard` via `createConcurrencyGuard()`.
4. Stub `fetchArxivEntryById` and `fetchSemanticScholarPaper`/`fetchSemanticScholarBatch` to return fixed payloads instead of calling `requestUrl`.
5. Use the real `computeBaselineEmbedding`/`upgradeEmbedding` (002, `provider: 'bundled'`) rather than stubbing them — they are pure/offline already, so no network stub is needed for the embedding path.

## Scenario 1 — Single-paper refresh updates citation + content, regenerates summary AND embedding on abstract change (User Story 1, SC-001/002/009/010/012)

1. Stub the arXiv lookup for Paper A to return a **changed abstract** and citation lookup to return `citationCount: 5`.
2. Call `refreshOne(store, 'arxiv:2301.00001', guard, { summarize: stubSummarize }, () => true, () => undefined, () => ({ provider: 'bundled' }))`.
3. Assert: outcome is `{ status: 'updated' }`; `store.get('arxiv:2301.00001')` reflects the new abstract and `citationCount: 5`, `citationsKnown: true`; `stubSummarize` was called exactly once (abstract changed → FR-014 fires); the stored `embedding` now equals `computeBaselineEmbedding(newTitle, newAbstract).embedding` — different from the seeded vector — with `embeddingModel: 'local-hashtf-v1-d2048'`, `embeddingSource: 'local'` (FR-019); the note's user body is byte-identical to before the refresh.

## Scenario 1b — Citation-only refresh leaves the embedding untouched (FR-019, SC-012)

1. Stub the arXiv lookup for Paper A to return the **same** title/abstract as stored, and citation lookup to return a different `citationCount`.
2. Call `refreshOne(...)` as above.
3. Assert: `store.get('arxiv:2301.00001')`'s `embedding`/`embeddingModel` are byte-identical to the value seeded in Setup step 2 — `computeBaselineEmbedding` is never invoked for this call.

## Scenario 1c — Embedding recomputation honors a non-bundled canonical provider (FR-019, research.md Decision 9)

1. Repeat Scenario 1's content change, but pass `getEmbeddingConfig: () => ({ provider: 'llm' })`.
2. Assert: since `upgradeEmbedding` returns `undefined` for `provider: 'llm'` (002's stub — no 004 hook implemented yet), the applied embedding falls back to `computeBaselineEmbedding`'s result with `embeddingSource: 'local'` — the refresh still completes as `{ status: 'updated' }`, never blocked by the unimplemented LLM path.

## Scenario 1d — A single-paper refresh never touches any other saved paper (FR-004, SC-003)

1. Record Paper B's full stored state (record + note) before calling `refreshOne`.
2. Repeat Scenario 1's content-changing refresh for Paper A only.
3. Assert: Paper B's stored record and note are byte-identical to what was recorded in step 1 — no field, timestamp, or embedding on Paper B changed as a side effect of refreshing Paper A.

## Scenario 2 — Citation-status flip alone triggers regeneration, no double-call (FR-020, SC-010)

1. Reset Paper A's stored `citationCount` to `0`. Stub the arXiv lookup to return the **same** abstract (no content change) and citation lookup to return `citationCount: 2`.
2. Call `refreshOne(...)` as above.
3. Assert: `stubSummarize` was called exactly once (status flip 0→nonzero, abstract unchanged); `store.get(...)`'s `embedding` is unchanged (content didn't change — Scenario 1b's rule applies independently).
4. Repeat with a stub returning `citationCount: 0` on top of a stored nonzero value (cited → uncited) and confirm a regeneration call again.
5. Set Paper A to **un-enriched** (`citationsKnown: false`, `citationCount: 0`). Stub the citation lookup to return a confirmed `citationCount: 0`; assert `stubSummarize` **is** called (un-enriched → confirmed-uncited: `isUncited` false→true, FR-020) — a bare-count rule would have missed this.
6. With Paper A again un-enriched (`citationsKnown: false`, `citationCount: 0`), stub the citation lookup to return `citationCount: 4`; assert `stubSummarize` is **not** called (un-enriched → cited, summary-only both ways — `isUncited` stays false).
7. Repeat with a stub changing `citationCount` from `5` to `9` (both confirmed, same uncited status) and confirm `stubSummarize` is **not** called.

## Scenario 3 — Paper not found leaves data untouched (FR-005, SC-004)

1. Stub the arXiv lookup for Paper A to return `undefined` (no entry).
2. Call `refreshOne(...)`.
3. Assert: outcome is `{ status: 'notFound' }`; `store.get('arxiv:2301.00001')` is unchanged from before the call.

## Scenario 3b — Refreshing a sourceId absent from the store fails before any provider call (FR-021)

1. Call `refreshOne(store, 'arxiv:9999.99999', guard, hooks, () => true, () => undefined, () => ({ provider: 'bundled' }))` for a sourceId never seeded into the store.
2. Assert: outcome is `{ status: 'notFound' }`; neither `fetchArxivEntryById` nor any Semantic Scholar stub was invoked.

## Scenario 3c — A Semantic Scholar-only failure still updates content, preserves prior citation data (FR-021)

1. Stub the arXiv lookup for Paper A to return a **changed abstract**, and stub the Semantic Scholar single-paper lookup to fail/return no record.
2. Call `refreshOne(...)`.
3. Assert: outcome is `{ status: 'updated' }` (not `'error'`); the stored abstract reflects the new content and the embedding was recomputed (FR-019); `citationCount`/`references`/`citationsKnown` are unchanged from what was stored before the call. (`stubSummarize` *is* called here — the abstract changed, FR-014(a).)
4. Repeat with an **unchanged** abstract and Semantic Scholar still unavailable; assert `stubSummarize` is **not** called — the carried-through citation values yield no `isUncited` change (FR-021), so neither trigger fires and the citation fields stay as previously stored.

## Scenario 4 — Concurrent refresh of the same paper is rejected (FR-006)

1. Call `refreshOne` twice back-to-back for Paper A without awaiting the first (simulate overlap by calling `guard.claimSingle` manually before the second call).
2. Assert: the second call's outcome is `{ status: 'alreadyInFlight' }`.

## Scenario 5 — Bulk refresh touches only the last-year window, batches citation lookups, survives one failure (User Story 2, SC-006/007/008/011)

1. Seed a third paper, **Paper C** (`arxiv:2301.00003`), with `publicationYear` = current year (within the `publicationYear >= currentYear - 1` window, FR-009).
2. Stub `fetchSemanticScholarBatch` to return citation data for both Paper A and Paper C in one call; assert it was called **exactly once** regardless of matched-paper count (SC-011).
3. Stub `fetchArxivEntryById` to succeed for Paper A and return `undefined` (not found) for Paper C.
4. Call `runBulkRefresh(store, guard, hooks, () => true, () => undefined, () => ({ provider: 'bundled' }), onProgress)`.
5. Assert: `matchedCount === 2` (Paper B, outside the window, was never touched — assert its stored record is unchanged); `failures` contains exactly one entry for Paper C; `onProgress` was invoked twice with an increasing `done` count; Paper A's record reflects the refreshed data including a recomputed embedding.

## Scenario 6 — A second bulk trigger while one is running is rejected (FR-012, Edge Cases)

1. Start `runBulkRefresh(...)` without awaiting it.
2. Call `runBulkRefresh(...)` again immediately.
3. Assert: the second call resolves to `{ status: 'alreadyRunning' }` without touching any paper.

## Scenario 7 — Cancelling a running bulk refresh stops it cleanly (FR-022, SC-013)

1. Seed four matching papers (extending Scenario 5's setup) so the bulk run has enough iterations to interrupt mid-run; stub each paper's arXiv/citation lookups to succeed.
2. Start `runBulkRefresh(store, guard, hooks, () => true, () => undefined, () => ({ provider: 'bundled' }), onProgress)` without awaiting it.
3. Once `onProgress` reports the first paper done (`done === 1`), call `guard.requestBulkCancel()`.
4. Await the `runBulkRefresh` call's resolution.
5. Assert: `matchedCount` reflects only the papers actually processed before the cancellation took effect (at least 1, fewer than the full seeded set); the processed paper(s)' records reflect their refreshed data; the remaining seeded papers are byte-identical to their pre-run state; `guard.isBulkCancelRequested()` is `false` again (cleared by `releaseBulk`); a subsequent `runBulkRefresh(...)` call immediately after does not resolve to `{ status: 'alreadyRunning' }`.

## Expected outcome

All scenarios pass with `tsc --noEmit` clean and `eslint .` clean, confirming: FR-001–FR-022 and SC-001–SC-013 behave as specified, using only stubbed arXiv/Semantic Scholar provider functions plus 002's real (offline) embedding functions and the in-memory persistence fake — no live network call is made during verification.
