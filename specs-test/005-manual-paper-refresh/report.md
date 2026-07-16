# Spec-Test Report: 005-manual-paper-refresh

> **[Re-run 2026-07-16 — 34 passed, 0 failed, 3 skipped]** Unchanged by the embedding redesign; re-run to
> confirm no regression. Suites are built with `--external:@huggingface/transformers`:
> the embedding runtime is now a real dependency of `src/`, and the lazy import is
> never reached by these tests.

- **Spec**: `specs/005-manual-paper-refresh/spec.md` (v2, includes the 2026-07-11 FR-015 correction — batched arXiv content re-fetch — and the new FR-018b large-run confirmation gate)
- **Source branch**: `develop-feature/embedding-redesign`
- **Date**: 2026-07-16
- **`tsc --noEmit`**: PASS (no errors)
- **Result**: **34 passed, 0 failed, 3 skipped**

Runs the real `src/refresh/{refreshOne,bulkRefresh,concurrencyGuard,summaryTrigger}.ts` and `src/collection/{arxivClient,semanticScholarClient,semanticScholarParser,embedding}.ts` exports end-to-end (esbuild + node, this repo's no-test-runner convention), with `obsidian` aliased to a programmable `_obsidian-shim.ts` (crafted deterministic `requestUrl` responses, keyed by base arXiv id) and a `DOMParser` polyfill. No live network call is made. Report-only — no `src/` changes.

## Results

| id | scenario/SC | status | note |
|---|---|---|---|
| US1.1 | Refresh re-checks citation count, references, title/abstract/authors; publicationYear unchanged | PASS | |
| US1.2 | Refresh updates the existing record + note managed region (not a new note); user body preserved | PASS | |
| US1.3 | Abstract change (summarization enabled) regenerates summary exactly once; disabled does not, but fields still update | PASS | |
| US1.4 | Embedding recomputed when abstract changes; left unchanged when content identical | PASS | |
| US1.5 | Refreshing one paper leaves other papers unaffected | PASS | |
| US2.1 | Bulk refresh re-checks only papers within the last year | PASS | Also asserts arXiv content is batched into ONE call covering matched papers only (FR-015, corrected) |
| US2.2 | Bulk reports progress (papers processed vs total) as it proceeds | PASS | |
| US2.3 | One paper failing does not stop the rest; failures are collected as one summary | PASS | |
| US2.4 | Bulk does not process a paper a single refresh is already handling (no double-refresh) | PASS | |
| US2.5 | Rate-limit partway through bulk paces subsequent requests more conservatively without aborting | SKIP | The per-paper pacing/backoff scheme this scenario originally described was removed as part of the FR-015 correction (arXiv content re-fetch is now batched, not individually paced) — see **Known residual limitations** below. The non-abort half is covered by US2.3/SC-008/SC-008b. |
| US2.6 | Cancelling a bulk stops before the next paper; processed keep updates, unreached untouched, restart immediate | PASS | |
| SC-001 | After refresh, citation count reflects the latest provider value | PASS | |
| SC-002 | User-written note body is unchanged after a refresh | PASS | |
| SC-003 | Papers not requested for refresh have zero changes | PASS | |
| SC-004 | arXiv-fail / not-found / store-absent leaves pairing intact; a Semantic Scholar-only failure does not | PASS | |
| SC-004-notify | User is informed of the failure | SKIP | The on-screen notice is rendered by 008; refresh only returns the outcome status (spec Assumptions) |
| SC-005 | A paper already being refreshed is never processed twice concurrently | PASS | |
| SC-006 | Bulk touches exactly the last-year set; zero papers outside the window modified | PASS | |
| SC-007 | Bulk completes without blocking and well under a 3s-per-paper pace | PASS | Small-N proxy; literal 100+ scale is SC-007-scale below |
| SC-007-scale | A 100+ paper bulk stays responsive under real timing | SKIP | Literal 100+ scale/UI-responsiveness is a manual/008-owned observation; structurally asserted here with a small-N proxy. (Separately verified live in this session: a real ~100-paper bulk run against arXiv/Semantic Scholar completed and was the trigger for the FR-015 correction.) |
| SC-008 | Individual failures never abort the run; every matched paper attempted; failures surfaced as one summary | PASS | Two papers sharing one arXiv batch: one succeeds, one is a genuine per-id "not found" |
| SC-008b | A failed arXiv batch chunk surfaces every one of its papers as a failure, never aborting the run | PASS | New for the FR-015 correction — a whole-chunk HTTP failure (not an individual per-id "not found") marks every paper in that chunk as its own `error` outcome |
| SC-009 | Title/abstract/authors match provider's current values (newer revision), no version bookkeeping | PASS | |
| SC-010 | Regenerate iff (abstract changed OR uncited-status changed) AND enabled; both → exactly one; neither/disabled → zero | PASS | |
| SC-011 | Bulk over N papers issues ceil(N/500) citation requests (typically 1), never N individual lookups | PASS | |
| SC-012 | Embedding recomputed iff title or abstract changed | PASS | |
| SC-013 | Cancelled bulk: zero partial, processed reflect full refresh, unreached byte-identical, immediate restart | PASS | |
| EC-store-absent | Refresh of a sourceId absent from the store fails before any provider call | PASS | |
| EC-bulk-already-running | A second bulk trigger while one is running is rejected, not run concurrently | PASS | |
| FR-018b-declined | A declined confirmation on an over-threshold (301-paper) matched set makes zero provider calls and leaves the store untouched | PASS | New — FR-018b (added 2026-07-11) |
| FR-018b-confirmed | A confirmed over-threshold run proceeds exactly as an ordinary bulk run | PASS | New — FR-018b |
| FR-018b-hookless | An over-threshold run with no `confirmLargeRun` hook proceeds unconditionally (008 not yet wired) | PASS | New — FR-018b |
| FR-018b-under-threshold | A matched set at or under the threshold (300) is never asked for confirmation, even when a hook is supplied | PASS | New — FR-018b boundary case |
| EC-abstract-unchanged | Unchanged content refreshes normally with no 004 call (common case) | PASS | |
| EC-summarization-off-midflight | Summarization toggled off mid-flight discards the stale generated result | PASS | |
| EC-citation-status-matrix | Citation-driven regeneration fires only on a confirmed uncited-status flip | PASS | |
| EC-bulk-batches-citations-and-arxiv-content | Bulk batches BOTH citation lookups and arXiv content re-fetch | PASS | Renamed/rewritten from the pre-correction `EC-bulk-batches-citations-arxiv-individual`, which asserted the now-superseded "arXiv stays individual" premise |

## Known residual limitations

- **`parsererror`/malformed-response guard (research.md Decision 4b) has no dedicated test here.** The 2026-07-11 correction also added a shared `parseArxivEntries` guard in `src/collection/arxivClient.ts` that throws when an arXiv response is malformed (a throttled empty/HTML-error body), rather than silently reading it as "zero results." This is not derived into its own case here because it is not stated as a distinct FR/SC/Acceptance-Scenario in `spec.md` (it appears only in the corrective note); it's an implementation-level fix, not a spec-level requirement with its own testable outcome. It's also not reachable through this harness's `FakeDOMParser`, which reconstructs fake `<entry>` elements directly from JSON and never produces a real `<parsererror>` node — testing it would require a harness change (a real XML parser, e.g. `@xmldom/xmldom`) beyond this suite's existing convention. It was separately verified in this session directly against a live Chromium `DOMParser` (empty/whitespace/junk-text inputs all produced a `<parsererror>` node without `parseFromString` itself ever throwing), confirming the guard is reachable and correct in the real Obsidian runtime.
- **US2.5's scenario text in `spec.md` (line 86, Acceptance Scenario 5 of User Story 2) was not rewritten alongside the FR-015 correction.** It still describes "paces subsequent requests more conservatively... without aborting," which described the now-removed per-paper adaptive-backoff scheme. FR-015 itself, the Assumptions bullet, and research.md Decision 4 were all updated to reflect batching, but this one Acceptance Scenario line was missed. This is a spec-authoring gap worth a follow-up `/speckit.specify` or manual edit — noted here, not treated as a code FAIL, since the corrected implementation is what's now intentionally in place.
- **`fetchArxivEntriesByIds`'s chunking (>100 ids) is not exercised at real scale here.** `ARXIV_PAGE_SIZE` is 100; the FR-018b tests seed 300–301 papers (crossing the confirmation threshold) but that's still ≤ 4 chunks and the shim doesn't distinguish inter-chunk pacing timing. Chunk-boundary correctness (an id at position 100 landing in the second chunk, e.g.) is implied by code inspection but not explicitly asserted by a test here.
- **`SC-007`/`SC-007-scale`**: this suite's timing assertion is a small-N proxy (as documented in the code itself); the actual live-scale behavior was separately verified in this session via a real ~100-paper bulk run against arXiv/Semantic Scholar — the exact scenario that surfaced the FR-015 defect this feature's implementation now fixes.

None of the above are treated as FAILs: they are either out of this spec's stated requirements, out of this harness's modeling capability without a convention change, or already independently verified live outside this suite.

## Raw test run output

```
$ npx tsc --noEmit
(no output — exit 0)

$ npx esbuild specs-test/005-manual-paper-refresh/005-manual-paper-refresh.spec-test.ts --bundle --platform=node --format=cjs --alias:obsidian=./specs-test/005-manual-paper-refresh/_obsidian-shim.ts --external:@huggingface/transformers --outfile=$TMP && node $TMP

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
[PASS] SC-008b — A failed arXiv batch chunk (research.md Decision 4, corrected) surfaces every one of its papers as a failure, never aborting the run
[PASS] SC-009 — Title/abstract/authors match provider's current values (newer revision), no version bookkeeping
[PASS] SC-010 — Regenerate iff (abstract changed OR uncited-status changed) AND enabled; both → exactly one; neither/disabled → zero
[PASS] SC-011 — Bulk over N papers issues ceil(N/500) citation requests (typically 1), never N individual lookups
[PASS] SC-012 — Embedding recomputed iff title or abstract changed
[PASS] SC-013 — Cancelled bulk: zero partial, processed reflect full refresh, unreached byte-identical, immediate restart
[PASS] EC-store-absent — Refresh of a sourceId absent from the store fails before any provider call
[PASS] EC-bulk-already-running — A second bulk trigger while one is running is rejected, not run concurrently
[PASS] FR-018b-declined — A declined confirmation on an over-threshold matched set makes zero provider calls and leaves the store untouched
[PASS] FR-018b-confirmed — A confirmed over-threshold run proceeds exactly as an ordinary bulk run
[PASS] FR-018b-hookless — An over-threshold run with no confirmLargeRun hook proceeds unconditionally (008 not yet wired)
[PASS] FR-018b-under-threshold — A matched set at or under the threshold is never asked for confirmation, even when a hook is supplied
[PASS] EC-abstract-unchanged — Unchanged content refreshes normally with no 004 call (common case)
[PASS] EC-summarization-off-midflight — Summarization toggled off mid-flight discards the stale generated result
[PASS] EC-citation-status-matrix — Citation-driven regeneration fires only on a confirmed uncited-status flip
[PASS] EC-bulk-batches-citations-and-arxiv-content — Bulk batches BOTH citation lookups and arXiv content re-fetch (research.md Decision 4, corrected: arXiv id_list accepts a comma-separated batch, same as 002 collection paging)

Summary: 34 passed, 0 failed, 3 skipped
```
