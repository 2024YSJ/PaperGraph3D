# Future Work: Automatic Citation Re-Enrichment (002 extension)

**Status**: Deferred — not scheduled, not being built now

**Created**: 2026-07-06

**Relates to**: `002-subscription-paper-collection`, `001-core-data-models` (`citationsKnown`), `005-manual-paper-refresh` (bulk manual refresh, its non-automatic sibling)

## Why this is deferred

`005-manual-paper-refresh` now supports a user-triggered bulk refresh of every saved paper published within the last year (see its Session 2026-07-06 clarifications and FR-009–FR-012). That covers the immediate need — citation counts drifting while a subscription runs for a long time — at low engineering cost: it reuses 005's existing single-paper refresh logic in a loop, requires no new scheduling infrastructure, and needs no change to 001 or 002.

This document records the alternative that was considered and set aside: having **002** perform this re-enrichment **automatically**, on its own schedule, with no user action required. It was not chosen for the initial implementation because it requires meaningfully more new infrastructure than the bulk-manual approach for a benefit (full hands-off automation) that isn't required yet. It's recorded here so the idea isn't lost and can be picked up later if the manual bulk refresh proves insufficient (e.g., users don't remember to run it, or vaults grow large enough that staying current matters more).

## What this would add, if built

Today, 002's data flow is one-directional: it collects candidates, optionally enriches them, and hands finished `Paper`s to 003 to persist — it never reads back from 003's storage. Automatic re-enrichment would change that:

- **New capability**: 002 would need to read already-persisted papers back from 003's storage to find re-enrichment targets (`citationsKnown === false`, and/or `publicationYear` within some window). This is a new architectural direction that doesn't exist today — 002 has never needed to query what 003 has already written.
- **Scheduling**: reuse 002's existing subscription-check interval loop, or a separate, longer-running cadence (citation counts don't meaningfully change within a 6-hour window, so a daily-ish sweep is more sensible than piggybacking on every collection check).
- **Batch cap + sequential processing**: reuse the same non-freezing, sequential-processing rule already required for large discovery batches (002 FR-013), so an automatic sweep can't flood the provider or lock up the interface.
- **Terminal-absence / bounded retry**: a provider positively reporting "no such paper" (or a failed cross-provider identity match) must be treated as a stable end state, not retried forever; transient failures (rate-limited, unreachable) get a bounded number of retries before being left alone. Without this, a paper that will never be found in Semantic Scholar would be silently re-attempted on every sweep, forever.
- **Concurrency with 005**: an automatic sweep and a user-triggered manual/bulk refresh (005) must not process the same paper at the same time — extends the existing single-paper concurrency guard (005 FR-006/FR-012) across features.
- **Failure UX**: unlike a manual action (where a per-request failure notice makes sense), a background sweep failing repeatedly must not spam the user — failures should be logged and/or surfaced as a periodic aggregate, not per-paper.
- **Window criterion**: same open question as 005's bulk refresh faced — recency (`publicationYear`), staleness (a new `lastRefreshedAt` field on `Paper`, requiring a 001 change), or a hybrid of both. If staleness is ever wanted here, 001 would need to gain a `lastRefreshedAt` timestamp field, which the current (manual, `publicationYear`-only) design deliberately avoids needing.

## Relationship to 005's bulk refresh

These are not mutually exclusive. If this is ever built, 005's bulk manual refresh doesn't need to be removed — a user might still want to force an immediate refresh of recent papers rather than wait for the next automatic sweep, and older papers outside 002's automatic window would still only be reachable via 005's single-paper mode. The two would end up covering different parts of the same problem: 005 = on-demand (any paper, or bulk-recent, whenever the user asks), 002 = ambient (recent-and-unconfirmed papers, without being asked).

## Open questions if this is picked up later

- Exact cadence (how often the sweep runs).
- Exact batch cap per sweep.
- Whether the window criterion should differ from 005's (e.g., 002's automatic sweep could prioritize `citationsKnown === false` regardless of age, while 005's manual bulk stays purely recency-based).
- Whether a settings toggle is needed to let users opt out of the automatic sweep entirely (likely yes, per the project's general preference for explicit opt-in on anything making additional background provider calls).
