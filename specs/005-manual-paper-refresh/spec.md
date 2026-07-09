# Feature Specification: Manual Paper Refresh

**Feature Branch**: `develop-feature/005-manual-paper-refresh`

**Created**: 2026-07-04

**Status**: Draft (v2 — scope extended 2026-07-06 from citation-only refresh to full paper-info refresh)

**Input**: "When a user requests it, re-fetch up-to-date paper information — citation count, citation relationships, and the paper's own title/abstract/authors (in case arXiv has since served a newer revision) — for a paper already saved in the vault. The refresh applies to the existing synchronized record + note pairing, updating only plugin-managed fields and preserving anything the user wrote by hand. This is manual-only — no automatic or scheduled refreshing. A user MUST also be able to trigger this for every saved paper published within the last year in a single action, so information that drifts while a subscription runs a long time doesn't require refreshing papers one at a time."

## Clarifications

### Session 2026-07-04

- Q: What exactly does a refresh update, and where does it write? → A: It re-checks the paper's citation count and its own outbound references (the papers it cites) — never inbound "who cites this paper," which per 001/006 is never fetched or stored per-paper and is instead derived by inverting outbound references across the vault — then writes the new values into the canonical JSON record and mirrors them into the Markdown note's managed region via the 003 pairing. The user's free-form body is untouched. It also sets `citationsKnown` (001) to `true` when the provider supplied real data, resolving a paper that was previously promoted with `citationsKnown = false`.
- Q: Does refresh discover new papers or make its own external calls? → A: It refreshes one already-saved paper's data. The external lookup reuses the same provider-communication boundary as collection (002); refresh does not add new papers to the vault, it only updates the requested paper's managed fields.
- Q: What if the paper can no longer be found in the provider? → A: The existing saved information is kept unchanged and the user is informed of the failure; the record/note pairing is never left partially updated.

### Session 2026-07-06

- Q: A subscription running for a long time accumulates papers whose citation counts drift, but refreshing them one at a time is impractical. Should this feature support refreshing many papers in one action, and if so, which ones? → A: Yes — a single user-triggered action refreshes every saved paper whose `publicationYear` is within the last year (recency, not staleness/last-refreshed-time — no new field is added to 001 for this). This is still manual: the user explicitly triggers the batch, it does not run on a schedule or in the background. Papers older than the window are not touched by this action; a user can still refresh any individual older paper via the single-paper mode (FR-001). A separate, deferred idea — 002 automatically re-enriching stored papers on its own schedule — is recorded as a future consideration, not part of this feature.
- Q: Why publicationYear and not a new "last refreshed" timestamp? → A: publicationYear is already part of the 001 `Paper` shape, so this needs no new field. It also more directly answers the relevant question ("has this paper existed long enough that a citation-aware provider likely has data for it") than "how long ago did we last check," which depends on when the paper happened to be collected rather than how old it actually is.
- Q: 002 now strips arXiv version suffixes from `sourceId` (a revised paper keeps the same `sourceId` as its earlier version) and never re-visits an already-collected paper once its collection window has passed. Should this feature's scope grow beyond citation data to also refresh a paper's own title/abstract/authors when arXiv has served a newer revision since it was collected? → A: Yes. This feature is already the only mechanism that re-queries a provider for an already-saved paper (FR-008's centralized boundary), so it is the natural, and only sensible, place to also pick up a newer arXiv revision's content — not a new feature. FR-002 is extended accordingly (see below).
- Q: How does refresh know a stored paper's title/abstract/authors are "out of date" without persisting the arXiv version number it was collected at? → A: It doesn't need to know, and no version field is added to 001. arXiv's paper-lookup endpoint, queried by the version-stripped base ID, always returns that paper's *current* (latest) revision's content. Refresh simply re-fetches and unconditionally overwrites the stored title/abstract/authors with whatever arXiv returns now — if nothing changed, the overwrite is a no-op in effect; if something changed, the newer content is applied. No diffing against a stored version number is required or added.
- Q: If a refresh's content re-fetch shows the abstract has changed, should 004's summary/future-directions text be regenerated? This directly resolves 004's OQ-4 ("If a paper later transitions uncited → cited, or its abstract changes, is the summary/future-directions text regenerated, or kept as first generated?"). → A: Yes, but conditionally — only when the abstract actually differs from what's currently stored. Refresh compares the freshly-fetched abstract string against the stored one (a plain string comparison; no new field, since `abstract` is already a required 001 `Paper` field and both values are already in hand during a refresh) and invokes 004 to regenerate the summary/future-directions text only when they differ. This keeps the common case (the overwhelming majority of refreshed papers have not been revised) from making an unnecessary 004 call, while still keeping the summary in sync on the far rarer case where content genuinely changed.
- Q: Collection (002) calls 004 with a narrowed input shape (`{ title, abstract, citationCount, citationsKnown }`, not the full `Paper`) so an external summarization provider never receives fields it has no use for. Should this feature's own call to 004 (FR-014) use the same shape? → A: Yes — there is exactly one input contract 004 accepts, and it is this narrow one (see 002's `research.md` Decision 22 for the full rationale: data minimization for anything leaving the vault to a third-party provider, and 004 genuinely has no use for `sourceId`/`references`/`authors`/`publicationYear`). This feature does not invent a second, wider contract for its own call site.
- Q: arXiv's own guidance ("play nice and incorporate a 3 second delay" between successive calls) doesn't distinguish paging through one large query's results from many independent single-paper lookups — applied literally to a 100-paper bulk refresh, that is 100 × 3s ≈ 5 minutes. Is that acceptable? → A: No — 5 minutes is too long for a user-triggered action, but removing all pacing is also an unacceptable risk (bursting many rapid requests raises the odds of being rate-limited, which then cascades into retries across many papers). This feature deliberately does **not** apply arXiv's literal per-call guidance to bulk mode; instead it uses a much shorter fixed delay between successive per-paper lookups (an order of magnitude below 3s) and increases its delay adaptively only after an actual `429` response is observed, rather than pre-emptively pacing every call at the same conservative rate collection (002) uses for its own (different) scenario of paging through one large result set. This is a deliberate, documented trade-off by this feature — it is not something arXiv's documentation itself distinguishes or mandates.
- Q: With a bulk refresh now plausibly taking tens of seconds even at a reduced pace, how does the user know it's still working rather than stuck? → A: The user MUST be able to see that a bulk refresh is in progress and roughly how far along it is (e.g., papers processed out of the total matched), without that indicator blocking any other action in the interface. The exact presentation (status bar text, a transient notice, or similar) is an implementation/UX decision for the feature that wires the UI (008), not fixed by this specification.

### Session 2026-07-06 (continued)

- Q: Collection (002) resolved a rate-limit problem with Semantic Scholar identical to the one a 100+ paper bulk refresh faces here — Semantic Scholar's unauthenticated tier is a single, undocumented rate pool (~1 request/second in practice) shared by every anonymous caller worldwide, and 002 concluded that pacing individual per-paper requests (even with a short delay and reactive backoff) still "systematically hits `429` and cascades into retries" at scale, so it moved to a **batch lookup endpoint** (`POST /paper/batch`, up to 500 arXiv IDs per request) instead. Does this feature's bulk refresh (User Story 2) have the same problem, and should it use the same fix? → A: Yes to both. FR-015's per-paper pacing language was written for **arXiv's own per-paper content re-fetch** (title/abstract/authors), which genuinely has no batch form and must stay one request per paper — that part of FR-015 is unchanged. But this feature's **Semantic Scholar citation lookup** during a bulk refresh is the exact same shared-rate-limit problem 002 already solved, using the exact same provider boundary (FR-008) — there is no reason for this feature to independently re-hit the failure mode 002 just fixed. The bulk mode MUST batch its citation-count/reference lookups through Semantic Scholar's batch endpoint (chunked to its per-request maximum, same as 002), rather than looking up each paper's citations individually even with pacing. The single-paper refresh mode (FR-001) is unaffected — a lone paper has nothing to batch with, so it continues to use the single-paper lookup exactly as before.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Refresh a single saved paper on demand (Priority: P3)

As a user, I know a saved paper's citation count, or its title/abstract if arXiv has since revised it, may be out of date, so I want to pick that paper and refresh it with the latest information whenever I want.

**Why this priority**: A convenience on top of a working save pipeline; valuable but not blocking for collection, persistence, or display.

**Independent Test**: Save a paper with a known citation count and abstract, trigger a refresh against a (stubbed) provider returning a higher citation count, updated relationships, and a changed abstract, and confirm the record and note's managed region reflect all the new values, the summary/future-directions text is regenerated because the abstract changed, and the user's body text is unchanged.

**Acceptance Scenarios**:

1. **Given** an already-saved paper note, **When** the user requests a refresh for it, **Then** its citation count, citation relationships, title, abstract, and authors are all re-checked against the provider.
2. **Given** a refresh completes, **When** the new data is applied, **Then** it updates the existing JSON record and the note's managed region — not a new note — and the user's hand-written body is unchanged.
3. **Given** a refresh's re-fetched abstract differs from what was stored **and summarization is enabled**, **When** the refresh applies the new content, **Then** the summary/future-directions text (004) is regenerated; **given** the abstract is unchanged, **or given** summarization is disabled, **When** the refresh applies the content, **Then** 004 is not re-invoked (the citation/content fields are still updated either way).
4. **Given** other paper notes were not requested for refresh, **When** a refresh runs, **Then** those other papers are unaffected.

---

### User Story 2 - Refresh all recent papers in one action (Priority: P4)

As a user whose subscriptions have run for a long time, I want to refresh every saved paper published within the last year in a single action, so I don't have to refresh dozens of papers one at a time to keep recent information current.

**Why this priority**: A convenience layered on top of User Story 1's single-paper refresh; valuable once a vault has accumulated enough papers that one-at-a-time refreshing is impractical, but not required for the core save pipeline.

**Independent Test**: Save several papers with a mix of publication years (some within the last year, some older), trigger the bulk refresh action, and confirm only the papers published within the last year were re-checked against a (stubbed) provider, processed one at a time at a pace that completes well under the naive "3 seconds per paper" figure, with visible progress throughout, while older papers and unrelated notes are untouched.

**Acceptance Scenarios**:

1. **Given** a vault with saved papers published at various times, **When** the user triggers a bulk refresh, **Then** only papers whose `publicationYear` is within the last year are re-checked against the provider.
2. **Given** the bulk refresh is running, **When** many matching papers exist, **Then** they are processed sequentially, one at a time, without freezing the interface, and the user can see it is in progress and roughly how far along it is.
3. **Given** one matching paper's refresh fails (provider unreachable, or the paper can no longer be found), **When** the bulk refresh continues, **Then** the failure does not stop the remaining papers from being processed, and the failures are summarized to the user rather than reported one by one.
4. **Given** a paper is already being refreshed individually (User Story 1) when a bulk refresh reaches it, **When** the bulk refresh processes that paper, **Then** it is not refreshed twice concurrently.
5. **Given** a provider responds with a rate-limit error partway through a bulk refresh, **When** processing continues, **Then** this feature paces subsequent requests more conservatively rather than continuing to fire at its normal rate, without aborting the run.

---

### Edge Cases

- If a refresh is requested but the paper can no longer be found in the external database, the existing saved information is kept and the user is informed of the failure; nothing in the pairing is partially overwritten.
- If a refresh is already in progress for a paper and is requested again, it must not be processed twice concurrently.
- If the provider call fails or times out, the existing data is preserved and the user is informed; the record/note pairing is never left inconsistent.
- Updated citation relationships may reference papers not in the vault; storing those references follows the same rule as collection (references are recorded on the record; unresolved targets are handled by the graph feature, 006).
- If a bulk refresh is already running when the user triggers it again, a second run MUST NOT start concurrently; the user is informed one is already in progress.
- If a bulk refresh and a single-paper refresh (User Story 1) target the same paper at the same time, only one runs against that paper at a time (FR-006 extended to cover this case).
- If the bulk refresh is interrupted (e.g., the plugin is closed mid-run), papers already processed keep their updated values; papers not yet reached are simply refreshed on the next bulk run — there is no partial-batch state to recover.
- If a paper's arXiv content has not actually changed since collection (the common case), a refresh still completes normally but produces no visible change and does not re-invoke 004 — this is expected behavior, not a failure.
- If a paper's title/abstract/authors *have* changed (a genuine arXiv revision), the refresh overwrites the stored content unconditionally — there is no "keep old vs. new" choice presented to the user, matching how citation-count updates already work.
- If a paper's abstract changed but summarization is turned off, the refresh still applies the new title/abstract/authors and citation data but does not call 004 — the summary is left as-is (or absent); it is not an error and no partial update results. If summarization is toggled off while a regeneration this refresh triggered is already in flight, the stale generated result is discarded (mirroring 002's in-flight-discard behavior).
- If a bulk refresh matches many papers, their citation-count/reference lookups are issued as one (or a few, chunked) batched Semantic Scholar requests, not one request per paper — only each paper's arXiv content re-fetch remains individual, since arXiv has no batch form for that.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A user MUST be able to manually request an information refresh for a single, already-saved paper note.
- **FR-002**: A refresh MUST re-check that paper's citation count, its own outbound references (the papers it cites), and its title/abstract/authors, and MUST set `citationsKnown` (001) to `true` once the provider supplies real citation data. Title/abstract/authors are unconditionally overwritten with whatever the provider currently returns (no version comparison; see FR-013). Inbound "who cites this paper" is out of scope — per 001/006 it is never fetched or stored per-paper.
- **FR-003**: The refreshed information MUST be applied to the existing JSON record and the Markdown note's managed region via the 003 synchronized pairing — not to a new note — and anything the user wrote in the note body MUST be preserved.
- **FR-004**: A refresh MUST affect only the requested paper; all other paper notes MUST remain unchanged.
- **FR-005**: If the paper can no longer be found in the external database, the existing information MUST be kept and the user informed; the pairing MUST NOT be partially updated.
- **FR-006**: If a refresh is already in progress for a paper, a repeat request MUST NOT process it twice concurrently.
- **FR-007**: Refresh MUST be manual-only — both the single-paper mode (FR-001) and the bulk mode (FR-009) are triggered explicitly by the user; no automatic or scheduled refreshing is performed by this feature.
- **FR-008**: External provider communication for a refresh MUST go through the same provider-communication boundary used for collection (002), so external access stays centralized.
- **FR-009**: A user MUST be able to trigger, in a single action, a refresh of every saved paper whose `publicationYear` is within the last year (relative to the current date). Papers outside that window MUST NOT be touched by this action.
- **FR-010**: Papers targeted by a bulk refresh MUST be processed sequentially, one at a time, so the interface does not freeze regardless of how many papers match.
- **FR-011**: A failure while bulk-refreshing one paper (provider unreachable, paper no longer found, etc.) MUST NOT stop the remaining papers from being processed; individual failures MUST be summarized to the user rather than reported one at a time.
- **FR-012**: A bulk refresh MUST NOT run concurrently with another bulk refresh, nor process a paper that a single-paper refresh (FR-001) is already refreshing, and vice versa (extends FR-006 to cover bulk-vs-single and bulk-vs-bulk overlap).
- **FR-013**: Refreshing a paper's title/abstract/authors MUST NOT depend on detecting or storing which arXiv revision is currently saved; it MUST simply apply whatever content the provider returns for that paper's (version-stripped) identifier at the moment of refresh.
- **FR-014**: When a refresh's freshly-fetched abstract differs from the paper's currently-stored abstract, this feature MUST invoke 004 to regenerate that paper's summary/future-directions text before the refresh completes — **but only when summarization is currently enabled**; when the abstract is unchanged, or when summarization is disabled, 004 MUST NOT be re-invoked. Whether summarization is enabled MUST be read live at the moment the refresh would invoke 004 (never a value captured when the refresh started), and — as 004 has no way to abort or detect a mid-flight settings change (004 FR-009) — if summarization is turned off while a regeneration this feature triggered is already in flight, this feature MUST discard the stale result and leave the paper's existing summary/abstract fallback in place, exactly as collection (002) does (002 FR-021). A refreshed paper's citation/content fields (FR-002) are still updated regardless of the summarization setting; only the 004 regeneration is gated.
- **FR-015**: Successive per-paper **arXiv content** (title/abstract/authors) re-fetch requests during a bulk refresh — which has no batch form (FR-018 covers the citation side) — MUST NOT be paced at collection's (002) conservative same-query-pagination rate; this feature MUST use a substantially shorter fixed delay between requests by default, and MUST increase that delay only in response to an actual rate-limit response from a provider, rather than pre-emptively.
- **FR-016**: While a bulk refresh is running, the user MUST be able to see that it is in progress and roughly how far along it is (e.g., papers processed vs. total matched), without that indicator blocking any other action in the interface. The exact presentation is not fixed by this specification.
- **FR-017**: When this feature invokes 004 to regenerate a paper's summary/future-directions text (FR-014), it MUST call 004 with exactly the same narrow input shape collection (002) uses — `{ title, abstract, citationCount, citationsKnown }` — never the full `Paper` record (never `sourceId`/`references`/`authors`/`publicationYear`). This is the one and only input contract 004 accepts; this feature does not define a second one.
- **FR-018**: A bulk refresh MUST look up citation counts and references for its matching papers through Semantic Scholar's batch endpoint (chunked to its per-request maximum), never through one individual per-paper lookup per matching paper — this is the same shared unauthenticated rate-limit problem collection (002) already solved (002 FR-027), and this feature MUST NOT reintroduce it at bulk-refresh scale. The single-paper refresh mode (FR-001) is unaffected by this requirement — refreshing one paper has nothing to batch with, so it continues to use a single-paper citation lookup.

### Key Entities

- **Paper Record (JSON)** / **Paper Note (Markdown)**: As defined in 003 (the logical Paper shape is 001); this feature updates their citation-related *and* content-related (title/abstract/authors) managed fields via 003.
- **Refresh Request**: A transient, user-initiated action targeting one saved paper by its source identifier. Not persisted; it carries only which paper to refresh and guards against concurrent duplicates.
- **Bulk Refresh Run**: A transient, user-initiated action that selects every saved paper with `publicationYear` within the last year, batch-looks-up their citation data through Semantic Scholar's batch endpoint (FR-018), then processes each through the same single-paper refresh logic as FR-002/FR-003 for its arXiv content, sequentially, at a reduced (non-collection) pacing (FR-015), with progress visible to the user (FR-016). Not persisted across sessions; it carries no state beyond the current run's progress and per-paper failure summary.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After a refresh, the requested paper's citation count reflects the latest provider value.
- **SC-002**: Content the user wrote by hand in the note is unchanged after a refresh, 100% of the time.
- **SC-003**: Paper notes not requested for refresh are unaffected (zero changes).
- **SC-004**: A refresh that fails or targets a no-longer-found paper leaves the existing pairing fully intact and informs the user.
- **SC-005**: A paper with a refresh already in progress is never processed twice concurrently.
- **SC-006**: A bulk refresh touches exactly the set of saved papers whose `publicationYear` is within the last year — zero papers outside that window are modified.
- **SC-007**: A bulk refresh over 100+ matching papers completes without the interface becoming unresponsive to other user actions, and in substantially less time than a fixed 3-second-per-paper pace would take, absent sustained rate-limiting.
- **SC-008**: Individual failures during a bulk refresh never abort the run; every matching paper is attempted, and failures are presented to the user as a single summary.
- **SC-009**: After a refresh, a paper's title/abstract/authors match whatever the provider currently returns for it — including reflecting a newer arXiv revision when one exists — with zero manual version bookkeeping required.
- **SC-010**: A refresh regenerates a paper's summary/future-directions text if and only if its abstract actually changed **and summarization is enabled**; an unchanged abstract, or a disabled summarization setting, results in zero summarization calls, while the paper's citation/content fields are still updated.
- **SC-011**: A bulk refresh over N matching papers issues at most ⌈N / (Semantic Scholar's batch maximum)⌉ citation-lookup requests — for a typical run, exactly one — never N individual per-paper citation lookups.

## Assumptions

- The refresh action is surfaced to the user through the graph's right-click menu (007) and/or a command; this feature provides the refresh behavior itself, not its menu placement. The bulk refresh (FR-009) is surfaced as a separate, explicit command/action distinct from the per-node single refresh, since it targets many papers rather than one.
- Whether a manually edited managed field is overwritten follows 003's policy: the JSON record is authoritative and its managed region is rebuilt on update.
- The "within the last year" window (FR-009) is judged by `publicationYear` alone, not by when a paper was collected or last refreshed — no new timestamp field is added to 001 for this feature. A future, separate idea (002 automatically re-enriching stored papers on its own schedule, independent of user action) is deliberately out of scope here and recorded elsewhere as a future consideration, not this feature.
- Version handling for arXiv content is entirely 002's concern (a paper's `sourceId` is already version-stripped at collection time, per 002's own design); this feature never reads, stores, or compares an arXiv version number — it only ever asks "what does the provider say *now*" for a paper's existing identifier.
- The bulk-refresh pacing figures (a "substantially shorter" default delay than 3 seconds, adaptive backoff only after an observed rate-limit response) apply to arXiv content re-fetching (FR-015) only, are a deliberate UX/safety trade-off made by this feature, not a distinction arXiv's own documentation draws; the exact default delay value and backoff curve are implementation details for the planning phase, not fixed by this specification. Semantic Scholar citation lookups during a bulk refresh are batched (FR-018), not individually paced — that lookup reuses 002's own batch endpoint and chunk-size constant rather than this feature inventing a second pacing scheme for the same shared rate pool.
- The exact progress-indicator presentation (FR-016) is an implementation/UX decision made by whichever feature wires the on-screen surface (008); this specification only requires that *some* non-blocking, roughly-quantified progress indication exists.

## Open Questions

*Deferred to `/speckit-clarify` and `/speckit-plan` — recorded so refinement and planning address them.*

- ~~**OQ-1 — What a refresh actually persists for inbound citations.**~~ Resolved (Session 2026-07-06 / FR-002): a refresh persists only the updated citation count and this paper's own outbound `references`, plus `citationsKnown = true`; inbound "who cites this paper" is never fetched or stored, per 001/006's outbound-only design.
- **OQ-2 — Re-summarization on citation-status change.** Partially resolved (Session 2026-07-06 / FR-014): re-summarization is now decided for the *content-change* case (abstract differs → regenerate). The *citation-status-change* case (a paper flips uncited ↔ cited without its abstract changing) remains open and is still cross-referenced at 004 OQ-4 — this specification does not yet fix whether a bare `citationsKnown`/`citationCount` change alone should also re-trigger 004. *(Deferred to `/speckit-clarify` / `/speckit-plan`.)*
- **OQ-3 — Bulk refresh trigger surface.** FR-009 fixes the behavior (what gets refreshed, sequential processing, failure summary), but not where the user invokes it (command palette, settings button, graph toolbar). *(Plan-level, see 007/008.)*

## Out of Scope

- Discovering new papers is owned by 002.
- Automatic or scheduled refreshing is explicitly excluded; both the single-paper and bulk modes in this feature are manual-request-only. A separate, deferred idea for 002 to automatically re-enrich stored papers on its own schedule is recorded as a future consideration, not part of this feature.
- The on-screen menu/trigger that invokes either refresh mode is owned by 007/008; the record/note write is performed through 003.
- Detecting or reporting *that* a specific arXiv revision occurred (e.g., "this paper was updated from v1 to v2") is out of scope — refresh only ever applies the provider's current content; it never compares against, stores, or surfaces a version number (see Clarifications, Session 2026-07-06).
