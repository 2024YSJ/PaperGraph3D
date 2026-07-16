# Spec-test report: 001-core-data-models

> **[Re-run 2026-07-16 — 21 passed, 0 failed, 6 skipped]**
>
> `SC-007`'s "llm source valid" assertion is inverted: `embeddingSource: 'llm'` is now
> rejected. That is also why `persistence/record.ts`'s `migrate()` must reset legacy
> `llm` vectors to pending *before* validation — reaching `isValidPaper()` with one
> would read as a corrupt record and lose the paper.

- **Spec**: `specs/001-core-data-models/spec.md`
- **Source branch**: `develop-feature/embedding-redesign`
- **Date**: 2026-07-16
- **`tsc --noEmit`**: PASS
- **Result**: **21 passed, 0 failed, 6 skipped**

Verifies the current `src/models/{subscription,paper,settings}.ts` exports
(`isValidSubscription`, `assignCheckInterval`, `isValidPaper`, `toPaper`,
`isPaperSourceId`, `isValidPluginSettings`, `DEFAULT_*`) against the spec's
acceptance scenarios, success criteria, and edge cases. Report-only.

| id | scenario / SC | status | note |
|----|---------------|--------|------|
| US1.1 | Subscription with all 6 attrs + allowed interval is valid (each type) | PASS | |
| US1.2 | Interval outside {6,12,24,48,72} rejected, prior value kept | PASS | `assignCheckInterval` + validator |
| US1.3 | Missing / wrong-typed required attribute → invalid | PASS | all 6 fields + wrong-type each |
| US2.1 | Paper with all required attrs + known year is valid | PASS | |
| US2.2 | Unknown/empty publication year held back (not valid) | PASS | undefined/null/''/non-numeric |
| US2.3 | Missing / wrong-typed required attribute → invalid | PASS | incl. array non-array + bad element |
| US3.1 | Default settings carry all three groups and validate | PASS | |
| US3.2 | Settings missing / wrong-typed group → invalid | PASS | |
| EC-1 | No-year successful response held back, not discarded | PASS | `toPaper` → undefined, candidate preserved |
| EC-1-repass | Re-evaluation on next scheduled check | SKIP | owned by collection (002) |
| EC-2 | Non-finite year (NaN/Infinity) held back | PASS | |
| EC-3 | Valid year + unconfirmed citations still promoted (0/[]/false) | PASS | |
| EC-4 | Interval outside list rejected, previous kept | PASS | |
| EC-5 | Subscription type outside the three rejected | PASS | |
| EC-6 | Default interval (24h) exists and is an allowed value | PASS | |
| EC-6-apply | New subscription with no interval receives the default | SKIP | owned by store `register` (002) |
| EC-7 | First-run (unsaved) settings fall back to full valid defaults | PASS | |
| EC-7-load | Plugin actually loads/uses defaults on first run | SKIP | owned by assembly (008) |
| SC-001 | Later features reference only this spec | SKIP | process claim, not code-verifiable |
| SC-002 | 100% of malformed subscriptions invalid | PASS | field deletions + bad intervals |
| SC-003 | 100% of malformed papers invalid | PASS | year/citation/citationsKnown/missing battery |
| SC-004 | Newly loaded settings resolve to a complete default set | PASS | |
| SC-005 | sourceId structurally encodes provider (no cross-provider collision) | PASS | `isPaperSourceId` |
| SC-005-dedup | Papers actually deduplicated using sourceId | SKIP | owned by 002/003 |
| SC-006 | Promoted papers carry accurate `citationsKnown` | PASS | known/confirmed-0/unknown |
| SC-007 | Valid papers carry embedding + accurate model/source | PASS | pending + real + bad-vector/source |
| SC-007-projection | No two papers from different model spaces projected together | SKIP | owned by graph conversion (006) |

## Known residual limitations

These are leniencies observed in the current validators. They are **within**
this spec's stated guarantees (which require only "a finite number"), so they are
notes, not failures — but downstream features should not assume value plausibility:

- `isValidPaper` accepts any **finite** `publicationYear`, including implausible
  values (`0`, negative, `999999`). The spec fixes only finiteness (FR-009); no
  year-range check exists.
- `isValidSubscription` accepts any **number** `lastCheckedAt` (negative, far
  future). The spec fixes only "number or null" (FR-006); no range check.
- The optional 002 extension fields (`coveredFrom`, `backfillState`) and the
  optional embedding-provider settings (`embeddingProvider`, `localEmbeddingModel`)
  validate as absent-by-default; their presence forms are exercised in the 002
  suite, not here.

## Raw test output

```
[PASS] US1.1 — A subscription with all 6 attrs + an allowed interval is valid (each type)
[PASS] US1.2 — A check interval outside {6,12,24,48,72} is rejected and the prior value kept
[PASS] US1.3 — A subscription missing (or wrong-typed on) any required attribute is invalid
[PASS] US2.1 — A paper with all required attributes + a known year is valid
[PASS] US2.2 — A paper with unknown/empty publication year is held back (not valid)
[PASS] US2.3 — A paper missing (or wrong-typed on) a required attribute is invalid
[PASS] US3.1 — Default settings carry all three groups and validate
[PASS] US3.2 — Settings missing (or wrong-typed on) one of the three groups is invalid
[PASS] EC-1 — Successful response with no year: candidate held back, not discarded (still usable)
[SKIP] EC-1-repass — Re-evaluation of a held-back candidate on the next scheduled check (Re-fetch/re-validate loop is owned by collection (002), not this layer)
[PASS] EC-2 — A non-finite year (NaN/Infinity) is treated like unknown — held back
[PASS] EC-3 — A valid year with unconfirmed citations is still promoted (0 / [] / citationsKnown=false)
[PASS] EC-4 — A check interval outside the list is rejected, previous value kept
[PASS] EC-5 — A subscription type other than the three allowed is rejected
[PASS] EC-6 — A default check interval (24h) exists and is itself an allowed interval
[SKIP] EC-6-apply — A newly created subscription with no interval receives the default (Applying the default at registration is owned by the store (002 register))
[PASS] EC-7 — First-run (unsaved) settings fall back to a full, valid default set
[SKIP] EC-7-load — On first run the plugin actually loads/uses these defaults (loadData/first-run wiring is owned by assembly (008))
[SKIP] SC-001 — Every later feature can define its data needs by referencing only this spec (Cross-feature/process claim, not code-verifiable at this layer)
[PASS] SC-002 — 100% of subscriptions missing an attribute or using a bad interval are invalid
[PASS] SC-003 — 100% of malformed papers (no/non-finite year, bad citation, bad citationsKnown, missing attr) are invalid
[PASS] SC-004 — 100% of newly loaded settings resolve to a complete default set (no missing group)
[PASS] SC-005 — A sourceId structurally encodes its provider so two providers can never collide
[SKIP] SC-005-dedup — Papers are actually deduplicated using the sourceId (Dedup execution is owned by collection/persistence (002/003))
[PASS] SC-006 — 100% of promoted papers carry a citationsKnown that reflects whether citations were confirmed
[PASS] SC-007 — Valid papers carry a content embedding + accurate embeddingModel/embeddingSource
[SKIP] SC-007-projection — No two papers from different model spaces are ever projected together (Projection/space-homogeneity enforcement is owned by graph conversion (006))

Summary: 21 passed, 0 failed, 6 skipped
```
