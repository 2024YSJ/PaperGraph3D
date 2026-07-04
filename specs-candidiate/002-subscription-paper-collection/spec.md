# Feature Specification: Subscription-Based Paper Collection

**Feature Branch**: `002-subscription-paper-collection`

**Created**: 2026-07-04

**Status**: Draft

**Input**: "Based on the subscriptions a user has registered, periodically find new papers from external academic databases (arXiv, Semantic Scholar). A user registers subscriptions for keywords, authors, or arXiv categories; new papers are collected automatically. All communication with external databases happens only within this feature. Collection does not run while the plugin is off — instead, when the plugin turns back on, it searches for the papers that appeared during the time it was off (the gap between when it stopped and when it started again). Provider responses arrive as JSON."

## Clarifications

### Session 2026-07-04

- Q: What happens to collection while Obsidian (or the plugin) is turned off? → A: No collection runs in the background while the plugin is off — there is no external process. Instead, each subscription records the last time it was checked, and when the plugin next loads it performs a single catch-up search per enabled subscription over the window from that last-checked time up to the current time, so papers published while the plugin was off are still found. Nothing collected during the off period is fabricated or back-dated beyond what the providers actually report for that window.
- Q: If the plugin was off for a very long time (weeks), does the catch-up window grow without bound? → A: The catch-up search covers the whole elapsed window, but is bounded by the same sequential, non-freezing processing rule as any large result set (see Edge Cases). If a provider caps how far back a single query can reach, the catch-up is limited to what the provider will return; the user is informed if the window could not be fully covered.
- Q: What is authoritative for a collected paper — the provider's JSON or anything derived from it? → A: The provider's JSON response is parsed into the canonical Paper Record (JSON) defined in 001. That record is what every downstream feature consumes. This feature never writes Markdown; note creation is 003's job.

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

**Independent Test**: With a subscription whose interval has elapsed, advance time and confirm a check fires, produces canonical Paper Records from the (stubbed) provider JSON, and updates the subscription's last-checked time.

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
- **FR-007**: Every collected paper MUST be parsed from the provider's JSON response into the canonical Paper Record (JSON) shape defined in 001, including title, authors, publication year, citation count, abstract, and source identifier.
- **FR-008**: All communication with external databases (arXiv, Semantic Scholar) MUST happen only within this feature; no other feature communicates with external sources directly.
- **FR-009**: If the same paper is discovered through multiple subscriptions or overlapping catch-up windows, it MUST be processed only once, deduplicated by its source identifier.
- **FR-010**: Disabling a subscription MUST immediately stop any new collection caused by it, including catch-up searches on subsequent loads.
- **FR-011**: A discovered paper missing required information (e.g., a successful response with no publication year) MUST be skipped per the 001 hold-back rule rather than collected, and this MUST be distinguished from a provider-call failure.
- **FR-012**: If a provider is unreachable or a call fails, the system MUST retry on the next scheduled interval or next load, MUST NOT advance the last-checked time past the unsearched window, and MUST be able to inform the user of the failure.
- **FR-013**: A large batch of discovered papers MUST be processed sequentially without freezing the interface.
- **FR-014**: If a provider caps how far back a single catch-up query can reach, the system MUST inform the user that the off-period window could not be fully covered.

### Key Entities

- **Subscription**: As defined in 001. This feature reads its type/value/interval/last-checked/enabled fields and updates last-checked after each check.
- **Paper Record (JSON)**: As defined in 001. This feature produces these from provider JSON; it does not write Markdown notes.
- **Collection Window**: The time range a given check or catch-up search covers — from the subscription's last-checked time to the moment of the check. Not persisted as its own entity; it is derived each time from the subscription's last-checked time and the current time.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An enabled subscription checks for new papers on schedule while the plugin runs, with zero manual actions from the user.
- **SC-002**: After the plugin has been off, opening it results in exactly one catch-up search per enabled subscription over the off-period window, and papers published during that window are collected.
- **SC-003**: No collection activity occurs while the plugin is off (0 external calls made by any background process).
- **SC-004**: If the same paper is found through multiple subscriptions or overlapping windows, it is processed exactly once.
- **SC-005**: Disabling a subscription results in zero further collection attributable to it, including on later loads.
- **SC-006**: 100% of collected papers are represented as canonical Paper Records parsed from provider JSON; no other feature makes external calls.

## Assumptions

- "The plugin was off" and "the plugin is loading" are observable to this feature via the plugin lifecycle owned by 008; this feature only needs the last-checked time (from 001) and the current time to compute the catch-up window.
- Providers accept a date/time-bounded query (or an equivalent that lets results be filtered to the catch-up window); where a provider does not, the feature filters returned results to the window itself.
- The exact retry/back-off policy and provider rate-limit handling are implementation details; this specification requires only that failures retry on the next interval/load and are surfaceable to the user.

## Out of Scope

- Saving collected papers as notes (JSON record + Markdown note) is owned by 003.
- Summarizing or otherwise processing paper content is owned by 004.
- Manually refreshing an already-saved paper is owned by 005.
- The plugin lifecycle that decides when "load" happens is owned by 008.
