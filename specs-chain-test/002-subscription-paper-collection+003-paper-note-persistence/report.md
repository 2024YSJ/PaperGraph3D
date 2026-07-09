# Chain test report: 002-subscription-paper-collection → 003-paper-note-persistence

- **Chain (upstream → downstream):** `002-subscription-paper-collection` → `003-paper-note-persistence`
- **Source branch:** `002-subscription-paper-collection` (with `develop` merged in, so 003's `src/persistence` is present alongside 002's `src/collection`)
- **Date:** 2026-07-09
- **`tsc --noEmit` (src gate):** PASS
- **Counts:** 9 passed / 0 failed / 0 skipped

## Seam map

The two features are code-independent by design — 002 never imports 003. 002 declares the
hand-off as an injected `PipelineHooks` contract (`src/collection/types.ts`) so it can be
built before 003 exists. The seams are therefore the *contract* between 002's promoted
`Paper` + hook signatures and 003's `PaperStore`.

| Pair | Seam | Status | Sides |
|---|---|---|---|
| 002 → 003 | promoted `Paper` (`promote()`) consumed by `PaperStore.upsert()` / `wrap()` | ✅ exercised | both implemented |
| 002 → 003 | `PipelineHooks.persist` / `alreadyPersisted` filled by `PaperStore.upsert` / `has` | ✅ exercised | both implemented |
| 002 → 003 | note frontmatter mirrors the FR-002 shared subset of the `Paper` | ✅ exercised | both implemented |
| 002 → 003 | `has(sourceId)` dedup that gates 002's `alreadyPersisted` | ✅ exercised | both implemented |

No seam is SKIP: both `src/collection` (002) and `src/persistence` (003) are implemented, so
every connection point is exercisable against real exports. The only unbuilt hook in the
`PipelineHooks` shape is `summarize?` (004), which is outside this chain and optional.

## Whole-system flow

Pipeline threaded end-to-end:

```
PaperCandidate ──promote() [002/001]──▶ Paper ──upsert() [003]──▶ record(.json) + note(.md) ──get() [003]──▶ Paper
```

The artifact travelled the **entire** chain — no seam was unimplemented, so nothing was
truncated. System-level invariants asserted:

- **E1** — full round-trip fidelity: the `Paper` read back through 003 equals the one 002
  promoted, including the embedding **vector** (which lives only in the `.json`, never the
  note), and the vector never leaks into the human-facing frontmatter.
- **E2** — emergent re-collection property: when 002 re-persists a paper it already saved,
  003's user-owned note body is preserved (FR-005) while the managed frontmatter reflects
  the fresh collection data. No single-spec test spans this.

## Scenarios

| id | pair / seam | status | note |
|---|---|---|---|
| C1 | 002→003 persist | PASS | promoted `Paper` round-trips through `PaperStore` byte-for-byte |
| C2 | 002→003 hooks | PASS | `PaperStore` structurally satisfies `PipelineHooks.persist/alreadyPersisted` (compiles + runs) |
| C3 | 002→003 note | PASS | frontmatter mirrors title/authors/publicationYear/citationCount/sourceId/readState |
| C4 | 002→003 note (negative) | PASS | references/embedding/schemaVersion/abstract/timestamps do **not** leak to frontmatter |
| C5 | 002→003 (negative) | PASS | a held-back (missing/NaN year) candidate can never become a valid persisted record |
| C6 | 002→003 dedup | PASS | `has(sourceId)` flips false→true exactly across the persist seam |
| C7 | 002→003 (emergent) | PASS | `citationsKnown` unknown-vs-zero distinction survives the persist round trip |
| E1 | [system] | PASS | candidate → promote → upsert → get preserves the whole `Paper` incl. embedding vector |
| E2 | [system] | PASS | a 002 re-persist updates managed data yet preserves the user note body (FR-005) |

## Known residual limitations

These are cross-spec behaviors observed but outside this suite's asserted scope. They are
notes, not failures — none violates a stated integration invariant.

- **Wiring vs. contract.** This suite proves 003 *can* satisfy 002's `PipelineHooks`; it does
  not assert that `src/main.ts` actually wires them together (main.ts still carries the
  "stubs until 003/004 ship" comment). Connecting the pipeline to a real `PaperStore` is
  production-wiring work (tracked toward 008), not a spec seam.
- **Embedding preserve-unless-supplied** (003 `mergePaper`, FR-004/SC-007) is a 003↔005
  refresh property, not a 002↔003 one, so it is exercised only incidentally here (E1 stores a
  non-null vector once). A dedicated 003+005 chain test should cover the null-does-not-clobber
  case.
- **Summarize seam** (`PipelineHooks.summarize?`) is a 002↔004 coupling and is intentionally
  not exercised in this chain.

## Raw test output

```
[PASS] C1 — [002->003 persist] promoted Paper round-trips through PaperStore unchanged
[PASS] C2 — [002->003 hooks] PaperStore satisfies 002 PipelineHooks.persist/alreadyPersisted
[PASS] C3 — [002->003 note] note frontmatter mirrors the promoted Paper subset
[PASS] C4 — [002->003 note] non-subset fields (references/embedding/schemaVersion) do not leak to frontmatter
[PASS] C5 — [002->003] a held-back (missing-year) candidate can never become a valid persisted record
[PASS] C6 — [002->003 dedup] PaperStore.has(sourceId) is false pre-persist, true post-persist
[PASS] C7 — [002->003] citationsKnown (unknown-vs-zero) distinction survives the persist round trip
[PASS] E1 — [system] candidate -> promote(002) -> upsert(003) -> get(003) preserves the whole Paper incl. embedding
[PASS] E2 — [system] a 002 re-persist updates managed data yet preserves the user note body (FR-005)
Summary: 9 passed, 0 failed, 0 skipped
```
