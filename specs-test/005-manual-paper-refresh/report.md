# Spec-test report: 005-manual-paper-refresh

- **Spec**: `specs/005-manual-paper-refresh/spec.md`
- **Source branch**: `develop-feature/005-manual-paper-refresh`
- **Date**: 2026-07-11
- **`tsc --noEmit`**: PASS (src/ type-checks)
- **Result**: **29 passed / 0 failed / 3 skipped**

## Verification method

Derived one test per Acceptance Scenario (US1.1–US1.5, US2.1–US2.6), per Success
Criterion (SC-001–SC-013), and per concrete-outcome Edge Case in `spec.md`. Run against
the **real** `src/refresh/{refreshOne,bulkRefresh,concurrencyGuard,summaryTrigger,
embeddingRecompute}.ts`, `src/collection/{arxivClient,semanticScholarClient,arxivParser,
semanticScholarParser,embedding,embeddingUpgrade}.ts`, and `src/persistence/store.ts`
exports via esbuild + node (the repo's no-test-runner convention).

The `obsidian` module is aliased to `_obsidian-shim.ts`, whose `requestUrl` is
**programmable** (returns crafted, deterministic arXiv/Semantic Scholar responses stashed
on `globalThis.__api`) — required because 005's behavioral scenarios (a changed abstract,
a citation-count flip, a provider failure) cannot be produced on demand by the live APIs.
A minimal `DOMParser` polyfill in the test reconstructs fake `<entry>` elements from the
shim's response text, so the real `fetchArxivEntryById` + `parseArxivEntry` +
`fetchSemanticScholar{Paper,Batch}` + `parseSemanticScholarPaper` code runs end-to-end.
Embedding uses 002's real (offline) `computeBaselineEmbedding`/`upgradeEmbedding`. **No
live network call is made.**

Run command (bare-specifier `obsidian` alias is CLI-legal; `@huggingface/transformers`,
dynamically imported only on the unused `local-transformer` path, is marked external):

```bash
npx esbuild specs-test/005-manual-paper-refresh/005-manual-paper-refresh.spec-test.ts \
  --bundle --platform=node --format=cjs \
  --alias:obsidian=./specs-test/005-manual-paper-refresh/_obsidian-shim.ts \
  --external:@huggingface/transformers --outfile="$TMP" && node "$TMP"; rm -f "$TMP"
```

## Results

| id | scenario / SC | status | note |
|----|---------------|--------|------|
| US1.1 | Re-check citation/refs/title/abstract/authors; publicationYear stable | PASS | |
| US1.2 | Update existing record + note managed region (not a new note); body preserved | PASS | Managed region shows regenerated summary; abstract updated in the JSON record |
| US1.3 | Abstract change → regenerate once; disabled → no 004 but fields still update | PASS | |
| US1.4 | Embedding recomputed on abstract change; unchanged content leaves it | PASS | |
| US1.5 | Refreshing one paper leaves others unaffected | PASS | |
| US2.1 | Bulk re-checks only last-year papers | PASS | |
| US2.2 | Progress (done vs total) reported as it proceeds | PASS | |
| US2.3 | One failure doesn't stop the rest; failures collected | PASS | |
| US2.4 | Bulk skips a paper a single refresh already holds (no double-refresh) | PASS | |
| US2.5 | Rate-limit → more conservative pacing without aborting | SKIP | Adaptive backoff delay is internal to bulkRefresh with no observable signal at this layer; non-abort half covered by US2.3/SC-008 |
| US2.6 | Cancel stops before next paper; processed kept, unreached untouched, immediate restart | PASS | |
| SC-001 | Citation count reflects latest provider value | PASS | |
| SC-002 | User-written body unchanged | PASS | |
| SC-003 | Non-requested papers: zero changes | PASS | |
| SC-004 | arXiv-fail / not-found / store-absent kept intact; S2-only failure does not trigger it | PASS | |
| SC-004-notify | User is informed of the failure | SKIP | On-screen notice is 008's surface; refresh returns the outcome status only (spec Assumptions) |
| SC-005 | In-progress paper never processed twice concurrently | PASS | |
| SC-006 | Bulk touches exactly the last-year set; zero outside modified | PASS | |
| SC-007 | Completes without blocking, well under 3s/paper | PASS | 3-paper proxy; elapsed ≪ 9s and one batch call |
| SC-007-scale | 100+ paper bulk stays responsive under real timing | SKIP | Literal 100+ scale is a manual/008-owned observation; asserted structurally with a small-N proxy |
| SC-008 | Failures never abort; all attempted; one summary | PASS | |
| SC-009 | Title/abstract/authors match provider's current (newer revision), no version bookkeeping | PASS | |
| SC-010 | Regenerate iff (abstract ∨ uncited-flip) ∧ enabled; both → one; else zero | PASS | |
| SC-011 | Bulk issues ⌈N/500⌉ citation requests (typically 1), never N | PASS | 6 papers → 1 batch, 0 single |
| SC-012 | Embedding recomputed iff title/abstract changed | PASS | Title-only change also recomputes |
| SC-013 | Cancelled bulk: zero partial, processed full, unreached byte-identical, immediate restart | PASS | |
| EC-store-absent | Absent sourceId fails before any provider call | PASS | |
| EC-bulk-already-running | Second bulk trigger rejected, not concurrent | PASS | |
| EC-abstract-unchanged | Unchanged content refreshes with no 004 call | PASS | |
| EC-summarization-off-midflight | Toggled off mid-flight discards the stale summary | PASS | Note shows abstract, not GEN SUMMARY |
| EC-citation-status-matrix | Regeneration fires only on a confirmed uncited-status flip | PASS | 5 sub-cases incl. un-enriched→confirmed-uncited and false→true-at-nonzero |
| EC-bulk-batches-citations-arxiv-individual | Bulk batches citations, fetches arXiv per paper | PASS | 3 papers → 1 batch + 3 arXiv |

## Known residual limitations

These are edge behaviors outside this suite's asserted scope (notes, not failures):

- **Semantic Scholar transient-failure retry/backoff not exercised.** Provider-absence is
  simulated with an HTTP `404` (the client's immediate no-retry path). The
  `429`/`networkError` paths retry with a real 3 s (`S2_RETRY_DELAY_MS`) delay in
  `semanticScholarClient.ts`; exercising them would add multi-second sleeps, and that
  retry behavior belongs to feature 002 (covered by its own spec-test). FR-021's "fails or
  reports no record" guarantee is verified via the `404` form; the carried-through-on-
  failure behavior is identical for either failure shape in `refreshOne` (both leave
  `citationCount`/`references`/`citationsKnown` untouched).
- **arXiv Atom parsing uses a fake-element DOMParser polyfill**, not literal Atom XML
  bytes, because `@xmldom/xmldom` is not installed on this branch. The real
  `fetchArxivEntryById`/`parseArxivEntry` control flow runs (id_list lookup → entry
  presence/absence → field extraction → `undefined`-year handling), but the raw
  XML-string tokenization is not re-exercised here (it is 002's concern and covered by
  002's spec-test).
- **US2.5 adaptive pacing and SC-007 100+ scale/UI-responsiveness** are internal timing /
  manual-observation properties (skipped, as noted above) — the observable halves (no
  abort on failure; sub-3s/paper completion; single batched citation call) are asserted.
- **SC-004 user-notification** is delegated to feature 008 (skipped as `SC-004-notify`);
  `src/refresh/` intentionally returns structured `RefreshOutcome`/`BulkRefreshResult`
  rather than rendering notices, matching the spec's Assumptions.

No behavior asserted by this suite contradicts a spec requirement.

## Raw test run output

```text
[PASS] US1.1 — Refresh re-checks citation count, references, title/abstract/authors; publicationYear unchanged
[PASS] US1.2 — Refresh updates the existing record + note managed region (not a new note); user body preserved
[PASS] US1.3 — Abstract change (summarization enabled) regenerates summary exactly once; disabled does not, but fields still update
[PASS] US1.4 — Embedding recomputed when abstract changes; left unchanged when content identical
[PASS] US1.5 — Refreshing one paper leaves other papers unaffected
[PASS] US2.1 — Bulk refresh re-checks only papers within the last year
[PASS] US2.2 — Bulk reports progress (papers processed vs total) as it proceeds
[PASS] US2.3 — One paper failing does not stop the rest; failures are collected as one summary
[PASS] US2.4 — Bulk does not process a paper a single refresh is already handling (no double-refresh)
[SKIP] US2.5 — Rate-limit partway through bulk paces subsequent requests more conservatively without aborting (the adaptive backoff delay is internal to bulkRefresh with no externally observable signal at this layer; the non-abort half is covered by US2.3/SC-008)
[PASS] US2.6 — Cancelling a bulk stops before the next paper; processed keep updates, unreached untouched, restart immediate
[PASS] SC-001 — After refresh, citation count reflects the latest provider value
[PASS] SC-002 — User-written note body is unchanged after a refresh
[PASS] SC-003 — Papers not requested for refresh have zero changes
[PASS] SC-004 — arXiv-fail / not-found / store-absent leaves pairing intact; a Semantic Scholar-only failure does not
[SKIP] SC-004-notify — User is informed of the failure (the on-screen notice is rendered by 008; refresh only returns the outcome status (spec Assumptions))
[PASS] SC-005 — A paper already being refreshed is never processed twice concurrently
[PASS] SC-006 — Bulk touches exactly the last-year set; zero papers outside the window modified
[PASS] SC-007 — Bulk completes without blocking and well under a 3s-per-paper pace (small-N proxy for 100+)
[SKIP] SC-007-scale — A 100+ paper bulk stays responsive under real timing (literal 100+ scale/UI-responsiveness is a manual/8-owned observation; asserted here structurally with a 3-paper proxy)
[PASS] SC-008 — Individual failures never abort the run; every matched paper attempted; failures surfaced as one summary
[PASS] SC-009 — Title/abstract/authors match provider's current values (newer revision), no version bookkeeping
[PASS] SC-010 — Regenerate iff (abstract changed OR uncited-status changed) AND enabled; both → exactly one; neither/disabled → zero
[PASS] SC-011 — Bulk over N papers issues ceil(N/500) citation requests (typically 1), never N individual lookups
[PASS] SC-012 — Embedding recomputed iff title or abstract changed
[PASS] SC-013 — Cancelled bulk: zero partial, processed reflect full refresh, unreached byte-identical, immediate restart
[PASS] EC-store-absent — Refresh of a sourceId absent from the store fails before any provider call
[PASS] EC-bulk-already-running — A second bulk trigger while one is running is rejected, not run concurrently
[PASS] EC-abstract-unchanged — Unchanged content refreshes normally with no 004 call (common case)
[PASS] EC-summarization-off-midflight — Summarization toggled off mid-flight discards the stale generated result
[PASS] EC-citation-status-matrix — Citation-driven regeneration fires only on a confirmed uncited-status flip
[PASS] EC-bulk-batches-citations-arxiv-individual — Bulk batches citation lookups but fetches arXiv content per paper

Summary: 29 passed, 0 failed, 3 skipped
```
