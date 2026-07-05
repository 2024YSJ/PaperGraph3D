# Feature Specification: Manual Paper Refresh

**Feature Branch**: `005-manual-paper-refresh`

**Created**: 2026-07-04

**Status**: Draft

**Input**: "When a user requests it, re-fetch up-to-date citation count and citation relationships for a paper already saved in the vault. The refresh applies to the existing synchronized record + note pairing, updating only plugin-managed fields and preserving anything the user wrote by hand. This is manual-only — no automatic or scheduled refreshing. A user MUST also be able to trigger this for every saved paper published within the last year in a single action, so citation counts that drift while a subscription runs a long time don't require refreshing papers one at a time."

## Clarifications

### Session 2026-07-04

- Q: What exactly does a refresh update, and where does it write? → A: It re-checks the paper's citation count and its own outbound references (the papers it cites) — never inbound "who cites this paper," which per 001/006 is never fetched or stored per-paper and is instead derived by inverting outbound references across the vault — then writes the new values into the canonical JSON record and mirrors them into the Markdown note's managed region via the 003 pairing. The user's free-form body is untouched. It also sets `citationsKnown` (001) to `true` when the provider supplied real data, resolving a paper that was previously promoted with `citationsKnown = false`.
- Q: Does refresh discover new papers or make its own external calls? → A: It refreshes one already-saved paper's data. The external lookup reuses the same provider-communication boundary as collection (002); refresh does not add new papers to the vault, it only updates the requested paper's managed fields.
- Q: What if the paper can no longer be found in the provider? → A: The existing saved information is kept unchanged and the user is informed of the failure; the record/note pairing is never left partially updated.

### Session 2026-07-06

- Q: A subscription running for a long time accumulates papers whose citation counts drift, but refreshing them one at a time is impractical. Should this feature support refreshing many papers in one action, and if so, which ones? → A: Yes — a single user-triggered action refreshes every saved paper whose `publicationYear` is within the last year (recency, not staleness/last-refreshed-time — no new field is added to 001 for this). This is still manual: the user explicitly triggers the batch, it does not run on a schedule or in the background. Papers older than the window are not touched by this action; a user can still refresh any individual older paper via the single-paper mode (FR-001). A separate, deferred idea — 002 automatically re-enriching stored papers on its own schedule — is recorded as a future consideration, not part of this feature.
- Q: Why publicationYear and not a new "last refreshed" timestamp? → A: publicationYear is already part of the 001 `Paper` shape, so this needs no new field. It also more directly answers the relevant question ("has this paper existed long enough that a citation-aware provider likely has data for it") than "how long ago did we last check," which depends on when the paper happened to be collected rather than how old it actually is.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Refresh a single saved paper on demand (Priority: P3)

As a user, I know a citation count I saved a while ago may have changed, so I want to pick that paper and refresh it with the latest information whenever I want.

**Why this priority**: A convenience on top of a working save pipeline; valuable but not blocking for collection, persistence, or display.

**Independent Test**: Save a paper with a known citation count, trigger a refresh against a (stubbed) provider returning a higher count and updated relationships, and confirm the record and note's managed region reflect the new values while the user's body text is unchanged.

**Acceptance Scenarios**:

1. **Given** an already-saved paper note, **When** the user requests a refresh for it, **Then** its citation count and citation relationships are re-checked against the provider.
2. **Given** a refresh completes, **When** the new data is applied, **Then** it updates the existing JSON record and the note's managed region — not a new note — and the user's hand-written body is unchanged.
3. **Given** other paper notes were not requested for refresh, **When** a refresh runs, **Then** those other papers are unaffected.

---

### User Story 2 - Refresh all recent papers in one action (Priority: P4)

As a user whose subscriptions have run for a long time, I want to refresh every saved paper published within the last year in a single action, so I don't have to refresh dozens of papers one at a time to keep recent citation counts current.

**Why this priority**: A convenience layered on top of User Story 1's single-paper refresh; valuable once a vault has accumulated enough papers that one-at-a-time refreshing is impractical, but not required for the core save pipeline.

**Independent Test**: Save several papers with a mix of publication years (some within the last year, some older), trigger the bulk refresh action, and confirm only the papers published within the last year were re-checked against a (stubbed) provider, processed one at a time, while older papers and unrelated notes are untouched.

**Acceptance Scenarios**:

1. **Given** a vault with saved papers published at various times, **When** the user triggers a bulk refresh, **Then** only papers whose `publicationYear` is within the last year are re-checked against the provider.
2. **Given** the bulk refresh is running, **When** many matching papers exist, **Then** they are processed sequentially, one at a time, without freezing the interface.
3. **Given** one matching paper's refresh fails (provider unreachable, or the paper can no longer be found), **When** the bulk refresh continues, **Then** the failure does not stop the remaining papers from being processed, and the failures are summarized to the user rather than reported one by one.
4. **Given** a paper is already being refreshed individually (User Story 1) when a bulk refresh reaches it, **When** the bulk refresh processes that paper, **Then** it is not refreshed twice concurrently.

---

### Edge Cases

- If a refresh is requested but the paper can no longer be found in the external database, the existing saved information is kept and the user is informed of the failure; nothing in the pairing is partially overwritten.
- If a refresh is already in progress for a paper and is requested again, it must not be processed twice concurrently.
- If the provider call fails or times out, the existing data is preserved and the user is informed; the record/note pairing is never left inconsistent.
- Updated citation relationships may reference papers not in the vault; storing those references follows the same rule as collection (references are recorded on the record; unresolved targets are handled by the graph feature, 006).
- If a bulk refresh is already running when the user triggers it again, a second run MUST NOT start concurrently; the user is informed one is already in progress.
- If a bulk refresh and a single-paper refresh (User Story 1) target the same paper at the same time, only one runs against that paper at a time (FR-006 extended to cover this case).
- If the bulk refresh is interrupted (e.g., the plugin is closed mid-run), papers already processed keep their updated values; papers not yet reached are simply refreshed on the next bulk run — there is no partial-batch state to recover.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A user MUST be able to manually request an information refresh for a single, already-saved paper note.
- **FR-002**: A refresh MUST re-check that paper's citation count and its own outbound references (the papers it cites), and MUST set `citationsKnown` (001) to `true` once the provider supplies real data. Inbound "who cites this paper" is out of scope — per 001/006 it is never fetched or stored per-paper.
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

### Key Entities

- **Paper Record (JSON)** / **Paper Note (Markdown)**: As defined in 003 (the logical Paper shape is 001); this feature updates their citation-related managed fields via 003.
- **Refresh Request**: A transient, user-initiated action targeting one saved paper by its source identifier. Not persisted; it carries only which paper to refresh and guards against concurrent duplicates.
- **Bulk Refresh Run**: A transient, user-initiated action that selects every saved paper with `publicationYear` within the last year and processes each through the same single-paper refresh logic as FR-002/FR-003, sequentially. Not persisted across sessions; it carries no state beyond the current run's progress and per-paper failure summary.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After a refresh, the requested paper's citation count reflects the latest provider value.
- **SC-002**: Content the user wrote by hand in the note is unchanged after a refresh, 100% of the time.
- **SC-003**: Paper notes not requested for refresh are unaffected (zero changes).
- **SC-004**: A refresh that fails or targets a no-longer-found paper leaves the existing pairing fully intact and informs the user.
- **SC-005**: A paper with a refresh already in progress is never processed twice concurrently.
- **SC-006**: A bulk refresh touches exactly the set of saved papers whose `publicationYear` is within the last year — zero papers outside that window are modified.
- **SC-007**: A bulk refresh over 100+ matching papers completes without the interface becoming unresponsive to other user actions.
- **SC-008**: Individual failures during a bulk refresh never abort the run; every matching paper is attempted, and failures are presented to the user as a single summary.

## Assumptions

- The refresh action is surfaced to the user through the graph's right-click menu (007) and/or a command; this feature provides the refresh behavior itself, not its menu placement. The bulk refresh (FR-009) is surfaced as a separate, explicit command/action distinct from the per-node single refresh, since it targets many papers rather than one.
- Whether a manually edited managed field is overwritten follows 003's policy: the JSON record is authoritative and its managed region is rebuilt on update.
- The "within the last year" window (FR-009) is judged by `publicationYear` alone, not by when a paper was collected or last refreshed — no new timestamp field is added to 001 for this feature. A future, separate idea (002 automatically re-enriching stored papers on its own schedule, independent of user action) is deliberately out of scope here and recorded elsewhere as a future consideration, not this feature.

## Open Questions

*Deferred to `/speckit.clarify` and `/speckit.plan` — recorded so refinement and planning address them. None are settled yet.*

- ~~**OQ-1 — What a refresh actually persists for inbound citations.**~~ Resolved (Session 2026-07-06 / FR-002): a refresh persists only the updated citation count and this paper's own outbound `references`, plus `citationsKnown = true`; inbound "who cites this paper" is never fetched or stored, per 001/006's outbound-only design.
- **OQ-2 — Re-summarization on status change.** If a refresh flips a paper's citation status (uncited ↔ cited), does it re-trigger 004's summary/future-directions text, or leave the existing text unchanged? *(See 004 OQ-4.)*
- **OQ-3 — Bulk refresh trigger surface.** FR-009 fixes the behavior (what gets refreshed, sequential processing, failure summary), but not where the user invokes it (command palette, settings button, graph toolbar). *(Plan-level, see 007/008.)*

## Out of Scope

- Discovering new papers is owned by 002.
- Automatic or scheduled refreshing is explicitly excluded; both the single-paper and bulk modes in this feature are manual-request-only. A separate, deferred idea for 002 to automatically re-enrich stored papers on its own schedule is recorded as a future consideration, not part of this feature.
- The on-screen menu/trigger that invokes either refresh mode is owned by 007/008; the record/note write is performed through 003.
