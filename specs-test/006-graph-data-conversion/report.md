# Spec-test report: 006-graph-data-conversion

Deterministic, in-process assertion suite for `src/graph/` against the design in
`specs/006-graph-data-conversion/`. Every input is an in-memory `Paper` fixture and a
fake store/cache seam — no live network, no real Obsidian API. The transitive
`obsidian` import (from the SPECTER2 canonical-space constants) is replaced by
`_obsidian-shim.ts`; the lazy `@huggingface/transformers` import (reached only for its
constants) is never executed.

## Run

```bash
npx esbuild specs-test/006-graph-data-conversion/006-graph-data-conversion.spec-test.ts \
  --bundle --platform=node --format=cjs \
  --alias:obsidian=./specs-test/006-graph-data-conversion/_obsidian-shim.ts \
  --external:@huggingface/transformers \
  --outfile=<scratch>/006.cjs && node <scratch>/006.cjs
```

## Result (latest)

**16 passed, 0 failed, 2 skipped.**

| ID | Scenario | Status | Spec |
|----|----------|--------|------|
| US1.nodes | One node per record with a year; fields from the record | PASS | FR-001/FR-002, SC-001 |
| US1.year-less | Year-less record excluded | PASS | FR-002 |
| US1.malformed | Malformed record skipped, rest convert, never throws | PASS | FR-006, SC-003 |
| US1.edge | A cites B → directional A→B, no reverse | PASS | FR-003/FR-004, SC-002 |
| US1.dangling | Reference to a non-stored paper dropped, no fabricated node | PASS | FR-005 |
| US1.self-loop | Self-reference produces no self-loop | PASS | FR-003 |
| US1.cycle | A↔B produces both edges, no loop/failure | PASS | Edge Cases |
| US1.empty-refs | Empty references → no edges; node keeps `citationsKnown` | PASS | FR-003 (OQ-1) |
| US1.uncited | `uncited` = shared `isUncited`, never inbound degree | PASS | FR-012, SC-008 |
| US1.data-only | Output is exactly `{nodes, connections, basisModel}`; empty corpus → empty | PASS | FR-007, SC-004 |
| US2.deterministic | Same corpus (fresh cache) → byte-identical positions | PASS | FR-009, SC-005 |
| US2.similarity | Content-similar embeddings land closer than dissimilar | PASS | SC-005 |
| US2.out-of-sample | Adding a canonical paper below threshold keeps positions, no re-save | PASS | FR-010, SC-006 |
| US2.refit | Crossing the growth threshold refits (re-saves) the basis | PASS | FR-010 |
| US2.fallback | Pending/non-canonical → deterministic fallback, not mixed into the fit | PASS | FR-011, SC-007 |
| US2.no-reembed | Never re-embeds; a pending node projects only once its record is canonical | PASS | FR-011 |

## SKIP (with reasons)

| ID | Scenario | Reason |
|----|----------|--------|
| saveData-persist | Real basis cache persists through `this.saveData`/`loadData` | Plugin wiring is 007/008 scope; this suite uses the in-memory `BasisCache` fake (`contracts/graph-conversion-api.md`). |
| render | Nodes/edges/positions drawn on screen | Rendering is 007; 006 produces data only (FR-007). |

## Notes

- `isUncited` was relocated to `src/models/uncited.ts` (OQ-5); the 004 spec-test import was repointed and 004 still passes (`30 passed, 0 failed`).
- SPECTER2 canonical space: `SPECTER2_EMBEDDING_MODEL = local-specter2-proximity-v1-d768`, `SPECTER2_EMBEDDING_DIM = 768` — imported read-only from 002's `localTransformer.ts`, never re-declared.
