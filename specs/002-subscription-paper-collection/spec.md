# Feature Specification: Subscription-Based Paper Collection

**Feature Branch**: `002-subscription-paper-collection`

**Created**: 2026-07-05

**Status**: Draft

**Input**: User description: "Based on the subscriptions a user has registered, periodically find new papers from external academic databases (arXiv, Semantic Scholar). A user registers subscriptions for keywords, authors, or arXiv categories; new papers are collected automatically. All communication with external databases happens only within this feature. Collection does not run while the plugin is off — instead, when the plugin turns back on, it searches for the papers that appeared during the time it was off (the gap between when it stopped and when it started again). Provider responses arrive in provider-specific formats (arXiv as Atom XML, Semantic Scholar as JSON) and are parsed into the canonical paper shape."

## Clarifications

### Session 2026-07-05

- Q: What is the first-collection window for a brand-new subscription (`lastCheckedAt` = null)? → A: Bounded to the shortest allowed check interval (24 hours) looking back from registration, so registering a subscription cannot flood the vault with historical papers.
- Q: Which provider performs discovery (keyword/author/category search)? → A: arXiv performs all discovery; Semantic Scholar is used only to enrich papers already found via arXiv with citation data, never as an independent discovery source.
- Q: What is the scheduling mechanism for per-subscription checks? → A: Each subscription runs its own independent timer keyed to its own check interval, rather than all subscriptions being polled on one shared sweep cadence.
- Q: How is an arXiv paper matched to its Semantic Scholar record for enrichment? → A: Match by arXiv ID first (Semantic Scholar's API accepts arXiv IDs directly); if that yields no match, fall back to a title + first-author match; an unresolved match is treated as an enrichment failure (`citationsKnown = false`), not an error. **Superseded by the 2026-07-06 session below**, which removes the title/author fallback entirely to eliminate false-positive matches.
- Q: What `sourceId` scheme do references/citations supplied by Semantic Scholar enrichment carry? → A: Normalize to the `arxiv:` scheme (001) whenever the referenced work has a known arXiv ID, so graph edges (006) can connect to independently-collected papers; keep a `semanticScholar:`-scheme identifier only when no arXiv ID is available.

### Session 2026-07-06

- Q: The arXiv-ID-first / title+author-fallback matching risks a false-positive match (a common surname's unrelated paper ranking top in a title search), silently attaching the wrong citation data. Should the fallback be kept? → A: No — the title+author fallback is removed entirely. Enrichment matches **by arXiv ID only**. When Semantic Scholar has no record for that arXiv ID, this is treated identically to the existing terminal-absence case (FR-018): `citationsKnown` stays `false`, the paper is promoted and persisted immediately, and only a later manual refresh (005) or auto-heal may retry. This trades a slightly higher terminal-absence rate (a real but not-yet-Semantic-Scholar-indexed arXiv paper) for zero risk of attaching a wrong paper's citation data.
- Q: arXiv IDs carry a version suffix (e.g. `2301.12345v2`) that changes when an author revises a preprint. Should a paper's `sourceId` include the version? → A: No — `sourceId` MUST be built from the version-stripped base identifier (`arxiv:2301.12345`, never `arxiv:2301.12345v2`), so the same underlying paper always maps to the same `sourceId` regardless of how many times it is revised. A later revision of an already-collected paper is therefore treated as already-persisted (FR-009's dedup) and is not re-collected or updated — refreshing an already-stored paper's content to match a newer arXiv revision is out of scope for this feature.
- Q: If a catch-up pass and the regular scheduled tick both become due for the same subscription at roughly the same time (e.g. a slow catch-up pass still running when the next tick fires), could the subscription be checked twice concurrently? → A: No — the scheduler MUST track which subscriptions currently have a check in flight and skip a subscription that is already being checked, for either the catch-up pass or a regular tick. A skipped subscription is simply picked up on its next due tick, since its `lastCheckedAt` has not yet advanced.
- Q: This feature's `Subscription[]` list and 001's `PluginSettings` both need to be read/written through the plugin's single `loadData()`/`saveData()` call — how is one avoided clobbering the other? → A: The persisted shape is a single object with sibling keys (e.g. `{ settings: PluginSettings, subscriptions: Subscription[] }`); any write MUST read the current whole object, replace only its own key, and write the whole object back (read-modify-write), never overwrite the object wholesale from a partial in-memory copy.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Register and manage subscriptions (Priority: P1)

As a user tracking research trends, I want to register subscriptions for keywords, authors, or arXiv categories I care about and manage them at any time, so that new papers are collected automatically without me searching myself.

**Why this priority**: Without subscriptions there is nothing to collect. Registration and management is the entry point for the entire collection pipeline.

**Independent Test**: Can be fully tested by registering a subscription of each type, viewing the list, disabling one, deleting another, and confirming each action is reflected — using stubbed provider responses so no live network is required.

**Acceptance Scenarios**:

1. **Given** the subscription list, **When** the user enters a type (keyword / author / arXiv category) and a value, **Then** a new subscription is registered with a default check interval and appears in the list.
2. **Given** a registered subscription, **When** the user disables it, **Then** it no longer triggers any new collection.
3. **Given** a registered subscription, **When** the user deletes it, **Then** it is removed from the list and stops triggering collection.
4. **Given** a subscription, **When** the user sets its check interval, **Then** only the five allowed intervals (6/12/24/48/72 hours) defined in 001 are accepted.

---

### User Story 2 - Automatic scheduled collection while running (Priority: P1)

As a user, I want each enabled subscription to check for new papers on its own interval while the plugin is running, so that my vault stays current without manual action.

**Why this priority**: Scheduled collection is the feature's core value; everything downstream (notes, graph) depends on papers arriving.

**Independent Test**: Can be fully tested with a subscription whose interval has elapsed: advance time and confirm a check fires, produces canonical Paper data (by parsing the stubbed provider response into a candidate and promoting it), and updates the subscription's last-checked time.

**Acceptance Scenarios**:

1. **Given** an enabled subscription whose interval has elapsed, **When** the plugin is running, **Then** it checks the provider for new papers with no manual action from the user.
2. **Given** a check completes, **When** it finishes, **Then** the subscription's last-checked time is updated to the moment of that check.
3. **Given** the same paper is found through two different subscriptions, **When** both checks run, **Then** the paper is processed only once (deduplicated by source identifier).

---

### User Story 3 - Catch-up collection across the off period (Priority: P1)

As a user who closes Obsidian overnight or for days, I want the plugin, when I open it again, to find the papers that were published while it was off, so that turning the plugin off never creates a permanent blind spot in my tracking.

**Why this priority**: This is the explicit behavior that replaces background collection. Without it, any time the plugin is off is lost coverage.

**Independent Test**: Can be fully tested by setting a subscription's last-checked time to the past, loading the plugin, and confirming exactly one catch-up search runs per enabled subscription over the window from last-checked to now, producing the papers the (stubbed) provider reports for that window and then updating last-checked to now.

**Acceptance Scenarios**:

1. **Given** the plugin has been off and a subscription's last-checked time is in the past, **When** the plugin loads, **Then** a single catch-up search runs for that subscription covering the window from its last-checked time to the current time.
2. **Given** the catch-up search completes, **When** it finishes, **Then** the subscription's last-checked time is advanced to the current time so the same window is never searched twice.
3. **Given** the plugin is off, **When** no plugin process is running, **Then** no collection occurs during the off period — collection only resumes as catch-up on the next load.
4. **Given** a disabled subscription, **When** the plugin loads after an off period, **Then** no catch-up search runs for it.

---

### User Story 4 - Provider parsing and citation enrichment (Priority: P2)

As a user relying on collected papers to be complete and trustworthy, I want each provider's response format parsed into the plugin's single canonical paper shape, with citation data clearly marked as confirmed or unconfirmed, so I never mistake an unenriched arXiv paper's placeholder "0 citations" for a real zero.

**Why this priority**: Correct parsing and the `citationsKnown` distinction are what keep every downstream feature (persistence, summarization, graph styling) from silently trusting fabricated data. It matters less than the collection mechanics above but must be right before those features consume this feature's output.

**Independent Test**: Can be fully tested by feeding stubbed arXiv Atom XML and Semantic Scholar JSON responses through parsing and confirming both produce the same canonical `PaperCandidate`/`Paper` shape (001), with `citationsKnown` set correctly in each case.

**Acceptance Scenarios**:

1. **Given** a stubbed arXiv Atom XML response, **When** it is parsed, **Then** it produces a `PaperCandidate` with an unknown citation count and unknown references (never a fabricated 0 or empty list).
2. **Given** a stubbed Semantic Scholar JSON response, **When** it is parsed, **Then** it produces a `PaperCandidate` carrying its actual citation count and references.
3. **Given** a candidate promoted without citation enrichment, **When** it is stored, **Then** its `citationCount` defaults to 0, its `references` default to an empty list, and `citationsKnown` is `false`.
4. **Given** a candidate enriched from a citation-aware provider before promotion, **When** it is stored, **Then** its `citationsKnown` is `true`.

---

### Edge Cases

- If the external database is temporarily unreachable, the check must not crash; the system retries at the next scheduled interval (or next load) and is able to inform the user of the failure. The subscription's last-checked time is not advanced past a window that was not actually searched.
- If an unusually large number of papers is discovered at once (e.g., right after registering a subscription, or after a long off period), they must be processed sequentially without freezing the interface.
- If a discovered paper is missing required information such as publication year (a *successful* response lacking a year), it is skipped for this pass rather than collected, per the hold-back rule in 001 — not treated as a provider failure.
- An arXiv-only paper carries no citation data, so its candidate's citation count and references are unknown. If it is promoted without Semantic Scholar enrichment, it is stored with a citation count of 0 and no references, but with `citationsKnown = false` so it remains distinguishable from a genuinely uncited paper (`citationsKnown = true`, count 0). A later enrichment or manual refresh (005) fills the real values and sets the flag true. This is expected behavior, not a failure.
- Enrichment can fail on a paper that is otherwise complete (has a year): Semantic Scholar is unreachable/rate-limited, has not indexed the paper, or cannot be matched to it. The paper MUST NOT be held back for this — it is promoted and persisted immediately with `citationsKnown = false`, so under windowed collection it never falls out of the search window and is not lost when the last-checked time advances. It is re-enriched later from the persisted store (refresh 005 / auto-heal), not by rescanning the window.
- Re-enrichment of `citationsKnown = false` papers must terminate: a provider positively reporting "no such paper" (or an unresolved identity match) is a terminal absence and is not retried automatically; transient failures are retried a bounded number of times before being left to manual refresh (005). Neither case blocks or reverses the paper's persistence.
- If the plugin is turned off mid-check, the subscription's last-checked time must not advance past the portion of the window that was actually completed, so the unsearched remainder is picked up on the next load.
- If two subscriptions' catch-up windows overlap and surface the same paper, it is still processed only once.
- If a provider limits how far back a catch-up query can reach, the user is informed that the off-period window could not be fully covered.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A user MUST be able to register a new subscription by entering its type (keyword / author / arXiv category) and value; a newly registered subscription receives the default check interval defined in 001 unless the user chooses another allowed interval.
- **FR-002**: A user MUST be able to view the list of registered subscriptions and delete, enable/disable, or change the check interval of any individual subscription (per the acceptance rule in 001: an interval outside the five allowed values is rejected and the prior value kept).
- **FR-003**: While the plugin is running, each enabled subscription MUST automatically check for new papers at its specified interval, with no manual action from the user.
- **FR-004**: When the plugin loads after having been off, it MUST perform a single catch-up search per enabled subscription covering the window from that subscription's last-checked time to the current time, so papers published while the plugin was off are still found.
- **FR-005**: No collection may run while the plugin is off; there is no background process. Collection resumes only as scheduled checks or catch-up searches once the plugin is running again.
- **FR-006**: After any successful check or catch-up search, the subscription's last-checked time MUST be advanced to the moment searched-through, so the same window is never searched twice. It MUST NOT be advanced past a window that failed or was interrupted.
- **FR-007**: Every collected paper MUST be parsed from the provider's response into the canonical Paper shape defined in 001, including title, authors, publication year, citation count, abstract, and source identifier; persisting it as a JSON record + Markdown note is owned by 003.
- **FR-008**: All communication with external databases (arXiv, Semantic Scholar) MUST happen only within this feature; no other feature communicates with external sources directly. Parsing and normalizing each provider's wire format (arXiv Atom XML, Semantic Scholar JSON) into the canonical Paper shape is likewise confined here — no raw provider payload (XML or a provider's own JSON) may be persisted or handed to another feature.
- **FR-009**: If the same paper is discovered through multiple subscriptions or overlapping catch-up windows, it MUST be processed only once, deduplicated by its source identifier.
- **FR-010**: Disabling a subscription MUST immediately stop any new collection caused by it, including catch-up searches on subsequent loads.
- **FR-011**: A discovered paper missing required information (e.g., a successful response with no publication year) MUST be skipped per the 001 hold-back rule rather than collected, and this MUST be distinguished from a provider-call failure.
- **FR-012**: If a provider is unreachable or a call fails, the system MUST retry on the next scheduled interval or next load, MUST NOT advance the last-checked time past the unsearched window, and MUST be able to inform the user of the failure.
- **FR-013**: A large batch of discovered papers MUST be processed sequentially without freezing the interface.
- **FR-014**: If a provider caps how far back a single catch-up query can reach, the system MUST inform the user that the off-period window could not be fully covered.
- **FR-015**: Collection MUST parse each provider response into a `PaperCandidate` (001) before it becomes a valid `Paper`. Where a provider does not supply a citation count or references (e.g., arXiv), the candidate MUST represent them as *unknown* rather than as 0 or an empty list, so that "unknown" is never conflated with a confirmed zero.
- **FR-016**: A candidate MUST be promoted to a valid `Paper` only when it has a publication year; on promotion, an unknown citation count becomes 0 and unknown references become an empty list, and the paper's `citationsKnown` flag records whether citation data was actually present (see FR-018). Missing citation data MUST NOT hold a candidate back — the publication year is the only hold-back trigger. Collection SHOULD enrich the candidate from a citation-aware provider (e.g., Semantic Scholar) *before* promotion when a confirmed count is needed up front (summarization 004, uncited-node styling 007), since that is what makes a stored 0 mean "confirmed uncited". When enrichment is not obtained before promotion, the paper is still stored (with `citationsKnown = false`) and corrected later by re-enrichment or a manual refresh (005), rather than being withheld.
- **FR-017**: This feature MUST own the per-paper processing pipeline: for each collected paper it enriches (where citation accuracy is needed), then — if summarization (004) is enabled — invokes 004 to generate summary/future-directions text, then hands the finished paper to 003 for a single coordinated persist. It MUST NOT itself implement text generation (004) or file I/O (003); it only sequences them. A summarization failure MUST NOT block persistence — 004's abstract fallback applies and the paper is still saved.
- **FR-018**: Every promoted `Paper` MUST carry a `citationsKnown` boolean (defined in 001): true when its citation count/references came from a citation-aware provider (a 0 then means "confirmed uncited"), false when it was promoted without citation data (a 0 then means "unknown, not confirmed uncited"). Enrichment failure on an otherwise-complete paper (provider unreachable, paper not indexed, or identity match failed) MUST result in immediate promotion with `citationsKnown = false` — never a hold-back. The persisted store is the source of pending enrichment: refresh (005) and any optional auto-heal MUST target exactly the `citationsKnown = false` papers and MUST NOT rescan the collection window to find them. Auto-heal re-enrichment MUST terminate: a provider positively reporting the paper's absence (or an unresolved identity match) is a terminal state that is not retried automatically, and transient failures are retried a bounded number of times before being left to manual refresh. Consumers that depend on citation status (004, 007) MUST treat a `citationsKnown = false` count of 0 as un-enriched rather than as a genuine zero.
- **FR-019**: When Semantic Scholar enrichment supplies a paper's references/citations, each reference's `sourceId` MUST be normalized to the `arxiv:` scheme (001) whenever the referenced work has a known arXiv ID, and MUST keep a `semanticScholar:`-scheme identifier only when no arXiv ID is available (Clarification 2026-07-05), so that graph edges (006) can connect an enrichment-supplied reference to a paper independently collected via arXiv.

### Key Entities

- **Subscription**: As defined in 001. This feature reads its type/value/interval/last-checked/enabled fields and updates last-checked after each check.
- **Paper / PaperCandidate**: As defined in 001. This feature parses provider responses into a `PaperCandidate` (which may carry an unknown citation count and unknown references when a provider like arXiv supplies none), optionally enriches it from a citation-aware provider, then promotes it to a valid `Paper` — holding back only candidates that lack a publication year (per the 001 rule), and on promotion defaulting an unknown citation count to 0 / unknown references to an empty list while setting the `Paper.citationsKnown` flag (001) to record whether citation data was actually present. `citationsKnown = false` marks a paper promoted without confirmed citations; this feature re-enriches exactly those from the persisted store. Persisting each paper as a JSON record + Markdown note is owned by 003. This feature writes no files.
- **Collection Window**: The time range a given check or catch-up search covers — from the subscription's last-checked time to the moment of the check. Not persisted as its own entity; it is derived each time from the subscription's last-checked time and the current time.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An enabled subscription checks for new papers on schedule while the plugin runs, with zero manual actions from the user.
- **SC-002**: After the plugin has been off, opening it results in exactly one catch-up search per enabled subscription over the off-period window, and papers published during that window are collected.
- **SC-003**: No collection activity occurs while the plugin is off (0 external calls made by any background process).
- **SC-004**: If the same paper is found through multiple subscriptions or overlapping windows, it is processed exactly once.
- **SC-005**: Disabling a subscription results in zero further collection attributable to it, including on later loads.
- **SC-006**: 100% of collected papers are represented as canonical Paper data parsed from provider responses; no other feature makes external calls.
- **SC-007**: A paper collected from a citation-less provider (arXiv) without enrichment is stored with a citation count of 0, empty references, and `citationsKnown = false` — never a fabricated non-zero value and never conflated with a confirmed zero; after enrichment or a manual refresh (005) it reflects the citation-aware provider's actual values with `citationsKnown = true`.
- **SC-008**: No paper is lost to enrichment failure: a paper whose enrichment fails is still persisted on the same pass (with `citationsKnown = false`), and every such paper is reachable for later re-enrichment directly from the store, with zero rescans of the collection window required to find it.

## Assumptions

- "The plugin was off" and "the plugin is loading" are observable to this feature via the plugin lifecycle owned by 008; this feature only needs the last-checked time (from 001) and the current time to compute the catch-up window.
- Providers accept a date/time-bounded query (or an equivalent that lets results be filtered to the catch-up window); where a provider does not, the feature filters returned results to the window itself.
- The exact retry/back-off policy and provider rate-limit handling are implementation details; this specification requires only that failures retry on the next interval/load and are surfaceable to the user.
- Providers differ in both wire format and coverage: arXiv returns Atom XML and supplies no citation data; Semantic Scholar returns JSON and supplies citation data. This feature parses and normalizes both into the plugin's single canonical Paper shape (001). The internal representation the rest of the plugin uses — a JSON record plus a Markdown note (003) — is the plugin's own normalized schema, distinct from and never a passthrough of any provider's wire payload.
- The same underlying paper appearing under different `sourceId`s across providers (out of scope for cross-provider identity per 001) is accepted as a possible duplicate node; reconciling such duplicates is left to a future feature.
