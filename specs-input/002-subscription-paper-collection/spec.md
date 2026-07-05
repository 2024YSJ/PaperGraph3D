# Feature Specification: Subscription-Based Paper Collection

**Feature Branch**: `002-subscription-paper-collection`

**Created**: 2026-07-04

**Status**: Draft

**Input**: "Based on the subscriptions a user has registered, periodically find new papers from external academic databases (arXiv, Semantic Scholar). A user registers subscriptions for keywords, authors, or arXiv categories; new papers are collected automatically. All communication with external databases happens only within this feature. Collection does not run while the plugin is off — instead, when the plugin turns back on, it searches for the papers that appeared during the time it was off (the gap between when it stopped and when it started again). Provider responses arrive in provider-specific formats (arXiv as Atom XML, Semantic Scholar as JSON) and are parsed into the canonical paper shape."

## Clarifications

### Session 2026-07-04

- Q: What happens to collection while Obsidian (or the plugin) is turned off? → A: No collection runs in the background while the plugin is off — there is no external process. Instead, each subscription records the last time it was checked, and when the plugin next loads it performs a single catch-up search per enabled subscription over the window from that last-checked time up to the current time, so papers published while the plugin was off are still found. Nothing collected during the off period is fabricated or back-dated beyond what the providers actually report for that window.
- Q: If the plugin was off for a very long time (weeks), does the catch-up window grow without bound? → A: The catch-up search covers the whole elapsed window, but is bounded by the same sequential, non-freezing processing rule as any large result set (see Edge Cases). If a provider caps how far back a single query can reach, the catch-up is limited to what the provider will return; the user is informed if the window could not be fully covered.
- Q: What is authoritative for a collected paper — the provider's response or anything derived from it? → A: The provider's response is parsed into the canonical Paper shape defined in 001; the persistence feature (003) then stores that paper as its JSON record + Markdown note pair. The parsed paper data is what every downstream feature consumes. This feature never writes files; note/record creation is 003's job.

### Session 2026-07-05

- Q: How does a raw provider response become a valid Paper, and what happens to citation data that a provider such as arXiv does not supply at all? → A: A response is first parsed into a `PaperCandidate` (001), which may carry an *unknown* citation count and unknown references — arXiv returns no citation data, so those stay unknown rather than being set to 0/empty. The candidate is then *promoted* to a valid `Paper` only when it has a publication year (otherwise it is held back — see FR-011). On promotion, an unknown citation count defaults to 0 and unknown references default to an empty list. Because that default collapses "unknown" into "zero", any subscription whose papers need an accurate citation count or relationships for later features (future-directions text 004, uncited-node styling 007) MUST be enriched from a citation-aware provider (Semantic Scholar) *before* promotion; a paper promoted without enrichment is stored reading "0 citations", which a later manual refresh (005) can correct.
- Q: Why keep "unknown" separate from 0 in the candidate at all, if promotion collapses it anyway? → A: So this feature can decide *whether to enrich* before promoting. A candidate with an unknown citation count is a signal that citation data has not been fetched yet; a candidate reading 0 after enrichment is a confirmed "uncited" paper. Collapsing them only at the final promotion step keeps that decision available for as long as it is useful.
- Q: A collected paper may need a summary (004) and must be persisted (003) — who sequences those steps, and in what order? → A: This feature owns the per-paper processing pipeline. For each collected paper it enriches (where citation accuracy is needed), then — if summarization is on — invokes 004 to generate the summary/future-directions text, then hands the finished paper to 003 for a single coordinated persist that writes the record + note (including the summary) at once, so the note appears already complete rather than being written twice. 004 and 003 own *what* each step does; this feature owns *when* they run. If summarization fails or times out, 004's abstract fallback applies and persistence still proceeds.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Register and manage subscriptions (Priority: P1)

As a user tracking research trends, I want to register subscriptions for keywords, authors, or arXiv categories I care about and manage them at any time, so that new papers are collected automatically without me searching myself.

**Why this priority**: Without subscriptions there is nothing to collect. Registration and management is the entry point for the entire collection pipeline.

**Independent Test**: Register a subscription of each type, view the list, disable one, delete another, and confirm each action is reflected — using stubbed provider responses so no live network is required.

**Acceptance Scenarios**:

1. **Given** the subscription list, **When** the user enters a type (keyword / author / arXiv category) and a value, **Then** a new subscription is registered with a default check interval and appears in the list.
2. **Given** a registered subscription, **When** the user disables it, **Then** it no longer triggers any new collection.
3. **Given** a registered subscription, **When** the user deletes it, **Then** it is removed from the list and stops triggering collection.
4. **Given** a subscription, **When** the user sets its check interval, **Then** only the five allowed intervals (6/12/24/48/72 hours) are accepted.

---

### User Story 2 - Automatic scheduled collection while running (Priority: P1)

As a user, I want each enabled subscription to check for new papers on its own interval while the plugin is running, so that my vault stays current without manual action.

**Why this priority**: Scheduled collection is the feature's core value; everything downstream (notes, graph) depends on papers arriving.

**Independent Test**: With a subscription whose interval has elapsed, advance time and confirm a check fires, produces canonical Paper data (by parsing the stubbed provider response into a candidate and promoting it), and updates the subscription's last-checked time.

**Acceptance Scenarios**:

1. **Given** an enabled subscription whose interval has elapsed, **When** the plugin is running, **Then** it checks the provider for new papers with no manual action from the user.
2. **Given** a check completes, **When** it finishes, **Then** the subscription's last-checked time is updated to the moment of that check.
3. **Given** the same paper is found through two different subscriptions, **When** both checks run, **Then** the paper is processed only once (deduplicated by source identifier).

---

### User Story 3 - Catch-up collection across the off period (Priority: P1)

As a user who closes Obsidian overnight or for days, I want the plugin, when I open it again, to find the papers that were published while it was off, so that turning the plugin off never creates a permanent blind spot in my tracking.

**Why this priority**: This is the explicit behavior that replaces background collection. Without it, any time the plugin is off is lost coverage.

**Independent Test**: Set a subscription's last-checked time to the past, load the plugin, and confirm exactly one catch-up search runs per enabled subscription over the window from last-checked to now, producing the papers the (stubbed) provider reports for that window and then updating last-checked to now.

**Acceptance Scenarios**:

1. **Given** the plugin has been off and a subscription's last-checked time is in the past, **When** the plugin loads, **Then** a single catch-up search runs for that subscription covering the window from its last-checked time to the current time.
2. **Given** the catch-up search completes, **When** it finishes, **Then** the subscription's last-checked time is advanced to the current time so the same window is never searched twice.
3. **Given** the plugin is off, **When** no plugin process is running, **Then** no collection occurs during the off period — collection only resumes as catch-up on the next load.
4. **Given** a disabled subscription, **When** the plugin loads after an off period, **Then** no catch-up search runs for it.

---

### Edge Cases

- If the external database is temporarily unreachable, the check must not crash; the system retries at the next scheduled interval (or next load) and is able to inform the user of the failure. The subscription's last-checked time is not advanced past a window that was not actually searched.
- If an unusually large number of papers is discovered at once (e.g., right after registering a subscription, or after a long off period), they must be processed sequentially without freezing the interface.
- If a discovered paper is missing required information such as publication year (a *successful* response lacking a year), it is skipped for this pass rather than collected, per the hold-back rule in 001 — not treated as a provider failure.
- An arXiv-only paper carries no citation data, so its candidate's citation count and references are unknown. If it is promoted without Semantic Scholar enrichment, it is stored with a citation count of 0 and no references — indistinguishable from a genuinely uncited paper until a later enrichment or a manual refresh (005) updates it. This is expected behavior, not a failure.
- If the plugin is turned off mid-check, the subscription's last-checked time must not advance past the portion of the window that was actually completed, so the unsearched remainder is picked up on the next load.
- If two subscriptions' catch-up windows overlap and surface the same paper, it is still processed only once.
- If a provider limits how far back a catch-up query can reach, the user is informed that the off-period window could not be fully covered.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A user MUST be able to register a new subscription by entering its type (keyword / author / arXiv category) and value; a newly registered subscription receives the default check interval defined in 001 unless the user chooses another allowed interval.
- **FR-002**: A user MUST be able to view the list of registered subscriptions and delete or enable/disable any individual subscription.
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
- **FR-016**: A candidate MUST be promoted to a valid `Paper` only when it has a publication year; on promotion, an unknown citation count becomes 0 and unknown references become an empty list. To store an accurate citation count and citation relationships, collection MUST enrich the candidate from a citation-aware provider (e.g., Semantic Scholar) *before* promotion. A paper promoted without enrichment is stored with a citation count of 0, correctable later by a manual refresh (005). In particular, when summarization (004) or the uncited-node styling (007) will rely on citation status, enrichment MUST precede promotion so that a stored citation count of 0 means "confirmed uncited" rather than "not yet enriched".
- **FR-017**: This feature MUST own the per-paper processing pipeline: for each collected paper it enriches (where citation accuracy is needed), then — if summarization (004) is enabled — invokes 004 to generate summary/future-directions text, then hands the finished paper to 003 for a single coordinated persist. It MUST NOT itself implement text generation (004) or file I/O (003); it only sequences them. A summarization failure MUST NOT block persistence — 004's abstract fallback applies and the paper is still saved.

### Key Entities

- **Subscription**: As defined in 001. This feature reads its type/value/interval/last-checked/enabled fields and updates last-checked after each check.
- **Paper / PaperCandidate**: As defined in 001. This feature parses provider responses into a `PaperCandidate` (which may carry an unknown citation count and unknown references when a provider like arXiv supplies none), optionally enriches it from a citation-aware provider, then promotes it to a valid `Paper` — holding back candidates that lack a publication year (per the 001 rule) and defaulting an unknown citation count to 0 / unknown references to an empty list on promotion. Persisting each paper as a JSON record + Markdown note is owned by 003. This feature writes no files.
- **Collection Window**: The time range a given check or catch-up search covers — from the subscription's last-checked time to the moment of the check. Not persisted as its own entity; it is derived each time from the subscription's last-checked time and the current time.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An enabled subscription checks for new papers on schedule while the plugin runs, with zero manual actions from the user.
- **SC-002**: After the plugin has been off, opening it results in exactly one catch-up search per enabled subscription over the off-period window, and papers published during that window are collected.
- **SC-003**: No collection activity occurs while the plugin is off (0 external calls made by any background process).
- **SC-004**: If the same paper is found through multiple subscriptions or overlapping windows, it is processed exactly once.
- **SC-005**: Disabling a subscription results in zero further collection attributable to it, including on later loads.
- **SC-006**: 100% of collected papers are represented as canonical Paper data parsed from provider responses; no other feature makes external calls.
- **SC-007**: A paper collected from a citation-less provider (arXiv) without enrichment is stored with a citation count of 0 and empty references — never a fabricated non-zero value; after enrichment or a manual refresh (005) it reflects the citation-aware provider's actual values.

## Assumptions

- "The plugin was off" and "the plugin is loading" are observable to this feature via the plugin lifecycle owned by 008; this feature only needs the last-checked time (from 001) and the current time to compute the catch-up window.
- Providers accept a date/time-bounded query (or an equivalent that lets results be filtered to the catch-up window); where a provider does not, the feature filters returned results to the window itself.
- The exact retry/back-off policy and provider rate-limit handling are implementation details; this specification requires only that failures retry on the next interval/load and are surfaceable to the user.
- Providers differ in both wire format and coverage: arXiv returns Atom XML and supplies no citation data; Semantic Scholar returns JSON and supplies citation data. This feature parses and normalizes both into the plugin's single canonical Paper shape (001). The internal representation the rest of the plugin uses — a JSON record plus a Markdown note (003) — is the plugin's own normalized schema, distinct from and never a passthrough of any provider's wire payload.

## Open Questions

*Deferred to `/speckit.clarify` and `/speckit.plan` — recorded so refinement and planning address them. None are settled yet.*

- **OQ-1 — First-collection window for a brand-new subscription (`lastCheckedAt` = null).** 001 allows `lastCheckedAt` to be null (never checked). FR-004 defines the catch-up window as last-checked → now but leaves the null case open: does a new subscription collect forward-only from registration, or back-fill an initial window (and how far back)? *(High impact — controls whether registering a subscription floods the vault.)*
- **OQ-2 — Provider routing per subscription type.** Is discovery arXiv-only (with Semantic Scholar used only for enrichment), or does Semantic Scholar also serve keyword/author discovery? FR-008 confines all provider calls here but does not fix the per-type routing.
- **OQ-3 — arXiv ↔ Semantic Scholar identity matching for enrichment.** Enriching an arXiv paper with citation data requires matching it to its Semantic Scholar record (arXiv ID, DOI, …). 001 scopes cross-provider *identity* out of scope, so the enrichment matching method must be defined here.
- **OQ-4 — `sourceId` scheme for enriched references.** When Semantic Scholar supplies a paper's references/citations, what `sourceId` scheme do they carry (normalize to `arxiv:` when possible, or keep `semanticScholar:`)? Determines whether graph edges (006) connect to stored papers.
- **OQ-5 — references unknown → `[]` collapse.** Promotion collapses unknown references to `[]` (mirroring the citationCount policy). Should references, like citationCount, require enrichment before promotion when the graph (006) relies on edges, or is a temporarily missing edge acceptable? *(See 006 Open Questions.)*
- **OQ-6 — Cross-provider duplicates.** The same work can carry different `sourceId`s across providers (001, out of scope), so it may appear twice. Accept possible duplicate nodes, or add later reconciliation?
- **OQ-7 — Scheduling mechanism.** Per-subscription timers vs a single periodic sweep; interval alignment/drift. *(Plan-level.)*

## Out of Scope

- The file writes for the record/note pairing are owned by 003; this feature sequences the pipeline and hands 003 the finished paper, but performs no file I/O itself.
- Generating summary/future-directions text is owned by 004; this feature only invokes 004 at the right point in the pipeline (before persistence) and does not implement generation.
- Manually refreshing an already-saved paper is owned by 005.
- The plugin lifecycle that decides when "load" happens is owned by 008.
