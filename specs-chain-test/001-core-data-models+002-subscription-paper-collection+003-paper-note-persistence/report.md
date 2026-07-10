# Chain test report: 001-core-data-models → 002-subscription-paper-collection → 003-paper-note-persistence

- **Chain (upstream → downstream):** `001-core-data-models` → `002-subscription-paper-collection` → `003-paper-note-persistence`
- **Source branch:** `develop`
- **Date:** 2026-07-10
- **`tsc --noEmit`:** PASS
- **Result:** **7 passed, 0 failed, 0 skipped**

Exercises the three specs as one pipeline using the **real** exports on both sides of
every seam — 001's `toPaper`/`isValidPaper`/`isPaperSourceId`/`isValidSubscription`,
002's `promote`/`parseSemanticScholarPaper`/`runCollectionPass`/`subscriptionStore`, and
003's `PaperStore` over `InMemoryFileStore`. Deterministic (no live network); the
collection pipeline is driven with injected candidates + a stub enrichment map, and its
persist hook is wired to 003's real store. All chain seams are implemented, so there are
no SKIPs.

## Seam map

| pair | seam | status |
|------|------|--------|
| 001 → 002 | `promote()` = 001 `toPaper`: a candidate becomes a `Paper` 001's own validator accepts; 001's hold-back (missing/NaN year) propagates | exercised (C1) |
| 001 → 002 | enrichment references (`parseSemanticScholarPaper` → `toPaperSourceId`) are valid 001 `PaperSourceId`s; enriched `Paper` passes `isValidPaper` | exercised (C2) |
| 001 → 002 | `subscriptionStore.register`/`recordChecked` output stays a valid 001 `Subscription`; 001's default interval applied | exercised (C3) |
| 002 → 003 | the `Paper` 002 produces → `PaperStore.upsert` → record round-trips; note frontmatter mirrors 003 FR-002 shared subset | exercised (C4) |
| 002 → 003 | non-mirrored fields (raw references, embedding, `schemaVersion`, timestamps) never leak into the note; embedding lives in the record wrapper | exercised (C5) |

## Whole-system flow

Pipeline threaded end-to-end: **001 (build + validate candidate) → 002 (dedup, year-gate,
promote, baseline-embed via `runCollectionPass`) → 003 (`PaperStore.upsert` record+note,
read back via `store.get`)**. The artifact travels the full chain — no seam is
unimplemented, so both end-to-end scenarios ran in full:

- **E1** asserts emergent cross-spec invariants a single seam/spec test cannot: a mixed
  batch (2 valid + 1 duplicate + 1 year-held-back) yields **exactly** the 2 distinct
  papers stored; the 001-held-back candidate produces **no** downstream artifact anywhere;
  each stored paper reads back as a valid 001 `Paper` carrying the 002 baseline embedding,
  with its note mirroring the sourceId — round-trip fidelity through all three specs.
- **E2** asserts cross-spec idempotency + user-content safety: re-collecting the same
  paper is a no-op (002's dedup consults 003's real index), creating no duplicate pairing
  and leaving a hand-written note body byte-for-byte unchanged.

## Scenarios

| id | pair / seam | status | note |
|----|-------------|--------|------|
| C1 | [001→002] promote honors hold-back; yields a 001-valid Paper | PASS | happy + no-year + NaN-year negatives |
| C2 | [001→002] enrichment refs are valid 001 sourceIds; enriched Paper valid | PASS | via runCollectionPass + stub enrich |
| C3 | [001→002] store emits 001-valid Subscriptions; default interval | PASS | register + recordChecked |
| C4 | [002→003] 002 Paper round-trips 003 record; note mirrors shared subset | PASS | store.get deep-equals produced Paper |
| C5 | [002→003] non-mirrored fields + embedding never leak into the note | PASS | embedding in record wrapper only |
| E1 | [system] batch 001→002→003: round-trip, held-back dropped, dup collapsed | PASS | emergent dedup + hold-back propagation |
| E2 | [system] re-collection is a no-op; user body preserved | PASS | 002 dedup via 003 index |

## Known residual limitations

- No cross-spec integration invariant was violated. The producer/consumer agreement holds
  in both directions: everything 001 rejects fails to produce a downstream artifact, and
  everything 002 produces is a valid 003 record whose note mirrors exactly the FR-002
  subset (nothing outside it leaks).
- The chain is driven through `runCollectionPass` directly (injected candidates + stub
  enrichment map), not through the live `startScheduler`/`queryArxiv` path — that
  scheduler/network entry is out of scope here and is SKIP-documented in the 002
  spec-test. The seam that matters for integration (the `Paper` 002 hands to 003's persist
  hook) is exercised with real code on both sides.
- `C5`'s leak check probes the distinctive `embeddingModel` id and a non-zero vector value
  (a long decimal); it does not attempt to prove the absence of every possible numeric
  coincidence, but the mirrored-subset key check (every frontmatter key ∈ the FR-002
  subset) is the load-bearing guarantee and is asserted exhaustively.

## Raw test output

```
[PASS] C1 — [001→002] promote() honors 001 hold-back and yields a Paper 001 accepts
[PASS] C2 — [001→002] enrichment references are valid 001 sourceIds; the enriched Paper passes 001 isValidPaper
[PASS] C3 — [001→002] the subscription store emits records 001 isValidSubscription accepts
[PASS] C4 — [002→003] the Paper 002 produces round-trips through 003's record; note frontmatter mirrors the shared subset
[PASS] C5 — [002→003] non-mirrored fields (references/embedding/timestamps/schemaVersion) never leak into the note
[PASS] E1 — [system] A batch built at 001 flows through 002 into 003; valid papers round-trip, held-back never appear, dup collapses
[PASS] E2 — [system] Re-collecting the same batch is a no-op that preserves the user body (002 dedup + 003 keying)

Summary: 7 passed, 0 failed, 0 skipped
```
