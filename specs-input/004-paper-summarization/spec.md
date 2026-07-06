# Feature Specification: Paper Summarization & Future-Directions Text

**Feature Branch**: `004-paper-summarization`

**Created**: 2026-07-04

**Status**: Draft

**Input**: "Optionally add a summary to each paper note, and, for the most recent papers that nobody has cited yet, a description of possible future directions. A user can turn this off completely; with it off, paper notes are still created normally using the original abstract. The user chooses a summarization provider and supplies credentials in settings. Generated text is written into the same synchronized JSON record + Markdown note pairing used everywhere else."

## Clarifications

### Session 2026-07-04

- Q: This feature makes external calls to a summarization provider — is it on by default? → A: No. Per the project's commitment (and the 001 default `summarizationEnabled: false`), it is off until the user explicitly opts in and supplies credentials. With it off, no summarization call is ever made.
- Q: Where does generated summary / future-directions text live? → A: In the paper's canonical JSON record (as plugin-managed fields) and mirrored into the Markdown note's managed region, using the same synchronized pairing from 003. Generated text is plugin-managed content, never written into the user's free-form body.
- Q: Which papers get future-directions text versus only a summary? → A: A paper that nobody has cited yet (citation count of zero / no inbound citations) receives a future-directions description in addition to the summary; already-cited papers receive only the summary.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Opt in to summaries (Priority: P2)

As a user, I want to grasp a paper's content quickly through a generated summary instead of reading the abstract myself, and I want to turn this on or off whenever I like.

**Why this priority**: Summarization is a value-add on top of a working collect-and-save pipeline; it must not be a prerequisite for that pipeline.

**Independent Test**: With the feature on and valid (stubbed) credentials, persist a paper and confirm a summary appears in its record and note's managed region; with the feature off, confirm the note is created with just the abstract and no summary call is made.

**Acceptance Scenarios**:

1. **Given** the feature is off, **When** a new paper is persisted, **Then** its note is created normally containing the original abstract, and no summarization provider is contacted.
2. **Given** the feature is on with valid credentials, **When** a new paper is persisted, **Then** a generated summary is added to the paper's JSON record and mirrored into the note's managed region.
3. **Given** the feature is toggled off, **When** subsequent papers are persisted, **Then** none of them trigger a summarization call.

---

### User Story 2 - Future directions for uncited recent papers (Priority: P3)

As a user, I want the most recent papers that nobody has cited yet to also come with a description of how the research might develop, so I can spot promising frontier work.

**Why this priority**: A refinement of the summary feature; only meaningful once summaries exist.

**Independent Test**: With the feature on, persist one paper with zero citations and one with a positive citation count, and confirm the uncited one receives both a summary and a future-directions description while the cited one receives only a summary.

**Acceptance Scenarios**:

1. **Given** the feature is on, **When** an uncited paper (no inbound citations) is persisted, **Then** both a summary and a future-directions description are added.
2. **Given** the feature is on, **When** an already-cited paper is persisted, **Then** only a summary is added, with no future-directions description.

---

### User Story 3 - Configure provider and credentials (Priority: P2)

As a user, I want to choose which provider generates summaries and enter the required credentials in settings, so that I control the outside service and my keys.

**Why this priority**: Making external calls responsibly requires the user's explicit provider choice and credentials.

**Independent Test**: Enter a provider and credentials in settings, confirm they are used for generation, and confirm incorrect credentials produce a clear message rather than a silent failure.

**Acceptance Scenarios**:

1. **Given** settings, **When** the user selects a provider and enters credentials, **Then** those are used for subsequent generation.
2. **Given** incorrect credentials, **When** generation is attempted, **Then** the user is informed of the credential problem.

---

### Edge Cases

- If summary generation fails or takes too long, note/record creation MUST NOT be blocked — it falls back to the original abstract, and the paper is still saved.
- If credentials are entered incorrectly, the user is informed rather than left with silent failures.
- If the generated summary is too short or empty, it falls back to the original abstract.
- If the feature is turned off while a generation is in flight, the in-flight result is discarded and the note is completed from the abstract; no other feature stops working because this one is off. This feature has no polling or cancellation mechanism of its own — see the Assumptions note on FR-009 for who actually implements this.
- Whether a paper is "uncited" is read from its canonical record's citation count (0 = uncited). Because collection (002) collapses an un-enriched paper's unknown citation count to 0 on promotion, 002 enriches before promotion when this feature is on (see 002 FR-016), so a 0 seen here means "confirmed uncited". If citation data is genuinely unavailable, the paper is treated as not qualifying for future-directions text (summary only).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The user MUST be able to turn this feature on or off in settings; it is off by default (per 001).
- **FR-002**: When the feature is off, paper notes MUST still be created normally using only the original abstract, and no summarization provider may be contacted.
- **FR-003**: When the feature is on, a generated summary MUST be added to the paper's canonical JSON record and mirrored into the Markdown note's plugin-managed region (via the 003 pairing) — never into the user's free-form body.
- **FR-004**: For a paper that nobody has cited yet, a future-directions description MUST be added in addition to the summary; already-cited papers receive only the summary.
- **FR-005**: No other feature may stop working because this feature is off; summarization is strictly additive to the collect-and-save pipeline.
- **FR-006**: The user MUST be able to specify which provider generates summaries and supply any required credentials in settings.
- **FR-007**: If generation fails, times out, or returns text that is empty or too short, the feature MUST fall back to the original abstract and still complete note/record creation.
- **FR-008**: If credentials are invalid, the user MUST be informed.
- **FR-009**: Turning the feature off MUST prevent any further summarization calls, including discarding any in-flight generation. (See Assumptions: this feature has no scheduler/poller of its own, so the caller — 002 — is what actually detects the setting change and performs the discard.)

### Key Entities

- **Paper Record (JSON)** / **Paper Note (Markdown)**: As defined in 003 (the logical Paper shape is 001); this feature adds summary and (conditionally) future-directions fields to the managed content via 003's synchronized pairing.
- **Summarization Settings**: The on/off flag (from 001) plus the chosen provider and credentials, which are extension fields (001 FR-016) defined by this feature and surfaced in the summarization section of the settings screen (008). Credentials are sensitive and handled per the project's transparent-use policy.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With the feature off, 100% of new paper notes are still created and contain the abstract, with zero calls to any summarization provider.
- **SC-002**: With the feature on, uncited papers receive a future-directions description while already-cited papers receive only a summary.
- **SC-003**: Every generation failure results in an abstract fallback and a successfully saved paper — zero papers fail to save because summarization failed.
- **SC-004**: Generated text appears only in the plugin-managed region; zero user-written body content is altered by this feature.

## Assumptions

- Citation status ("uncited" = citation count 0) is derived from the paper's canonical record, populated by collection (002) or refresh (005). Its reliability depends on 002 enriching the paper before promotion; per 002 FR-016, when this feature is on, enrichment precedes promotion so a 0 is a confirmed count, not an un-enriched placeholder.
- This feature does not self-trigger: the collection pipeline (002) invokes it (when enabled) *before* a paper is persisted, and its generated text is handed to 003 as part of a single persist. It is the only place summarization calls are made, analogous to how 002 is the only place collection calls are made.
- **FR-009's enable/disable gate and in-flight discard are implemented by the caller, not by this feature.** Because this feature is only ever invoked synchronously by 002 (it has no background poller, timer, or cancellation token of its own), it cannot by itself detect a mid-flight settings change. 002 satisfies FR-009 on this feature's behalf by reading `summarizationEnabled` and the provider credentials live (via getter functions) both immediately before calling this feature and again immediately after it resolves, discarding the result if the setting flipped off in between (002 `specs/002-subscription-paper-collection/spec.md` FR-021, `research.md` Decision 26). Any other future caller of this feature (e.g. 005's manual refresh) must implement the same live-read-and-discard pattern itself.

## Open Questions

*Deferred to `/speckit.clarify` and `/speckit.plan` — recorded so refinement and planning address them. None are settled yet.*

- **OQ-1 — Definition of "most recent" uncited papers.** Is "recent" a time window, a since-year cutoff, or top-N by date? *(Shared with 007.)*
- **OQ-2 — Summarization provider contract.** What kind of provider is supported (which LLM/API), and its request/response shape and auth/credential format?
- **OQ-3 — "Too short / empty" threshold** that triggers the abstract fallback (FR-007).
- **OQ-4 — Recomputation.** If a paper later transitions uncited → cited (via refresh 005), or its abstract changes, is the summary/future-directions text regenerated, or kept as first generated? *(See 005 Open Questions.)*

## Out of Scope

- Collecting papers (002) and persisting the record/note pairing (003) are not covered here; this feature only generates text and hands it to 003 as managed content.
- Refreshing citation data (005) is separate; this feature only reads citation status to decide on future-directions text.
