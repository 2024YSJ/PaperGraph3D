# Feature Specification: Manual Paper Refresh

**Feature Branch**: `005-manual-paper-refresh`

**Created**: 2026-07-04

**Status**: Draft

**Input**: "When a user requests it, re-fetch up-to-date citation count and citation relationships for a paper already saved in the vault. The refresh applies to the existing synchronized record + note pairing, updating only plugin-managed fields and preserving anything the user wrote by hand. This is manual-only — no automatic or scheduled refreshing."

## Clarifications

### Session 2026-07-04

- Q: What exactly does a refresh update, and where does it write? → A: It re-checks the paper's citation count and citation relationships (which papers cite it, and the outbound references), then writes the new values into the canonical JSON record and mirrors them into the Markdown note's managed region via the 003 pairing. The user's free-form body is untouched.
- Q: Does refresh discover new papers or make its own external calls? → A: It refreshes one already-saved paper's data. The external lookup reuses the same provider-communication boundary as collection (002); refresh does not add new papers to the vault, it only updates the requested paper's managed fields.
- Q: What if the paper can no longer be found in the provider? → A: The existing saved information is kept unchanged and the user is informed of the failure; the record/note pairing is never left partially updated.

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

### Edge Cases

- If a refresh is requested but the paper can no longer be found in the external database, the existing saved information is kept and the user is informed of the failure; nothing in the pairing is partially overwritten.
- If a refresh is already in progress for a paper and is requested again, it must not be processed twice concurrently.
- If the provider call fails or times out, the existing data is preserved and the user is informed; the record/note pairing is never left inconsistent.
- Updated citation relationships may reference papers not in the vault; storing those references follows the same rule as collection (references are recorded on the record; unresolved targets are handled by the graph feature, 006).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A user MUST be able to manually request an information refresh for a single, already-saved paper note.
- **FR-002**: A refresh MUST re-check that paper's citation count and citation relationships (which papers cite it, and its outbound references).
- **FR-003**: The refreshed information MUST be applied to the existing JSON record and the Markdown note's managed region via the 003 synchronized pairing — not to a new note — and anything the user wrote in the note body MUST be preserved.
- **FR-004**: A refresh MUST affect only the requested paper; all other paper notes MUST remain unchanged.
- **FR-005**: If the paper can no longer be found in the external database, the existing information MUST be kept and the user informed; the pairing MUST NOT be partially updated.
- **FR-006**: If a refresh is already in progress for a paper, a repeat request MUST NOT process it twice concurrently.
- **FR-007**: Refresh MUST be manual-only; no automatic or scheduled refreshing is performed by this feature.
- **FR-008**: External provider communication for a refresh MUST go through the same provider-communication boundary used for collection (002), so external access stays centralized.

### Key Entities

- **Paper Record (JSON)** / **Paper Note (Markdown)**: As defined in 003 (the logical Paper shape is 001); this feature updates their citation-related managed fields via 003.
- **Refresh Request**: A transient, user-initiated action targeting one saved paper by its source identifier. Not persisted; it carries only which paper to refresh and guards against concurrent duplicates.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After a refresh, the requested paper's citation count reflects the latest provider value.
- **SC-002**: Content the user wrote by hand in the note is unchanged after a refresh, 100% of the time.
- **SC-003**: Paper notes not requested for refresh are unaffected (zero changes).
- **SC-004**: A refresh that fails or targets a no-longer-found paper leaves the existing pairing fully intact and informs the user.
- **SC-005**: A paper with a refresh already in progress is never processed twice concurrently.

## Assumptions

- The refresh action is surfaced to the user through the graph's right-click menu (007) and/or a command; this feature provides the refresh behavior itself, not its menu placement.
- Whether a manually edited managed field is overwritten follows 003's policy: the JSON record is authoritative and its managed region is rebuilt on update.

## Out of Scope

- Discovering new papers is owned by 002.
- Automatic or scheduled refreshing is explicitly excluded; this feature is manual-request-only.
- The on-screen menu/trigger that invokes a refresh is owned by 007; the record/note write is performed through 003.
