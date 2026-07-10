# Phase 0 Research: Manual Paper Refresh

All items below were resolved by reading 002's already-implemented provider clients and embedding modules (`src/collection/`), 003's persistence API (`src/persistence/store.ts`), and 001's `Paper` shape. Note: at the time this research was first written, `src/collection/embedding.ts`, `embeddingUpgrade.ts`, and `reembed.ts` existed on `develop` but not yet on this feature's branch — that gap was closed 2026-07-10 via `git merge develop` (tasks.md T001, merge commit `83728c7`), so these modules are now directly present on this branch.

## Decision 1: arXiv single-paper content re-fetch uses `id_list`, not a date-windowed search

**Decision**: Add one new function to `src/collection/arxivClient.ts` — `fetchArxivEntryById(baseArxivId: string): Promise<Element | undefined>` — that queries `http://export.arxiv.org/api/query?id_list=<id>` (arXiv's documented direct-lookup form) and returns at most one `<entry>`, reusing the same `DOMParser` Atom parsing `queryArxiv` already does internally. It takes no date window and does no paging (a single-ID lookup returns 0 or 1 entries by construction).

**Rationale**: `queryArxiv` (002) is purpose-built for windowed, paginated *discovery* search (`search_query=` + `submittedDate:[...]`) — reusing it for a single already-known paper would require synthesizing a fake window and discarding paging logic that doesn't apply. arXiv's `id_list` parameter is the documented mechanism for "give me this exact paper's current metadata," which is exactly FR-002/FR-013's requirement (always the *current* revision, no version comparison).

**Alternatives considered**: Reusing `queryArxiv` with an `au:`/title-based search — rejected, since arXiv has no exact-ID search clause and a title/author search risks matching the wrong paper (the same false-positive risk 002's research.md Decision 12 already rejected for Semantic Scholar identity matching).

## Decision 2: citation lookup reuses 002's existing single-paper and batch Semantic Scholar clients unchanged

**Decision**: Single-paper refresh (FR-001) calls `fetchSemanticScholarPaper` (already exported from `semanticScholarClient.ts`, explicitly retained for this feature). Bulk refresh (FR-009/FR-018) calls `fetchSemanticScholarBatch` (already exported, already chunked to 500 ids/request). Both parse their response through the existing `parseSemanticScholarPaper`/`toPaperSourceId` (`semanticScholarParser.ts`) — no new parsing code.

**Rationale**: These are the exact functions 002 built and documented as this feature's dependency; duplicating them would violate FR-008 (single provider-communication boundary) and the constitution's extensibility principle (extend, don't fork).

**Alternatives considered**: A new dedicated refresh-only Semantic Scholar client — rejected, no behavioral difference from what exists, pure duplication.

## Decision 3: a single shared in-flight guard module serializes single-vs-bulk overlap (FR-006/FR-012)

**Decision**: A new `src/refresh/concurrencyGuard.ts` holds one `Set<PaperSourceId>` (papers currently being refreshed, by either mode) and one boolean (a bulk run is active). Single-paper refresh checks+claims one entry; bulk refresh checks+sets the boolean and claims each paper's entry just before processing it, releasing both on completion/failure. A second bulk trigger while the flag is set is rejected with a user-facing "already in progress" message (Edge Cases); a single-paper refresh request for a sourceId already claimed (by either mode) is likewise rejected rather than queued or run twice.

**Rationale**: FR-006 and FR-012 are two faces of one constraint (no sourceId refreshed twice concurrently, no two bulk runs concurrently) — 002's `dedupe.ts` establishes the project's precedent for a small `Set`-based per-run claim primitive; this reuses that shape rather than inventing a different concurrency mechanism. Keeping it a separate module (not embedded in `refreshOne.ts` or `bulkRefresh.ts`) lets both call sites share exactly one source of truth.

**Alternatives considered**: A per-paper mutex/promise chain like `PaperStore`'s `run()` write-serialization — rejected as heavier than needed; refresh's guard only needs "reject if already in flight," never "queue and wait," per FR-006's wording ("must not process it twice concurrently," not "must run after the first completes").

## Decision 4: bulk arXiv content-refetch pacing — fixed short delay, additive backoff only after an observed failure

**Decision**: Bulk refresh's per-paper arXiv content re-fetch (FR-015) uses a default fixed delay of **300 ms** between successive `fetchArxivEntryById` calls (an order of magnitude below arXiv's literal 3 s guidance, matching the spec's explicit instruction). On an actual non-200/timeout response for one paper, the delay before the *next* paper's call doubles (300 ms → 600 ms → 1200 ms, capped at 3 s to never exceed arXiv's own baseline guidance) and resets to 300 ms after a subsequent success.

**Rationale**: The spec (FR-015, Clarifications Session 2026-07-06) explicitly requires "substantially shorter" than 3 s by default with reactive-only backoff. 300 ms keeps a 100-paper bulk run's arXiv leg to ~30 s absent failures, well under the naive 5-minute figure the spec calls out as unacceptable (SC-007).

**Alternatives considered**: A fixed 1 s delay — rejected as unnecessarily conservative for a single-ID lookup (no paging, minimal payload) compared to 002's per-page delay, which paces requests that return up to 100 full entries each.

## Decision 5: summary-regeneration trigger is a small pure predicate, reused by both modes

**Decision**: A new `src/refresh/summaryTrigger.ts` exports one pure function `shouldRegenerateSummary(stored: Paper, fresh: { abstract: string; citationCount: number }): boolean` implementing FR-014 ∨ FR-020 (abstract differs, OR citation count crosses the 0/nonzero boundary). Both `refreshOne.ts` (single-paper) and `bulkRefresh.ts` (via `refreshOne.ts`) call this one function before deciding whether to invoke the 004 `summarize` hook.

**Rationale**: A pure, independently testable boundary-crossing check is the natural shape for a rule stated entirely in terms of two before/after value pairs; keeping it separate from orchestration avoids duplicating the OR logic between single and bulk call sites.

**Alternatives considered**: Inlining the check into `refreshOne.ts` — rejected only because a separate pure function is trivially more testable; this is a minor organizational choice, not a meaningfully different design.

## Decision 6: 004 invocation reuses 002's existing hook shape verbatim

**Decision**: `refreshOne.ts` accepts a `summarize?: (input: SummarizationInput) => Promise<SummaryResult | undefined>` hook with exactly the `SummarizationInput`/`SummaryResult` types already defined in `src/collection/types.ts` (imported, not redefined) — the same narrow `{ title, abstract, citationCount, citationsKnown }` shape 002 uses (FR-017).

**Rationale**: FR-017 explicitly mandates the identical contract; `types.ts` already exports these types for exactly this kind of cross-feature reuse.

**Alternatives considered**: A `refresh`-specific type alias re-exporting the same shape — unnecessary; importing directly avoids any risk of the two shapes drifting apart.

## Decision 7: persistence write reuses `PaperStore.upsert`/`PersistInput` unchanged

**Decision**: A refreshed paper is written via the existing `PaperStore.upsert({ paper, summary, futureDirections })` (003) — the same field-scoped-merge path 002 already uses. No new persistence API is added.

**Rationale**: FR-003 requires writing through "the existing 003 synchronized pairing," and `PaperStore.upsert` already implements exactly the field-scoped merge (preserve user body, preserve fields not supplied) this feature needs — including the embedding preserve-unless-supplied rule (003 FR-004): an incoming `embedding: null` preserves the stored vector, while a non-null incoming embedding replaces it. A citation-only refresh relies on the *preserve* half (it carries forward whatever embedding it already read from the previously-stored `Paper`, unchanged); a content-changing refresh instead supplies a freshly-computed **non-null** vector (Decision 9) precisely so the *replace* half fires. A refresh's `Paper` is a full, valid `Paper`, never a partial patch, so `wrap()`'s merge behaves identically to how 002 already calls it.

**Alternatives considered**: A refresh-specific partial-update API on `PaperStore` — rejected; FR-003 explicitly says "the existing... pairing," not a new write path.

## Decision 8: progress reporting is a plain callback, not a new UI primitive

**Decision**: `runBulkRefresh` accepts an optional `onProgress?: (done: number, total: number) => void` callback, invoked after each paper (success or failure) completes. No event emitter, store, or persisted state is introduced.

**Rationale**: FR-016/Assumptions explicitly defer the on-screen presentation to 008; this feature only needs to *expose* progress, not render it. A callback is the simplest shape that lets 008 wire a status-bar/notice update without this feature depending on any UI primitive — matching 002's own `PipelineHooks` callback-injection pattern.

**Alternatives considered**: Returning an async generator that yields progress — rejected as a heavier API shape than a callback for what is fundamentally a side-effecting notification.

## Decision 12: bulk cancellation reuses the concurrency guard as the cancel signal, not `AbortController`

**Decision**: `ConcurrencyGuard` (Decision 3) gains two more methods: `requestBulkCancel(): void` and `isBulkCancelRequested(): boolean`. `runBulkRefresh`'s per-paper loop checks `isBulkCancelRequested()` between papers (after one `refreshOne` call settles, before starting the next) and stops the loop early if true, returning the `BulkRefreshResult` built from whatever was processed so far — no `RefreshOutcome`/`BulkRefreshResult` shape change needed (FR-022, SC-013). `guard.releaseBulk()` (already called at the end of the loop, Decision 3) clears both the bulk-active flag and the cancel-requested flag together, so a fresh `runBulkRefresh` call afterward starts clean.

**Rationale**: FR-022 requires the in-flight paper to finish rather than being interrupted mid-write — checking the flag *between* papers, not inside `refreshOne`, is exactly this behavior, and it's a one-line addition to a loop that already exists (Decision 4's pacing loop). Reusing `ConcurrencyGuard` — which 008 already holds a reference to, to call `runBulkRefresh` in the first place — means 008's cancel trigger (whatever UI it wires) needs no new object reference beyond the guard it already has.

**Alternatives considered**: Passing a Web-standard `AbortSignal` into `runBulkRefresh` — rejected as introducing a browser/Node API this project has otherwise avoided (no existing 001-005 module uses `AbortController`), and as overkill for a check-between-iterations use case with no need for `AbortSignal`'s composability (timeout races, fetch cancellation, etc.) that this feature doesn't have. A signal-based approach would also require inventing a *second* place (beyond the guard) for 008 to hold a cancellation handle per run.

## Decision 9: embedding recomputation on content change composes 002's two already-exported functions, never reimplements or reaches into 002's private re-embed helper

**Decision**: `refreshOne.ts` computes a paper's canonical embedding, when title/abstract changed (FR-019), with a small local composition function equivalent in behavior to `reembed.ts`'s private (unexported) `computeCanonical`:

```ts
async function computeCanonicalEmbedding(
  title: string,
  abstract: string,
  config: EmbeddingConfig, // { provider: EmbeddingProvider; localModel?: string } — src/collection/embeddingUpgrade.ts
): Promise<EmbeddingResult> {
  if (config.provider === 'bundled') {
    return computeBaselineEmbedding(title, abstract); // src/collection/embedding.ts — sync, never throws
  }
  const upgraded = await upgradeEmbedding(title, abstract, config); // src/collection/embeddingUpgrade.ts
  return upgraded ?? computeBaselineEmbedding(title, abstract); // upgrade failure falls back to baseline, never blocks
}
```

`computeBaselineEmbedding` (`src/collection/embedding.ts`) and `upgradeEmbedding` (`src/collection/embeddingUpgrade.ts`) are **both already exported** by 002 (confirmed by reading `develop`'s current source) — this feature imports them directly rather than either (a) reimplementing the hashed-term-frequency baseline math or the local-transformer/LLM upgrade dispatch itself, or (b) importing `reembed.ts`'s `reembedCorpus`, which is a *corpus-wide sweep* keyed by provider-switch convergence (`isCanonical`/skip-if-already-canonical logic tied to `embeddingModel` string matching) — a different trigger and shape than "one paper's content just changed, always recompute." Composing the two public building blocks, rather than either extreme, is the smallest correct reuse.

The embedding-provider selection (`EmbeddingConfig`) is read live via an injected `getEmbeddingConfig: () => EmbeddingConfig` — reading `PluginSettings.embeddingProvider ?? 'bundled'` and `localEmbeddingModel` (both already-implemented 001 FR-022 fields on `src/models/settings.ts`) — mirroring how `getSemanticScholarApiKey` is already injected into `runCollectionPass` for the same live-setting reason (002's FR-021 pattern — not to be confused with this feature's own FR-021 — a setting must be read at the moment of use, not captured once).

**Rationale**: FR-019 explicitly requires recomputing via "collection's (002) existing embedding computation... this feature MUST NOT implement its own embedding logic." Since 002 exports the two needed pure/async functions but not a single "recompute one paper's canonical vector" function, composing them is the correct level of reuse — it duplicates zero embedding math (the FNV-1a hashing, tokenization, L2-normalization, and local-transformer/LLM dispatch all stay solely in `embedding.ts`/`embeddingUpgrade.ts`), while not requiring a 002 API change or reaching into a private, unexported helper. The fallback-to-baseline behavior mirrors `reembed.ts`'s own `computeCanonical` exactly (never overwrite a stored vector with nothing; an upgrade failure keeps the baseline), so this feature's behavior is indistinguishable from what 002 would do for the same paper.

**Alternatives considered**: 
- Asking 002 to export `computeCanonical` directly from `reembed.ts` — considered preferable in the abstract (zero duplication of even the compose logic), but out of this feature's scope to request/depend on a 002 code change; the two-line composition above is small enough that duplicating *only the compose logic* (not the math) is an acceptable, low-risk trade-off. If 002 later exports this, `refreshOne.ts`'s local helper collapses to a single re-exported call with no other change.
- Calling `reembedCorpus` for a single paper by wrapping it in a one-element async iterable — rejected: `reembedCorpus` unconditionally no-ops when `config.provider === 'llm'` (since there is no canonical LLM space to converge to yet, per its own comment) and skips a paper already matching its **current** `embeddingModel`, neither of which is the right behavior here — a content-changed paper's embedding MUST be recomputed regardless of whether an LLM canonical space exists yet (FR-019 has no such carve-out), and regardless of whether its *previous* model id happens to already look canonical (it was computed from stale text).

## Decision 10: bulk paper selection reads through `PaperStore.all()`, accepting its per-paper hydration cost

**Decision**: `runBulkRefresh`'s window-matching step (FR-009) iterates `store.all()` (003's existing enumeration API) and filters by `publicationYear`, exactly as 006's graph-build enumeration already does — no new 003 read API is introduced. Each yielded `Paper` is already fully hydrated (embedding included) by `all()`'s existing per-entry `get()` call.

**Rationale**: 003's contract exposes exactly three read operations (`has`/`get`/`all`); there is no lighter-weight "list mirrored fields only" method to filter by `publicationYear` without full hydration, and adding one would be a 003 API change out of this feature's scope. `store.all()` already yields sequentially (an `AsyncGenerator`), so the cost is spread across awaited iterations rather than a single blocking pass.

**Alternatives considered**: Requesting a new 003 API (e.g. `allMetadata()`) — rejected as out of scope for this feature to demand of an already-implemented sibling.

## Decision 11: "within the last year" is a year-granularity comparison

**Decision**: FR-009's window is `publicationYear >= currentYear - 1` (the current calendar year or the immediately preceding one) — the coarsest, and only, comparison `publicationYear`'s bare-year precision supports (per the spec's own "no new field" stance).

**Rationale**: `Paper.publicationYear` (001) is a bare year integer; no finer-grained collection/refresh timestamp exists to compute a rolling 365-day window from, and the spec's Assumptions deliberately avoid adding one.

**Alternatives considered**: None — this is the only comparison the existing field supports.
