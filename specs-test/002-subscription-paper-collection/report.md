# Spec-test report: 002-subscription-paper-collection

> **[Re-run 2026-07-17 — 28 passed, 0 failed, 16 skipped]**
>
> This suite had not compiled since merge commit `a657b9e`, which introduced an
> `SC-014` check without its closing `});`, without the `startScheduler` /
> `enrichFromSemanticScholar` imports it needs, and without the fixed `now` clock the
> other scheduler checks declare. `EC-8`/`EC-9`/`SC-014` therefore never ran. The merge
> damage was mechanical, not a real defect in `src/`, and was already repaired in test
> commit `22de90c`; this re-run confirms all 28 pass and refreshes the table + raw block,
> which the earlier banner had corrected the count on but left un-synced.

- **Spec**: `specs/002-subscription-paper-collection/spec.md`
- **Source branch**: `develop-feature/embedding-redesign`
- **Date**: 2026-07-17
- **`tsc --noEmit`**: PASS
- **Result**: **28 passed, 0 failed, 16 skipped**

Verifies the current `src/collection/*` + `src/models/*` implementation against the
spec's acceptance scenarios, success criteria, and edge cases. **Deterministic**: no
live network. Scenarios that depend on the scheduler tick/load loop, live
arXiv/Semantic Scholar calls, the Obsidian `Plugin` lifecycle, or DOM (arXiv Atom
parsing uses `DOMParser`) are recorded as SKIP with a reason — the pure logic they sit
on (window math, dedup, promotion, JSON parsing, embedding, store state) is asserted
directly. `_obsidian-shim.ts` is retained only as an esbuild `--alias:obsidian` target
so the import graph resolves; the asserted cases never invoke `requestUrl`. Built with
`--alias:obsidian=./specs-test/002-subscription-paper-collection/_obsidian-shim.ts` and
`--external:@huggingface/transformers`.

| id | scenario / SC | status | note |
|----|---------------|--------|------|
| US1.1 | Register → new sub with default interval, in list | PASS | default 24h, enabled, lastCheckedAt null |
| US1.5 | Register without label → label defaults to value | PASS | |
| US1.6/SC-009 | Idempotent on (type,value); no duplicate | PASS | new label/interval ignored on hit |
| US1.4 | setCheckInterval: only 5 allowed; else keep prior | PASS | |
| US1.2/US1.3 | Disable flips enabled; delete removes | PASS | store-level |
| SC-014-cb | onRegistered fires once, only on genuinely-new | PASS | |
| FR-025/SC-011 | Empty/whitespace value rejected; nothing created | PASS | |
| US2.2/US3.2 | recordChecked advances lastCheckedAt; coveredFrom once; never backward | PASS | FR-006/FR-024 |
| US3.1-window/SC-018/FR-030 | First check → 24h look-back window | PASS | |
| EC-window-normal | Subsequent window = [lastCheckedAt, now] | PASS | |
| FR-024 | Clock-backward → empty window | PASS | |
| SC-020/FR-041 | Lag re-scan window, clamped to coveredFrom, undefined on first/backward | PASS | |
| EC-8 | Batch enrichment rejects an arXiv-id-mismatched record → transientFailure | PASS | positional-misalignment guard |
| EC-9 | Batch enrichment accepts an arXiv-id-matched record (control) → enriched | PASS | |
| SC-014 | New sub's first check fires on registration, not on the next tick | PASS | immediate on-register check |
| US2.3/SC-004 | Same paper twice → processed once (dedup) | PASS | via runCollectionPass |
| US4.2 | Semantic Scholar JSON → citation shape, arXiv ids version-stripped | PASS | + toPaperSourceId mapping |
| US4.3 | Unenriched promotion → 0 / [] / citationsKnown false | PASS | |
| US4.4/SC-007 | Enriched → citationsKnown true + provider values | PASS | |
| EC-yeargate/FR-011 | Yearless candidate skipped, not persisted | PASS | |
| SC-007b/SC-008 | Enrichment failure still persists (no paper lost), citationsKnown false | PASS | transient + terminal |
| SC-010 | Summary discarded when summarization toggled off mid-flight | PASS | abstract fallback |
| SC-021/FR-044 | Every promoted paper carries the bundled baseline embedding | PASS | dim 2048 / model / source |
| US5.4/SC-017 | requestBackfill sets state, never touches lastCheckedAt | PASS | |
| FR-038 | requestBackfill no-op when targetFrom ≥ coveredFrom / coveredFrom unset | PASS | |
| FR-043 | cancelBackfill clears state, leaves coveredFrom | PASS | |
| FR-036-complete | Backfill completion lowers coveredFrom to targetFrom, clears state | PASS | |
| US5.1-window | computeBackfillWindow = [cursor, coveredFrom] / undefined | PASS | |
| US2.1 | Enabled due sub auto-checks provider | SKIP | scheduler loop + live arXiv |
| US3.1-exec | Load-time catch-up actually runs | SKIP | startScheduler + live network |
| US3.3 | No collection while off | SKIP | lifecycle-level |
| US3.4 | Disabled sub runs no catch-up on load | SKIP | scheduler load path |
| US4.1 | arXiv Atom XML → candidate | SKIP | DOMParser (browser-only) |
| US5.2/SC-016 | Over-cap backfill covered across passes/restart | SKIP | backfill runner + live network |
| US5.5 | Disable pauses / re-enable resumes backfill | SKIP | backfill runner loop |
| US6.1/US6.2/SC-019 | On-demand "check now" runs immediately, not concurrent | SKIP | checkNow from startScheduler |
| SC-001 | Enabled sub checks on schedule, zero manual | SKIP | scheduler tick loop |
| SC-002 | Off period → exactly one catch-up per sub | SKIP | scheduler load + live network |
| SC-003 | Zero external calls while off | SKIP | lifecycle-level |
| SC-005 | Disabling → zero further collection | SKIP | scheduler behavior |
| SC-006 | 100% collected papers parsed from provider responses | SKIP | live parsing (JSON covered by US4.2) |
| SC-012 | No paper lost in over-cap window | SKIP | queryArxiv paging + scheduler |
| SC-013 | Enrich N papers ≤ ⌈N/batchMax⌉ requests | SKIP | requires counting live requests |
| SC-015 | Bulk backfill zero duplicates | SKIP | backfill runner + live network |

## Known residual limitations

- No spec-violating leniency was found in the asserted (pure) surface: the store's
  idempotency, empty-value rejection, never-backward `lastCheckedAt`,
  backfill-state transitions, the window math (first-window bound, clock-backward,
  lag-overlap clamp), dedup, promotion defaults, the arXiv-id positional-misalignment
  guard, and the baseline-embedding attach all behave as the spec requires.
- The 16 SKIPs are the scheduler tick/load loop, live provider I/O, the backfill
  runner, on-demand check, and arXiv XML parsing (DOMParser). These are exercised
  in `quickstart.md`'s manual walkthrough (with stubbed clients / a real Obsidian
  host), not in this deterministic unit suite.
- `_obsidian-shim.ts` is a test-only bundling aid (an alias target), not part of the
  shipped plugin.

## Raw test output

```
[PASS] US1.1 — Register type+value → new sub with default interval, appears in list
[PASS] US1.5 — Register without a label → label defaults to value
[PASS] US1.6/SC-009 — Registering an existing (type,value) returns it unchanged, no duplicate
[PASS] US1.4 — setCheckInterval accepts only the five allowed intervals; else keeps prior
[PASS] US1.2/US1.3 — Disable flips enabled; delete removes from the list
[PASS] SC-014-cb — onRegistered fires only on a genuinely-new registration, not an idempotent hit
[PASS] FR-025/SC-011 — Registering an empty/whitespace value is rejected; no subscription created
[PASS] US2.2/US3.2 — recordChecked advances lastCheckedAt and initializes coveredFrom once; never backward
[PASS] US3.1-window/SC-018/FR-030 — A first check (lastCheckedAt=null) yields a 24h look-back window
[PASS] EC-window-normal — A subsequent check window spans [lastCheckedAt, now]
[PASS] FR-024 — A clock-backward reading yields an empty window (from===to===now)
[PASS] SC-020/FR-041 — The lag re-scan is [frontier.from - 4d, frontier.from], clamped to coveredFrom, undefined on first/backward
[PASS] EC-8 — Batch enrichment REJECTS a record whose echoed arXiv id doesn't match the queried candidate — transientFailure, never enriched with another paper's citation data
[PASS] EC-9 — Batch enrichment ACCEPTS a record whose echoed arXiv id matches the queried candidate (control) — enriched with its citation data
[PASS] SC-014 — A genuinely new subscription has its first check begin without waiting for the next tick, never processed concurrently with it
[PASS] US2.3/SC-004 — A paper found twice (same sourceId) is processed only once (dedup)
[PASS] US4.2 — Semantic Scholar JSON parses into the citation shape (arXiv ids version-stripped)
[PASS] US4.3 — A candidate promoted without enrichment: citationCount 0, references [], citationsKnown false
[PASS] US4.4/SC-007 — An enriched candidate is stored with citationsKnown true and the provider values
[PASS] EC-yeargate/FR-011 — A candidate with no publication year is skipped, not persisted
[PASS] SC-007b/SC-008 — Enrichment failure still persists the paper immediately with citationsKnown false
[PASS] SC-010 — A summary generated then discarded (summarization toggled off mid-flight) is not persisted
[PASS] SC-021/FR-044 — Every promoted paper is persisted carrying the bundled baseline embedding
[PASS] US5.4/SC-017 — requestBackfill sets backfillState without ever touching lastCheckedAt
[PASS] FR-038 — requestBackfill is a no-op when targetFrom is not older than coveredFrom (or coveredFrom unset)
[PASS] FR-043 — cancelBackfill clears backfillState but leaves coveredFrom untouched
[PASS] FR-036-complete — recordBackfillProgress to completion lowers coveredFrom to targetFrom and clears state
[PASS] US5.1-window — computeBackfillWindow is [cursor, coveredFrom] when active, undefined otherwise
[SKIP] US2.1 — An enabled, due subscription auto-checks the provider while running (Scheduler tick loop + live arXiv call (startScheduler needs an Obsidian Plugin))
[SKIP] US3.1-exec — The load-time catch-up pass actually runs one search per enabled sub (startScheduler load path + live network)
[SKIP] US3.3 — No collection occurs while the plugin is off (Lifecycle/absence of a process — not observable in a unit context)
[SKIP] US3.4 — A disabled subscription runs no catch-up on load (Scheduler load path (the disabled flag itself is covered by US1.2))
[SKIP] US4.1 — arXiv Atom XML parses into a candidate with unknown citations (arxivParser uses DOMParser (browser-only); unavailable under node)
[SKIP] US5.2/SC-016 — An over-cap backfill window is covered across passes and resumes after restart (Backfill runner drives runSubscriptionCheck → live queryArxiv)
[SKIP] US5.5 — Disable pauses backfill; re-enable resumes from the cursor (Backfill runner loop (scheduler); store-level state is covered above)
[SKIP] US6.1/US6.2/SC-019 — On-demand "check now" for an existing subscription runs immediately, never concurrently (checkNow handle is produced by startScheduler (needs Obsidian Plugin))
[SKIP] SC-001 — An enabled subscription checks on schedule with zero manual action (Scheduler tick loop)
[SKIP] SC-002 — Opening after an off period runs exactly one catch-up per enabled sub (Scheduler load path + live network (window math covered by US3.1-window))
[SKIP] SC-003 — Zero external calls occur while the plugin is off (Lifecycle-level guarantee)
[SKIP] SC-005 — Disabling a subscription yields zero further collection, including on later loads (Scheduler behavior (disabled flag covered by US1.2))
[SKIP] SC-006 — 100% of collected papers are parsed from provider responses (Depends on live provider parsing (JSON parse covered by US4.2; XML is DOM-only))
[SKIP] SC-012 — No paper in an over-cap window is permanently lost across successive checks (queryArxiv paging + scheduler advance loop (live network))
[SKIP] SC-013 — Enriching N papers issues at most ⌈N/batchMax⌉ requests (Requires counting live Semantic Scholar batch requests)
[SKIP] SC-015 — A bulk backfill collects from the chosen start date with zero duplicates (Backfill runner + live network (dedup mechanism covered by SC-004))

Summary: 28 passed, 0 failed, 16 skipped
```
