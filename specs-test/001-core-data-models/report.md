# spec-test report: 001-core-data-models

- **Spec**: `specs/001-core-data-models/spec.md`
- **Source branch**: `develop-feature/001-core-data-models`
- **Date**: 2026-07-05
- **`tsc --noEmit`**: PASS (src type-checks)
- **Result**: **17 passed / 0 failed / 3 skipped**

The currently implemented `src/models/{subscription,paper,settings}.ts` satisfies every
executable Acceptance Scenario, Success Criterion, and Edge Case of this spec. The three
SKIPs are things not verifiable at the data-model layer (a process outcome; the dedup
mechanism owned by 002; applying the default interval on creation, owned by 002/008).

Coverage goes beyond field-presence checks: present-but-wrong-type inputs, invalid
collection elements (the `authors`/`references` `.every()` branches), the empty/`null`/string
publication-year boundary through the combined `toPaper`+`isValidPaper` gate, the
empty-string vs concrete-default asymmetry, and the spec's Edge Cases.

## Cases

| id | scenario / SC / edge | status | note |
|----|----------------------|--------|------|
| US1.1 | Valid subscription (all fields) is valid | PASS | 3 types + numeric lastCheckedAt |
| US1.2 | Interval outside 6/12/24/48/72 rejected, prior unchanged | PASS | all 5 accepted; 10/0/-6/36/24.5 keep prior |
| US1.3 | Subscription missing/wrong-typed attribute is invalid | PASS | field-drop + wrong-type + bad/non-string enum |
| US2.1 | Paper with all attributes + known year is valid | PASS | incl. empty references |
| US2.2 | Unknown/empty year held back until real year known | PASS | undefined→held; null/string never valid; promotion round-trip |
| US2.3 | Paper missing/malformed attribute is invalid | PASS | field-drop + wrong-type + bad element + unknown-provider id |
| US3.1 | New settings resolve to complete defaults | PASS | layout+colorScheme checked; defaults valid |
| US3.2 | Settings missing/malformed group is invalid | PASS | field-drop + empty/wrong-type + partial graph options |
| SC-001 | Later features definable from this spec alone | SKIP | Process/documentation outcome — not code-verifiable |
| SC-002 | 100% invalid subscriptions identified | PASS | field-drop + 8 bad intervals |
| SC-003 | 100% invalid papers identified | PASS | field-drop over all fields |
| SC-004 | 100% new settings resolve to complete, valid defaults | PASS | each group proven load-bearing via drop |
| SC-005 | Provider-encoded, collision-free sourceId | PASS | accept/reject + distinct prefixes |
| SC-005-dedup | Actual deduplication by sourceId | SKIP | dedup mechanism owned by 002 |
| EC-1 | No-year paper held back, not discarded; reconsidered later | PASS | candidate unmutated; promotes once year known |
| EC-2 | Out-of-range interval rejected, keeps previous valid value | PASS | prior 6/72 kept; valid change applied |
| EC-3 | Type outside keyword/author/arXiv category rejected | PASS | unknown + empty type |
| EC-4 | No explicit interval → default 24h (an allowed value) | PASS | `DEFAULT_CHECK_INTERVAL_HOURS === 24`, in allowed set |
| EC-4-apply | Applying the default on subscription creation | SKIP | creation logic owned by 002/008 |
| EC-5 | First run: full default settings available and valid | PASS | complete valid set |

## Known residual limitations (not failures)

- `isValidPaper` treats `NaN` as a valid year (`typeof NaN === 'number'`, no finite check). A
  paper built from a bad numeric parse could slip through. Not asserted here; flagged for a
  possible `Number.isFinite` guard in `src/models/paper.ts`.
- `isValidSubscription` accepts an empty-string `value`/`label` (no length check), unlike
  settings' `storageLocation`. Left as an observed, unspecified leniency rather than a failure.

## Raw test output

```text
[PASS] US1.1 — A subscription with a valid type/value/label/interval/last-checked/enabled is recognized as valid
[PASS] US1.2 — A check interval outside 6/12/24/48/72 is rejected and leaves the prior interval unchanged
[PASS] US1.3 — A subscription missing a required attribute is identified as invalid
[PASS] US2.1 — A paper with all required attributes and a known year is recognized as valid
[PASS] US2.2 — A paper with an unknown or empty publication year is held back until a real year is known
[PASS] US2.3 — A paper missing or malformed in a required attribute is identified as invalid
[PASS] US3.1 — Newly-loaded settings resolve to complete defaults (storage location, summarization, graph options)
[PASS] US3.2 — Settings missing or malformed in one of the three groups are identified as invalid
[SKIP] SC-001 — Every later feature can define its data needs by referencing only this spec (Process/documentation outcome — not verifiable by executing code.)
[PASS] SC-002 — 100% of subscriptions missing an attribute or using a bad interval are invalid
[PASS] SC-003 — 100% of papers missing a year or any attribute are invalid
[PASS] SC-004 — 100% of newly loaded settings resolve to a complete, valid default set
[PASS] SC-005 — A paper source identifier is provider-encoded and collision-free across providers
[SKIP] SC-005-dedup — Actual deduplication of papers by source identifier (001 only guarantees the id is collision-free; performing deduplication is owned by collection (002), so the dedup mechanism is not verifiable at the data-model layer.)
[PASS] EC-1 — A paper with no known year is held back, not discarded — and can be reconsidered once a year is known
[PASS] EC-2 — An out-of-range interval is rejected and the subscription keeps its previous valid interval
[PASS] EC-3 — A subscription type outside keyword/author/arXiv category is rejected
[PASS] EC-4 — A subscription created without an explicit interval receives the default (24h, an allowed value)
[SKIP] EC-4-apply — Actually applying the default interval when a subscription is created without one (001 exports the default constant; applying it during subscription creation is owned by collection/UI (002/008).)
[PASS] EC-5 — On first run (nothing saved), the full set of default settings is available and valid

Summary: 17 passed, 0 failed, 3 skipped
```

## Verification method

Generated by `/spec-test`. Test derived from the spec's Acceptance Scenarios, Success
Criteria, and Edge Cases (with negative cases covering wrong types and invalid collection
elements), run against the real `src/models` exports via esbuild + node (the repo's
no-test-runner convention). Report-only — no source code was modified.
