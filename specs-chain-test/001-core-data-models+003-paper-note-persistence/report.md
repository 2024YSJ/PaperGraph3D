# specs-chain-test report: 001-core-data-models → 003-paper-note-persistence

- **Chain**: `001-core-data-models` → `003-paper-note-persistence` (upstream `Paper` producer → downstream persistence)
- **Source branch**: `develop-feature/003-paper-note-persistence`
- **Date**: 2026-07-08
- **`tsc --noEmit`**: PASS (exit 0 — `src/` type-checks; `specs-chain-test/` is outside `tsconfig` include)
- **Result**: **10 passed / 0 failed / 0 skipped**

Both specs are implemented (`src/models/paper.ts`, `src/persistence/*`), so every seam is exercised end-to-end with real code on both sides — no SKIP links.

## Seam map (001 → 003)

| Seam | Where it is stated | Status | Scenarios |
|------|--------------------|--------|-----------|
| S1 — record wraps a serialized 001 `Paper` under `paper` | 003 FR-016 | ✅ exercised (both sides implemented) | C1, C7 |
| S2 — note frontmatter mirrors 001's shared field subset (`title`/`authors`/`publicationYear`/`citationCount` + `readState`/`pg3d_sourceId`) | 003 FR-002 | ✅ exercised | C2, C3 |
| S3 — 001 embedding fields persist in the record, never in the note | 001 FR-019 / 003 FR-022, SC-008 | ✅ exercised | C4 |
| S4 — 001 `sourceId` is 003's pairing / dedup / filename key | 001 FR-015 / 003 FR-007, FR-009 | ✅ exercised | C5 |
| S5 — a `Paper` 001 holds back (missing/NaN year) never becomes a valid 003 record | 001 FR-009/010 → 003 (negative) | ✅ exercised | C6 |

## Whole-system flow

Pipeline threaded: **001 `candidate` → `toPaper()` (promote) → `isValidPaper()` (gate) → 003 `PaperStore.upsert()` → record `.json` + note `.md` pair → `get()` read-back**.

The artifact travelled the **entire** chain — no unimplemented seam interrupted it — so all three system-level invariants were asserted as real cases (no `E<k>b` remainder):

- **E1** — round-trip fidelity: a 001 Paper deep-equals its value after `upsert → get`, and a user-owned note body survives a downstream update (emergent: round-trip + user-region invariance across both specs).
- **E2** — emergent negative: a 001-held-back candidate (`NaN` year) yields no valid Paper, and nothing is persistable/enumerable downstream (upstream reject ⇒ nothing valid anywhere downstream).
- **E3** — emergent idempotency: re-threading the same 001 Paper produces a single pairing and no shape drift.

## Scenarios

| id | pair / seam | status | note |
|----|-------------|--------|------|
| C1 | [001→003] S1 wrap/unwrap | PASS | `unwrap(wrap(paper))` deep-equals the 001 Paper; wrapper metadata attached |
| C2 | [001→003] S2 frontmatter mirror | PASS | every shared field equals the nested Paper; `pg3d_sourceId == sourceId` |
| C3 | [001→003] S2 negative (no leak) | PASS | references/abstract/embedding/schemaVersion/citationsKnown absent from frontmatter |
| C4 | [001→003] S3 embedding | PASS | embedding in record; no embedding text in any note region |
| C5 | [001→003] S4 sourceId key | PASS | pairing keyed by the 001 sourceId; `get()` reads it back |
| C6 | [001→003] S5 negative gate | PASS | missing & NaN year held back; pre-validation shape not a valid Paper |
| C7 | [001→003] S1 promotion semantics | PASS | `citationsKnown=false`, count 0, `[]` refs round-trip through the record |
| E1 | [system] full round-trip | PASS | deep-equal after persist+read; user body preserved through an update; embedding threaded |
| E2 | [system] negative end-to-end | PASS | held-back paper → store stays empty (`has` false, `all()` yields nothing) |
| E3 | [system] idempotency | PASS | repeated persist → single pairing, 001 shape unchanged |

## Known residual limitations

Cross-spec behaviors observed but **outside this suite's asserted scope** (notes, not failures — none contradicts a stated integration invariant):

- **003 trusts the producer at the wrap seam.** `wrap()`/`migrate()` do **not** re-run 001's `isValidPaper()` on the nested `paper`; the "a 001-rejected Paper never becomes a valid record" invariant (C6/E2) holds because 001's `toPaper()` gate blocks the value at the **producer** (002/005), and 003 assumes a canonical `Paper` input (003 Assumptions). A caller that hand-forged an invalid `Paper` and called `wrap()` directly would bypass the gate — this is an accepted producer-trust seam, not a 003 defect.
- **Note is a lossy view by design.** `abstract`, raw `references`, and the embedding are recoverable only from the JSON record, never the note (003 FR-002, confirmed by C3/C4). The full-fidelity round-trip (E1) therefore flows through the JSON record, not the note.
- **Pending-embedding identity across the chain** is covered indirectly: E1 threads a non-null embedding. The null (pending) embedding's cross-update preservation is asserted in the single-spec `/spec-test` (SC-007), not re-asserted here.

## Raw test run

```text
[PASS] C1 — [001->003] a valid 001 Paper wraps into a 003 record and unwraps identically
[PASS] C2 — [001->003] every shared frontmatter field equals the nested 001 Paper
[PASS] C3 — [001->003] non-mirrored 001 fields (references/abstract/embedding) do not leak into the note
[PASS] C4 — [001->003] the 001 embedding is carried in the record but absent from every note region
[PASS] C5 — [001->003] 003 keys the pairing by the exact 001 sourceId and reads it back
[PASS] C6 — [001->003] a paper 001 rejects (missing / NaN year) never produces a downstream artifact
[PASS] C7 — [001->003] 001 promotion defaults (citationsKnown=false, count 0) round-trip through the record
[PASS] E1 — [system] a 001 Paper round-trips through 003 persist+read unchanged, user body preserved
[PASS] E2 — [system] a 001-held-back paper produces nothing persistable across the whole chain
[PASS] E3 — [system] re-persisting the same 001 Paper is idempotent and preserves the 001 shape
Summary: 10 passed, 0 failed, 0 skipped
```
