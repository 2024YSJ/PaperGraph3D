# Chain test report: 001-core-data-models → 002-subscription-paper-collection → 003-paper-note-persistence

- **Chain (upstream → downstream):** `001-core-data-models` → `002-subscription-paper-collection` → `003-paper-note-persistence`
- **Source branch:** `develop` (all three specs implemented and integrated: `src/models`, `src/collection`, `src/persistence`)
- **Date:** 2026-07-09
- **`tsc --noEmit` (src gate):** PASS
- **Counts:** 7 passed / 0 failed / 2 skipped

## Seam map

| Pair | Seam | Status | Sides |
|---|---|---|---|
| 001 → 002 | `parseArxivEntry` / `parseArxivAtom` emit a 001 `PaperCandidate` from arXiv XML | ⏭ SKIP | 002 impl present, but DOM (`@xmldom/xmldom`) not installed offline |
| 001 → 002 | `promote()` defers to 001's `toPaper` (promotion + unknown-vs-zero + hold-back rules) | ✅ exercised | both implemented |
| 001 → 002 | `runCollectionPass` year-gate (FR-011) honors 001's missing/NaN-year hold-back | ✅ exercised | both implemented |
| 002 → 003 | `PipelineHooks.persist` / `alreadyPersisted` filled by `PaperStore.upsert` / `has` | ✅ exercised | both implemented |
| 002 → 003 | note frontmatter mirrors the FR-002 shared subset of the 001 `Paper` | ✅ exercised | both implemented |
| 002 → 003 | non-subset fields (references/embedding/schemaVersion) do not leak to the note | ✅ exercised | both implemented |

Only the **XML front-door** seam is SKIP, and solely because `@xmldom/xmldom` (a dev-only
dependency the 002 spec-test also relies on) is not installed in this environment — not
because any code is missing. Every other seam runs against real exports on both sides.

## Whole-system flow

Pipeline threaded end-to-end through the real 002 pipeline:

```
PaperCandidate[001 shape] ──runCollectionPass()[002: year-gate → dedup → enrich → promote()=001.toPaper]──▶ persist hook ──PaperStore[003: wrap → record+note]──▶ get()/all() ──▶ Paper
```

- **E1 [system] — asserted (PASS).** A mixed batch is threaded through the **actual**
  `runCollectionPass` into a **real** `PaperStore`: an enriched paper emerges with
  `citationsKnown=true`/cc 42, an arXiv-only paper with `citationsKnown=false`/cc 0, a
  yearless paper is dropped by the FR-011 gate, and a duplicate `sourceId` is dropped by the
  FR-009 dedup. Each survivor read back through 003 equals `001.toPaper()` of the same
  post-enrichment candidate. This is the emergent, whole-pipeline property no single-seam or
  single-spec test catches: gate + dedup + enrich-apply + promote + persist all cooperating.
- **E2 [system] — SKIP.** The same flow starting one seam earlier (arXiv **XML** →
  `parseArxivAtom` → pipeline → store) needs `@xmldom/xmldom`. E1 asserts the longest
  offline-exercisable prefix (candidate → pipeline → store), so only the XML parse of the
  front-door is unverified here.

The artifact travelled the entire chain from a 001-shaped candidate to a persisted,
re-readable 003 record; the only unexercised step is turning raw arXiv XML into that
candidate.

## Scenarios

| id | pair / seam | status | note |
|---|---|---|---|
| C1 | 001→002 promote | PASS | arXiv-only candidate → valid 001 Paper (cc 0 / citationsKnown false / refs [] / embedding null) |
| C2 | 001→002 promote (negative) | PASS | missing/NaN-year candidate is never promoted (001 hold-back honored by 002) |
| C3 | 001→002 pipeline | PASS | `runCollectionPass` year-gate drops a yearless candidate before persist; no files written |
| C4 | 002→003 hooks | PASS | `PaperStore` satisfies `PipelineHooks.persist/alreadyPersisted` (compiles + runs) |
| C5 | 002→003 note | PASS | frontmatter mirrors title/publicationYear/citationCount/sourceId |
| C6 | 002→003 note (negative) | PASS | references/embedding/embeddingModel/schemaVersion/abstract/createdAt do not leak to frontmatter |
| C7 | 001→002 parse | SKIP | `parseArxivAtom` needs `@xmldom/xmldom` (not installed) |
| E1 | [system] | PASS | mixed batch → real pipeline → real store: gate + dedup + enrich + promote + persist all honored, round-trip equals `toPaper` |
| E2 | [system] | SKIP | XML front-door (`parseArxivAtom`) needs `@xmldom/xmldom` |

## Known residual limitations

Notes, not failures — none violates a stated integration invariant.

- **XML front-door unverified offline.** `parseArxivEntry`/`parseArxivAtom` (the only place a
  raw arXiv Atom document becomes a 001 candidate) require a DOM. The chain is instead
  entered with candidates built in the exact shape that parser emits. Installing
  `@xmldom/xmldom` as a devDependency would let C7/E2 run and close this.
- **Enrichment is stubbed.** E1 supplies the Semantic Scholar outcome via a stub `enrich`
  (offline), exactly as `runCollectionPass`'s injection point intends; the live
  Semantic Scholar call path is covered by 002's own spec-test, not here.
- **Wiring vs. contract.** This suite proves the three specs *can* run as one pipeline via
  their real exports; it does not assert `src/main.ts` wires them (its pipeline hooks are
  still stubs pending production wiring, ~008).
- **Summarize seam** (`PipelineHooks.summarize?`, 004) is intentionally out of this chain;
  E1 runs with summarization disabled.

## Raw test output

```
[PASS] C1 — [001->002 promote] promote() turns an arXiv-only 001 candidate into a valid Paper (citationsKnown=false)
[PASS] C2 — [001->002 promote] a candidate 001 holds back (missing/NaN year) is never promoted by 002
[PASS] C3 — [001->002 pipeline] runCollectionPass drops a yearless candidate before it can reach persist
[PASS] C4 — [002->003 hooks] PaperStore satisfies 002 PipelineHooks.persist/alreadyPersisted
[PASS] C5 — [002->003 note] note frontmatter mirrors the promoted Paper subset
[PASS] C6 — [002->003 note] references/embedding/schemaVersion do not leak into frontmatter
[SKIP] C7 — [001->002 parse] parseArxivAtom emits valid 001 candidates from arXiv XML (@xmldom/xmldom devDependency not installed; DOM unavailable offline)
[PASS] E1 — [system] mixed candidate batch -> runCollectionPass(002) -> PaperStore(003) round-trips with gate/dedup/enrich all honored
[SKIP] E2 — [system] arXiv XML -> parseArxivAtom(002) -> runCollectionPass -> PaperStore, full front-to-back (@xmldom/xmldom devDependency not installed; XML front-door not exercisable offline)
Summary: 7 passed, 0 failed, 2 skipped
```
