# Chain-test report: 001 → 002 → 003 → 004 → 005

**Chain**: `001-core-data-models → 002-subscription-paper-collection → 003-paper-note-persistence → 004-paper-summarization → 005-manual-paper-refresh`
(the full implemented feature set, in numeric = upstream→downstream order)

- **Source branch**: `develop-feature/embedding-redesign`
- **Date**: 2026-07-17
- **`tsc --noEmit`**: PASS
- **Result**: **17 passed, 0 failed, 1 skipped**

This is the whole-system chain: it extends the recorded `001+002+003+005` thread by
threading **004's summarization seam** through the middle. 002's collection pass (and
005's refresh) drive 004's **real** `createSummarizeHook` + `isUncited` + `runGeneration`
gating; the resulting `SummaryResult` is persisted by 003 into the note's managed body.
Every seam is exercised against real `src/` code on both sides. Deterministic: the arXiv
/ Semantic Scholar network is a programmable `requestUrl` shim (`_obsidian-shim.ts`, via
`--alias:obsidian`) and the summarization **provider** — 004's single external boundary —
is an in-process fake behind the real `SummarizationProvider` interface (the same seam the
004 spec stubs). No live network call is made. Report-only; no `src/` changes.

Build: `--alias:obsidian=./specs-chain-test/<chain-id>/_obsidian-shim.ts --external:@huggingface/transformers`.

## Seam map

| pair | seam | status |
|------|------|--------|
| 001 → 002 | `promote()`/`toPaper()` lift a `PaperCandidate` to a 001-valid `Paper`; `citationsKnown` mirrors enrichment; a 001-rejected year (missing/NaN) never promotes | **exercised** (C1, C2) |
| 002 → 001 | `computeBaselineEmbedding` attaches a 2048-dim `local` vector that satisfies `isValidPaper`; a pending `null` embedding is also 001-valid | **exercised** (C3) |
| 002/001 → 003 | a promoted+embedded `Paper` round-trips through `PaperStore`; note frontmatter mirrors the FR-002 shared subset; non-subset fields (`schemaVersion`/timestamps/embedding/abstract) do not leak; `references` **is** mirrored (FR-002 amended) | **exercised** (C4, C5) |
| 002 → 004 | 002's pipeline drives `createSummarizeHook` with exactly the 4-field `SummarizationInput` (data minimization); `isUncited` gates future-directions; unconfigured provider / blank credential → `undefined` without crossing the provider boundary | **exercised** (C6, C7, C8) |
| 004 → 003 | a `SummaryResult` persisted via 003 replaces the abstract in the managed body and appends a `## Future directions` section (uncited only); generated text never reaches frontmatter or the user body; no summary → abstract fallback | **exercised** (C9, C10) |
| 002 → 005 | a content-changing refresh recomputes the embedding via 002's `computeBaselineEmbedding`; citations are applied via 002's `parseSemanticScholarPaper`/`toPaperSourceId` (version-stripped) | **exercised** (C11, C12) |
| 004 → 005 | a content-changing refresh regenerates the summary through 004's hook and 003 lands the new summary; a **disabled** refresh never invokes the provider and preserves the stored summary (003 field-scoped merge) | **exercised** (C13, C14) |
| 003 → 005 | refresh reads via `get()` / writes via `upsert()` with the user note body preserved; an absent sourceId makes no provider call and writes nothing | **exercised** (C15, C16) |

## Whole-system flow

`candidate → [002 real pipeline: dedup → batched enrich → promote (001) → baseline embedding
→ 004 summarize hook] → [003 persist record+note] → [005 refresh: re-fetch arXiv content +
S2 citations → recompute embedding → regenerate 004 summary] → [003 read-back]`.

`E1` threads a single artifact through **all five specs** end-to-end and asserts the
emergent invariants no single seam/spec test catches:

- the artifact stays `isValidPaper`-valid after `001→002→003→004→005→003`;
- collection attaches the 004 summary (over the original abstract) into the note, with a
  Future directions section because the paper was **confirmed-uncited** (enriched count 0);
- the tail refresh (newer abstract, now **cited** at 21) **regenerates** the summary — the
  note reflects the new abstract, the stale summary is gone, and the Future directions
  section disappears because the paper is no longer uncited;
- `publicationYear` (the 002/005 window key) stays stable, the embedding stays consistent
  with 002's computation of the new content, and the user-owned note region is untouched.

The artifact reached the end of the chain; nothing in this five-spec flow is unimplemented.
`E2` (a **non-bundled canonical** embedding threaded through the same flow) is the only SKIP:
the local-transformer / LLM upgrade path (002 FR-045/FR-046) is env-gated and falls back to
the baseline while the model is absent, so the whole chain is exercised on the bundled
canonical provider by `E1`.

## Scenario table

| id | pair / seam | status | note |
|----|-------------|--------|------|
| C1 | [001→002] promote → 001-valid Paper; citationsKnown mirrors enrichment | PASS | enriched vs un-enriched (0/false) |
| C2 | [001→002 neg] missing/NaN year never promotes | PASS | producer gate (toPaper) agrees |
| C3 | [002→001] baseline embedding → 001-valid; pending null valid | PASS | 2048-dim / model / source=local |
| C4 | [002/001→003] Paper round-trips; frontmatter mirrors shared subset | PASS | exact JSON round-trip |
| C5 | [001/002→003 neg] non-subset fields don't leak; references mirrored | PASS | FR-002 (amended) |
| C6 | [002→004] pipeline drives hook with 4-field input only | PASS | data minimization (no sourceId/embedding/…) |
| C7 | [002→004] isUncited gate through the real hook | PASS | uncited → FD; cited → '' |
| C8 | [002→004 neg] unconfigured/blank credential → undefined, provider untouched | PASS | |
| C9 | [004→003] summary replaces abstract; FD section; not in frontmatter/user body | PASS | managed-body placement |
| C10 | [004→003 neg] no summary → abstract fallback; cited → no FD section | PASS | two sub-cases |
| C11 | [002→005] content-change refresh recomputes embedding via 002 baseline | PASS | |
| C12 | [002→005] refresh applies citations via 002 parser (version-stripped) | PASS | arxiv:1700.00003 |
| C13 | [004→005] refresh regenerates summary via 004 hook → 003 note | PASS | new abstract in note, stale replaced |
| C14 | [004→005 neg] disabled refresh preserves stored summary, provider untouched | PASS | 003 field-scoped merge |
| C15 | [003→005] refresh reads get()/writes upsert(); user body preserved | PASS | |
| C16 | [003→005 neg] absent sourceId → notFound, no provider call, nothing written | PASS | |
| E1 | [system] full 001→002→003→004→005→003 thread, summary regenerated at tail | PASS | emergent whole-chain invariants |
| E2 | [system] non-bundled canonical embedding threaded through the chain | SKIP | 002 FR-045/FR-046 env-gated; baseline fallback |

## Known residual limitations

- The summarization **provider** is stubbed (in-process fake behind the real
  `SummarizationProvider` interface) — the correct seam to stub, exactly as the 004 spec
  and its own suite do. The real provider adapters' HTTP/parse behavior is covered by the
  004 `/spec-test` suite (`ANTHROPIC.*`, `GEMINI.*`, `PARSE.*`), not re-tested here.
- The non-bundled canonical embedding (local-transformer / LLM upgrade, 002 FR-045/FR-046)
  is env-gated and not shipped, so `E2` is a SKIP and every embedding invariant here is
  asserted against the bundled baseline space. No corpus can hold a mixed-dimensionality
  vector set on this branch, so the projection-homogeneity concern is moot for the chain.
- The scheduler tick/load loop, the bulk-refresh runner's live paging/backoff, and Obsidian
  lifecycle/DOM remain out of scope (their own per-spec SKIP sets); this chain asserts the
  **data-flow** seams, driven by the real pipeline/refresh code paths, not the timing loops.
- No spec-violating cross-spec leniency was found: the shared-subset frontmatter mirror,
  the 4-field summarization minimization, the abstract/summary/future-directions managed-body
  placement, the field-scoped merge on a disabled refresh, and the embedding recompute all
  hold as the downstream specs state.

## Raw test output

```
[PASS] C1 — [001→002] promote() lifts a candidate to a 001-valid Paper; citationsKnown mirrors enrichment
[PASS] C2 — [001→002 negative] a candidate 001 rejects (missing/NaN year) never promotes — nothing can flow downstream
[PASS] C3 — [002→001 embedding] 002's baseline embedding produces a 001-valid embedded Paper (pending null also valid)
[PASS] C4 — [002/001→003] a promoted+embedded Paper round-trips through 003 store; note frontmatter mirrors the shared subset
[PASS] C5 — [001/002→003 negative] fields OUTSIDE the shared subset do not leak into the note frontmatter (003 FR-002)
[PASS] C6 — [002→004] 002's pipeline drives 004's createSummarizeHook with EXACTLY the 4-field SummarizationInput — no full Paper leaks across the seam
[PASS] C7 — [002→004 gating] 004's isUncited gate — confirmed-uncited yields future-directions; a cited paper yields '' — as reached through the real hook
[PASS] C8 — [002→004 negative] an unconfigured provider or empty credential yields undefined and never calls the provider (abstract fallback upstream)
[PASS] C9 — [004→003] a SummaryResult persisted through 003 replaces the abstract in the note's managed body and appends a Future directions section — never in frontmatter or user body
[PASS] C10 — [004→003 negative] with no summary (unconfigured provider) the managed body falls back to the abstract; a cited paper's note carries no Future directions section
[PASS] C11 — [002→005] a content-changing refresh recomputes the embedding via 002's computeBaselineEmbedding
[PASS] C12 — [002→005] a single refresh applies citations parsed by 002's parseSemanticScholarPaper/toPaperSourceId (version-stripped)
[PASS] C13 — [004→005] a content-changing refresh regenerates the summary via 004's hook and 003 lands the new summary (reflecting the new abstract) in the note
[PASS] C14 — [004→005 negative] with summarization disabled, a content-changing refresh leaves the stored summary untouched (003 field-scoped merge)
[PASS] C15 — [003→005] refresh reads via 003 get() and writes via 003 upsert(); the user-owned note body is preserved
[PASS] C16 — [003→005 negative] refresh of a sourceId absent from the 003 store makes no provider call and writes nothing
[PASS] E1 — [system] candidate → REAL 002 pipeline + REAL 004 summarize → 003 note → 005 refresh regenerates → 003 read-back stays 001-valid, note reflects the new summary, user body intact
[SKIP] E2 — [system] LLM/local-transformer canonical embedding threaded through collection + refresh (the non-bundled canonical embedding provider (002 FR-045/FR-046) is env-gated and stubbed (upgradeEmbedding/computeCanonicalEmbedding return the baseline while the model is absent); the whole chain is exercised on the bundled canonical provider by E1)

Summary: 17 passed, 0 failed, 1 skipped
```
