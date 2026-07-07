# Future Work: Collection Volume Control (002 extension)

**Status**: Deferred — not scheduled, not being built now

**Created**: 2026-07-07

**Relates to**: `002-subscription-paper-collection` (FR-026 truncation-aware paging, FR-030 first-window bound), `001-core-data-models` (`Subscription`), `008` (subscription-management UI)

## Why this is deferred

002 caps only the *initial* burst when a subscription is first registered: a brand-new subscription's first window is bounded to the last 24 hours (FR-030), so registering cannot flood the vault with arbitrarily old history. But steady-state forward collection after that is unbounded by design. FR-026 guarantees that a window larger than the paging cap is eventually covered *in full* across successive passes — it spreads a large window over more checks, it never throttles or drops any paper. So a subscription to a high-volume arXiv category (e.g. `cs.LG`, which sees hundreds of submissions a day) will keep collecting every matching paper indefinitely, potentially growing a vault to thousands of notes.

This was raised as a possible gap during the 2026-07-07 spec review, but — unlike the historical-backfill gap, which came from a concrete user need — it is a *predicted* problem with no evidence yet that real usage hits it. The right filtering criterion is also unclear without that evidence (see below), and guessing wrong would mean building the wrong throttle and reworking it later. So it is recorded here and set aside rather than added to 002.

## What this would add, if built

Some per-subscription bound on steady-state intake. Candidate mechanisms, roughly in increasing scope:

- **Per-check paper cap**: a `maxPapersPerCheck` (or per-day) limit on a subscription. Smallest option — it layers onto the paging-cap logic 002 already has (FR-026), needing a new optional `Subscription` field (an additive 001 extension, the `semanticScholarApiKey`/`coveredFrom` precedent) plus a decision on *what* to drop when the cap is hit (newest? oldest? — and how that interacts with FR-026's oldest-first monotonic advancement, which is designed around *never* dropping).
- **Minimum-citation filter**: skip papers below a citation threshold. Complicated by the fact that arXiv-discovered papers arrive with `citationsKnown === false` (citations unknown until Semantic Scholar enrichment), so a citation filter would have to run post-enrichment and could not simply prune at discovery time.
- **Narrowing filters**: let a broad category subscription be combined with a keyword (AND semantics) so `cs.LG` + `diffusion` collects far less than `cs.LG` alone. Largest option — it changes the subscription model and the discovery query construction, and overlaps with 008's UI scope.

## Open questions if this is picked up later

- Is a hard cap, a filter, or just a UI-level warning ("this category is high-volume") the right response? These solve different framings of the problem.
- If a cap: what is dropped when it is hit, and how is that reconciled with FR-026's no-loss / oldest-first monotonic guarantee (the two are in direct tension — one throttles, the other refuses to drop)?
- If a filter: does it run at discovery (arXiv query) or post-enrichment (needs citation data), and where does the UI to configure it live (008)?
- Does this belong on the `Subscription` entity (per-subscription tuning) or as a global plugin setting (one vault-wide policy)?
