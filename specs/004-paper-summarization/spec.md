# Feature Specification: Paper Summarization & Future-Directions Text

**Feature Branch**: `004-paper-summarization`

**Created**: 2026-07-04

**Status**: Implemented (2026-07-11)

**Input**: "Optionally add a summary to each paper note, and, for the most recent papers that nobody has cited yet, a description of possible future directions. A user can turn this off completely; with it off, paper notes are still created normally using the original abstract. The user chooses a summarization provider and supplies credentials in settings. Generated text is written into the same synchronized JSON record + Markdown note pairing used everywhere else."

## Clarifications

### Session 2026-07-04

- Q: This feature makes external calls to a summarization provider — is it on by default? → A: No. Per the project's commitment (and the 001 default `summarizationEnabled: false`), it is off until the user explicitly opts in and supplies credentials. With it off, no summarization call is ever made.
- Q: Where does generated summary / future-directions text live? → A: In the paper's canonical JSON record (as plugin-managed fields) and mirrored into the Markdown note's managed region, using the same synchronized pairing from 003. Generated text is plugin-managed content, never written into the user's free-form body.
- Q: Which papers get future-directions text versus only a summary? → A: A paper that nobody has cited yet (citation count of zero / no inbound citations) receives a future-directions description in addition to the summary; already-cited papers receive only the summary.

### Session 2026-07-07

- Q: Does the mandatory content-embedding baseline belong to this opt-in feature? → A: **No.** The baseline content embedding is a core, always-on capability owned by the collection pipeline (002 FR-019), not gated by this feature's opt-in. This feature only **optionally upgrades** the embedding to an LLM-provider embedding (Claude / Gemini / OpenAI) when the user configures a provider and credentials, alongside summary/future-directions text. Turning this feature off MUST leave the baseline embedding — and therefore the similarity layout (006/007) — fully working.
- Q: Are summarization and the embedding upgrade a single switch? → A: No — they are **independent toggles** sharing this feature's provider/credential surface where possible. A user may enable the LLM embedding upgrade without summaries, or summaries without the embedding upgrade.

### Session 2026-07-09

- Q: If a user enables the LLM embedding upgrade, does the "upgrade" wording mean the local baseline stays the layout's vector and the LLM one is merely cosmetic — or does the LLM vector become the one the graph actually uses? → A: The LLM vector becomes the **canonical** vector the layout uses. Enabling this feature's embedding upgrade makes the configured LLM `embeddingModel` the corpus's canonical embedding space (001 FR-022): 006 projects the LLM vectors, not the local baselines. The local baseline is retained only as an always-present fallback (so no paper lacks a vector and persistence is never blocked) — a paper whose LLM upgrade has not succeeded keeps its baseline, is marked pending upgrade, and is re-embedded to the canonical LLM space later (002 FR-020). Because the plugin is online during collection anyway, enabling LLM embeddings requires only an API key — the user never installs or registers a local model (001 FR-022). Turning this feature off returns the canonical space to the bundled local model and re-embeds accordingly; the similarity layout keeps working throughout.

### Session 2026-07-11

- Q: Does an invalid **LLM embedding** credential inform the user, the way an invalid **summarization** credential does (FR-008)? → A: **Not currently — deliberately deferred.** Per FR-012, an embedding failure (including a rejected credential) falls back silently to the retained local baseline and never blocks persistence; unlike the summarization path (FR-008), no user notice is raised. Surfacing an embedding-credential problem would require threading a notification callback through 002's embedding dispatcher (`src/collection/embeddingUpgrade.ts` → `reembed.ts`/`pipeline.ts`), which is outside this feature's own module footprint, so it is intentionally left out for now. Known asymmetry, tracked in `specs-test/004-paper-summarization/report.md` § Known residual limitations; revisit (and broaden FR-008 to the embedding path) if the silent fallback proves confusing in practice.

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
- If the feature is turned off while a generation is in flight, the in-flight result is discarded and the note is completed from the abstract; no other feature stops working because this one is off.
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
- **FR-008a**: If the summarization provider reports an API rate limit or quota exhaustion (HTTP 429 — e.g. an OpenAI/Anthropic rate limit, a Gemini free-tier `RESOURCE_EXHAUSTED`), the user MUST be informed that the limit was reached and that papers are being saved with the original abstract. The notice MUST be throttled (surfaced at most once per window) so a whole collection batch hitting the limit never spams one notice per paper. This is additive to FR-007: the abstract fallback still applies and persistence is never blocked.
- **FR-009**: Turning the feature off MUST prevent any further summarization calls, including discarding any in-flight generation.
- **FR-010**: The LLM API is one of three explicitly-selectable embedding providers (001 FR-022) — the other two being the bundled local baseline (default) and a user-supplied on-device local transformer (002). When the user **explicitly selects the LLM API** as the embedding provider and supplies credentials, this feature MUST make the configured LLM `embeddingModel` the corpus's canonical embedding space and generate an LLM content embedding to replace the paper's local baseline embedding (001 FR-019/FR-020), setting `embeddingSource = llm`; enabling this requires only an API key, never a local-model install. Merely having credentials on file does NOT make the LLM canonical — the explicit selection does. This is opt-in and strictly additive to the offline path: when a local provider (bundled baseline or local transformer) is selected instead, the similarity layout (006/007) still works with no LLM call. The local baseline is always retained as a fallback, and 006 projects only the canonical space's vectors.
- **FR-011**: The summarization toggle and the LLM-embedding toggle MUST be independent — enabling either MUST NOT require the other. Provider/credential selection MAY be shared across both.
- **FR-012**: An LLM embedding failure, timeout, or invalid credential MUST fall back to the retained local baseline embedding and MUST NOT block persistence — mirroring the abstract fallback for summaries (FR-007). Such a paper MUST be marked pending upgrade and re-embedded to the canonical LLM space later from the persisted store (002 FR-020); until then 006 gives it a fallback position rather than projecting its off-canonical baseline vector alongside canonical-space papers.
- **FR-013**: Before the user can enable this feature or the LLM embedding upgrade, the settings UI MUST disclose what data is sent to the configured provider (title and abstract only — never the full record, references, or any other paper's data) and that credentials are stored in plaintext (constitution Principle IV). This feature authors the disclosure copy; its placement in the settings screen is owned by 008.

### Key Entities

- **Paper Record (JSON)** / **Paper Note (Markdown)**: As defined in 003 (the logical Paper shape is 001); this feature adds summary and (conditionally) future-directions fields to the managed content via 003's synchronized pairing.
- **Summarization Settings**: The on/off flag (from 001) plus the chosen provider and credentials, which are extension fields (001 FR-016) defined by this feature and surfaced in the summarization section of the settings screen (008). Credentials are sensitive and handled per the project's transparent-use policy. This section also carries an **independent embedding-upgrade on/off flag** and (optionally distinct) embedding provider/credentials; the summarization and embedding toggles are independent (FR-011), broadening this feature's scope from "summary text" to "LLM-based paper enrichment (summary text + optional embedding upgrade)". The embedding provider is an **explicit single selector** (001 FR-022) with three options — bundled baseline (default, no config), a user-supplied **local transformer** (a file-path/URL field owned by 002, no credentials), or this feature's **LLM API** (an API-key field owned here). This feature owns only the LLM option's key; the bundled baseline needs no field and the local-transformer path/URL belongs to 002. Selecting a different provider changes the corpus's canonical embedding space and triggers re-embedding (001 FR-022 / 002 FR-020/FR-021).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With the feature off, 100% of new paper notes are still created and contain the abstract, with zero calls to any summarization provider.
- **SC-002**: With the feature on, uncited papers receive a future-directions description while already-cited papers receive only a summary.
- **SC-003**: Every generation failure results in an abstract fallback and a successfully saved paper — zero papers fail to save because summarization failed.
- **SC-004**: Generated text appears only in the plugin-managed region; zero user-written body content is altered by this feature.

## Assumptions

- Citation status ("uncited" = citation count 0) is derived from the paper's canonical record, populated by collection (002) or refresh (005). Its reliability depends on 002 enriching the paper before promotion; per 002 FR-016, when this feature is on, enrichment precedes promotion so a 0 is a confirmed count, not an un-enriched placeholder.
- This feature does not self-trigger: the collection pipeline (002) invokes it (when enabled) *before* a paper is persisted, and its generated text is handed to 003 as part of a single persist. It is the only place summarization calls are made, analogous to how 002 is the only place collection calls are made.
- "Recent" in User Story 2's framing is descriptive, not a separate gate: this feature has no time-window/recency filter of its own. The sole qualifying condition for future-directions text is a confirmed `citationCount === 0` (FR-004). Since 002's only discovery source is arXiv, an uncited paper reaching this feature is already recent by construction, so no additional cutoff is needed. A distinct recency *window* (e.g. for display/styling purposes), if ever needed, belongs to 007 — see OQ-1.

## Open Questions

*Raised during `/speckit.specify`; all six were resolved during Phase 0 planning (`/speckit.plan`) — see `research.md` for the full rationale behind each decision. Recorded here, with resolutions, for traceability.*

- **OQ-1 — Definition of "most recent" uncited papers.** Is "recent" a time window, a since-year cutoff, or top-N by date? *(Shared with 007.)* → **Resolved**: no separate recency gate; `citationCount === 0` is the sole criterion (see Assumptions, above, and `research.md` §3).
- **OQ-2 — Summarization provider contract.** What kind of provider is supported (which LLM/API), and its request/response shape and auth/credential format? → **Resolved**: a generic `SummarizationProvider`/`LlmEmbeddingProvider` interface, reference-implemented against OpenAI (`research.md` §4).
- **OQ-3 — "Too short / empty" threshold** that triggers the abstract fallback (FR-007). → **Resolved**: 20 characters, trimmed (`research.md` §5).
- **OQ-4 — Recomputation.** If a paper later transitions uncited → cited (via refresh 005), or its abstract changes, is the summary/future-directions text regenerated, or kept as first generated? *(See 005 Open Questions.)* → **Resolved**: no automatic regeneration; text generated once at initial persist is kept as-is (`research.md` §6).
- **OQ-5 — Embedding-provider contract.** Which of Claude / Gemini / OpenAI embedding endpoints are supported, their vector dimensions, and auth shape (may differ from the summarization/chat endpoint). → **Resolved**: OpenAI's Embeddings endpoint (`text-embedding-3-small`) for the reference implementation (`research.md` §4).
- **OQ-6 — Retain both embeddings or overwrite?** Keep both the local baseline and the LLM embedding per paper, or overwrite the baseline on upgrade? Affects re-projection when the provider is toggled (001 FR-020, 006). → **Resolved**: overwrite; `Paper` has exactly one embedding slot, already settled by the merged 001 schema, not a 004 decision (`research.md` §7).

## Out of Scope

- Collecting papers (002) and persisting the record/note pairing (003) are not covered here; this feature only generates text and hands it to 003 as managed content.
- Refreshing citation data (005) is separate; this feature only reads citation status to decide on future-directions text.
- **Per-provider model selection (future extension).** This feature lets the user select the summarization *provider* (OpenAI / Anthropic / Gemini, FR-006) but pins each provider to a single sensible default model (`gpt-4o-mini`, `claude-haiku-4-5`, `gemini-3-flash-preview`) chosen to be cheap, fast, and within the generation timeout. Letting the user also choose *which model within a provider* (e.g. gpt-4o vs gpt-4o-mini, gemini-flash vs -pro) is intentionally deferred. The `SummarizationProvider` interface keeps each model isolated as a single per-adapter constant, so adding a `summarizationModel` field and a settings dropdown later is additive; the natural home for such a selector is the 008 settings UI, and it would also need per-model parameter handling (e.g. `max_completion_tokens` and temperature constraints on reasoning models). Until then, changing a provider's model is a one-line constant edit.
