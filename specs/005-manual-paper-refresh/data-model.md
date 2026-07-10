# Phase 1 Data Model: Manual Paper Refresh

No new persisted entity or `Paper`/`PaperRecord` field is introduced by this feature (spec Assumptions: no new 001 field for staleness, no version field; embedding fields already exist per 001 FR-019/FR-020/FR-022). Everything below is transient, in-memory-only state that exists for the duration of one refresh action.

## RefreshRequest (transient)

A single-paper refresh in progress.

| Field | Type | Notes |
|---|---|---|
| `sourceId` | `PaperSourceId` (001) | The paper being refreshed; the guard key (research.md Decision 3). |

Not a class/struct in code — `refreshOne(store, sourceId, guard, hooks, ...)`'s parameters ARE this entity; it has no independent representation, matching the spec's "Not persisted; it carries only which paper to refresh."

## BulkRefreshRun (transient, single active instance)

| Field | Type | Notes |
|---|---|---|
| `matched` | `Paper[]` | Every stored paper with `publicationYear >= currentYear - 1` (FR-009, research.md Decision 11) at trigger time, snapshotted once at start. Read via `PaperStore.all()` (research.md Decision 10). |
| `done` | `number` | Count of matched papers attempted so far (success + failure), for `onProgress` (FR-016). |
| `failures` | `{ sourceId: PaperSourceId; reason: string }[]` | Accumulated per-paper failures, surfaced as one summary at the end (FR-011). |
| *(cancel signal)* | `ConcurrencyGuard.isBulkCancelRequested()` | Not a field on this entity itself — a live check against the shared guard (research.md Decision 12), consulted between papers. On a true reading, the loop stops after the in-flight paper finishes; `matched`/`done`/`failures` reflect only what was actually processed (FR-022, SC-013). |

Represented in code as `runBulkRefresh`'s local state, not a persisted object.

## RefreshOutcome (return shape of `refreshOne`)

| Variant | Meaning |
|---|---|
| `{ status: 'updated' }` | Content/citation fields applied per what each independent provider call returned; embedding recomputed iff title/abstract changed (FR-019); summary regenerated iff `summaryTrigger` fired and summarization was enabled. |
| `{ status: 'notFound' }` | arXiv returned no entry for the id — this paper's own identity is gone at the provider; existing data kept unchanged (FR-005). Also returned immediately, before any provider call, when the requested `sourceId` has no record in the store at all — refresh only targets an already-saved paper. |
| `{ status: 'alreadyInFlight' }` | Guard rejected — this sourceId (or a bulk run) is already refreshing it (FR-006/FR-012). |
| `{ status: 'error'; message: string }` | The arXiv content call failed/timed out after retry — existing data kept unchanged (FR-005/Edge Cases). A Semantic Scholar citation-lookup failure alone does **not** produce this outcome — see below. |

**Independent provider failure** (FR-021): arXiv content re-fetch and Semantic Scholar citation lookup are independent per-provider calls (FR-002). Only the arXiv content call's failure (or the paper being altogether absent) can produce `notFound`/`error`. When arXiv succeeds but Semantic Scholar fails or reports no record, the outcome is still `{ status: 'updated' }` — title/abstract/authors (and, if changed, the embedding) are applied, while `citationCount`/`references`/`citationsKnown` are carried through from the previously-stored `Paper` unchanged, mirroring 002 FR-018's "enrichment failure never withholds the paper."

This is the shape `bulkRefresh.ts` inspects to build `BulkRefreshRun.failures` (`notFound`/`error` → a failure entry).

## Provider intermediate shapes (reused, not redefined)

Refresh introduces no new provider-response shape. It reuses, unchanged, from `src/collection/`:

- `parseArxivEntry`, applied to the one `<entry>` `fetchArxivEntryById` returns — title/authors/publicationYear/abstract.
- `SemanticScholarPaper` / `SemanticScholarReference` (`types.ts`, `semanticScholarParser.ts`) — citationCount + references, for both the single-paper and batch lookup paths.
- `SummarizationInput` / `SummaryResult` (`types.ts`) — the narrow 004 call contract (FR-017).
- `EmbeddingResult` (`src/collection/embedding.ts`) and `EmbeddingConfig` (`src/collection/embeddingUpgrade.ts`) — the embedding compute/config shapes (FR-019, research.md Decision 9).

## State transition this feature governs (not a persisted field)

A paper's **uncited/cited status**, derived live from `Paper.citationCount === 0` vs `> 0`, is the boundary `summaryTrigger.shouldRegenerateSummary` (research.md Decision 5) watches:

```
uncited (0) --[refresh raises count > 0]--> cited (nonzero)   => regenerate (drop future-directions)
cited (nonzero) --[refresh corrects count to 0]--> uncited (0) => regenerate (add future-directions)
uncited (0) --[refresh confirms still 0]--> uncited (0)        => no trigger from this rule
cited (nonzero) --[refresh changes count, stays nonzero]--> cited => no trigger from this rule
```

Independently, an abstract-content change (FR-014) triggers regardless of which side of this boundary the paper is on or moves to; the two triggers are OR'd (Decision 5), never double-invoked (FR-014/FR-020's "exactly one regeneration call").

## Embedding recomputation trigger (FR-019, not a persisted field)

`Paper.embedding`/`embeddingModel`/`embeddingSource` are existing 001 fields; this feature writes to them under one condition only — a **title or abstract** change, checked via a dedicated `refreshOne.ts` comparison (research.md Decision 9) that is *not* `summaryTrigger.shouldRegenerateSummary` (that predicate only sees `{ abstract, citationCount }`, per FR-014's narrower abstract-only condition, and cannot detect a title-only change). This is a *different* trigger condition than the uncited/cited boundary crossing above: a citation-only change never touches the embedding, while a content change (title and/or abstract) always recomputes it via `computeCanonicalEmbedding` (Decision 9), regardless of whether the citation boundary was also crossed in the same refresh.
