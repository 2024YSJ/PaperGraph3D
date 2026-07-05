# Feature Specification: Core Data Structures

**Feature Branch**: `001-core-data-models`

**Created**: 2026-07-04

**Status**: Draft

**Input**: "Define the shared data structures that every other feature in the plugin will build on. This feature does not display anything on screen by itself. Subscription, paper, and settings data must have one fixed shape so every later feature references the same definitions. Subscriptions need a type (keyword/author/arXiv category), value, display label, check interval (one of 6/12/24/48/72 hours), last-checked time, and enabled flag. Papers need title, publication year, authors, citation count, abstract, and source identifier, with publication year required and never empty. Settings need default values for storage location, summarization enabled, and graph display options. Establish what happens when a paper has no known publication year, and reject check intervals outside the allowed list."

## Clarifications

### Session 2026-07-02

- Q: What should serve as a paper's stable unique identity for deduplication, and should the source identifier be structured to encode which provider issued it? → A: The source identifier MUST be globally unique per paper and MUST structurally encode its originating provider (e.g., `arxiv:2301.12345`), guaranteeing no collision between providers. Recognizing the same underlying paper across two different providers is out of scope for this specification.
- Q: Is the Subscription/Paper/Settings shape defined here a closed, fixed set of attributes, or an open baseline that later features may extend? → A: Open/extensible baseline — the attributes defined here are a required minimum; later features may add further attributes to these same entities (e.g., a read/unread flag, citation-relationship data) as long as they don't remove or redefine what's fixed here.
- Q: Should the default storage location resolve to a concrete, non-empty, usable path automatically, or remain empty/unset until a person configures it? → A: Concrete non-empty default — settings data always resolves to a real, usable folder path (e.g., a `PaperGraph3D/` folder within the vault) the moment the plugin loads, with no required setup before other features can write data.

### Session 2026-07-04

- Q: When a collected paper has no known publication year, what exactly is the scope of "held back"? → A: Only a *successful* provider response whose record genuinely lacks a year is "held back": the incomplete record is kept as the pre-validation shape and never becomes a valid paper until a year is present. A *failed* provider call is a separate concern (re-called by the collection feature), not this rule. The held-back record lives only in memory for the current collection pass and is NOT persisted here; re-evaluation is delegated to the next scheduled check. Where or whether a held-back record is persisted is out of scope (owned by 002).

### Session 2026-07-05

- Q: What counts as a valid publication year and citation count — are non-finite (NaN/Infinity) or negative values acceptable? → A: No. A valid publication year MUST be a finite number; a non-finite value (NaN or Infinity, e.g. produced by a failed numeric parse) is treated exactly like an unknown year — held back, never valid. A citation count MUST be a finite, non-negative number; a non-finite or negative citation count makes the paper invalid. These refine the "required, never empty" rule for year and add a range rule for citation count (reflected in `isValidPaper` and `toPaper`).
- Q: Publication year is the sole hold-back trigger, but a paper can also be promoted without its citation count/references ever being confirmed by a citation-aware provider (e.g. an arXiv-only paper, or one where enrichment failed). Once promoted, a defaulted `citationCount: 0` is indistinguishable from a confirmed zero unless something records the difference — should this distinction be preserved on the `Paper` shape itself, and does missing citation data ever justify a hold-back? → A: The distinction MUST be preserved, and it MUST NOT be a hold-back trigger. `Paper` carries a `citationsKnown` boolean: `true` when `citationCount`/`references` came from a citation-aware provider (a stored `0` then means "confirmed uncited"); `false` when the paper was promoted without that data (a stored `0` then means "unknown, not confirmed uncited"). Publication year remains the *only* condition that holds a candidate back from becoming a valid `Paper` — missing or unconfirmed citation data never does. This is what lets a windowed collection process (002) persist a paper immediately instead of losing it by holding it out of a search window that will not be revisited; the flag preserves the accuracy distinction that would otherwise be collapsed at promotion. Correcting a `false` flag later (enrichment, or manual refresh 005) is out of scope here — this specification fixes only the shape and the promotion-time rule.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reference the subscription data shape (Priority: P1)

As a developer building the feature that lets a person track a keyword, author, or arXiv category, I want a single, fixed definition of what a subscription record contains, so that I can create, read, and check subscriptions without inventing or guessing fields that later turn out to be inconsistent with other features.

**Why this priority**: Subscriptions are the trigger for everything else the plugin does. Every future feature that creates or reads subscriptions depends on this shape being fixed first.

**Independent Test**: Construct sample subscription records (valid and invalid) and confirm that every valid combination of type/value/label/interval/last-checked/enabled is accepted, and every record missing an attribute or using a disallowed check interval is identified as invalid — without needing any other feature to exist.

**Acceptance Scenarios**:

1. **Given** a new subscription is being defined, **When** it specifies a type of keyword, author, or arXiv category, a value, a display label, an allowed check interval, a last-checked time, and an enabled flag, **Then** the subscription is recognized as valid data.
2. **Given** a subscription is being defined, **When** its check interval is anything other than 6, 12, 24, 48, or 72 hours, **Then** the subscription is not accepted and its check interval is not changed.
3. **Given** a subscription is being defined, **When** one of the required attributes is missing, **Then** the subscription is identified as invalid.

---

### User Story 2 - Reference the paper data shape (Priority: P2)

As a developer building the feature that collects and shows academic papers, I want a single, fixed definition of what a paper record contains — including the rule for what happens when a paper's publication year is unknown — so that I don't have to decide that rule myself or risk handling it differently from other features.

**Why this priority**: Papers are the core content of the plugin. Getting this shape and its one hard rule (publication year) settled before any collection or display feature is built prevents inconsistent handling of incomplete data across features.

**Independent Test**: Construct sample paper records (valid and invalid, including one with no publication year) and confirm that records with all required attributes and a known publication year are valid, while records missing a publication year are held back rather than treated as valid paper data.

**Acceptance Scenarios**:

1. **Given** a paper record is being defined, **When** it specifies a title, publication year, list of authors, citation count, abstract, and source identifier, **Then** the paper is recognized as valid data.
2. **Given** a paper record is being defined, **When** its publication year is unknown or empty, **Then** the paper is held back and is not treated as valid paper data until a publication year becomes known.
3. **Given** a paper record is being defined, **When** one of the required attributes is missing entirely, **Then** the paper is identified as invalid.

---

### User Story 3 - Reference the settings data shape (Priority: P3)

As a developer building the settings UI or any feature that reads plugin-wide configuration, I want a single, fixed definition of what plugin settings contains and what its defaults are, so that the plugin always has a complete, predictable configuration even before a person changes anything.

**Why this priority**: Settings are read by many features but block none of them from being designed; they matter most once storage, summarization, and graph-display features exist.

**Independent Test**: Load settings data with nothing configured yet and confirm a complete, valid default value exists for storage location, summarization enabled, and graph display options.

**Acceptance Scenarios**:

1. **Given** the plugin has never been configured, **When** its settings data is read, **Then** a default storage location, a default summarization-enabled value, and default graph display options are all present.
2. **Given** settings data is missing one of its defined groups of values, **Then** the settings data is identified as invalid.

---

### Edge Cases

- What happens when a paper is collected without a known publication year? First distinguish two cases. If the *provider call failed*, that is not this feature's concern — the collection feature re-calls. If the *call succeeded* but the returned record genuinely has no publication year, the paper is held back — not created as a valid paper record — rather than being permanently discarded, so it can be reconsidered later if a publication year becomes known. "Held back" is scoped to the current in-memory collection pass; this feature persists nothing (see Clarifications, Session 2026-07-04).
- What happens when a paper's publication year is present but not a real number (NaN or Infinity, e.g. from a failed numeric parse)? It is treated exactly like an unknown year — held back, not created as a valid paper record — rather than slipping through as a valid year.
- What happens when a paper has a valid publication year but its citation count/references were never confirmed by a citation-aware provider (e.g. an arXiv-only paper, or a failed enrichment attempt)? It is still promoted to a valid paper record — publication year is the only hold-back trigger — with citation count defaulted to 0, references defaulted to an empty list, and `citationsKnown` set to `false` so this "unconfirmed zero" is never mistaken for a genuine zero. Correcting it later is out of scope here (see 002/005).
- What happens when a check interval outside the allowed list (6, 12, 24, 48, or 72 hours) is attempted? The attempt is rejected and the subscription's check interval remains at its previous valid value (or its default, if newly created).
- What happens when a subscription type other than keyword, author, or arXiv category is attempted? The attempt is rejected in the same way as an invalid check interval.
- What happens when a subscription is created without an explicit check interval? It receives the default check interval defined by this specification (see Assumptions).
- What happens when settings data has not yet been saved (first run of the plugin)? The default values defined by this specification are used in full.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The subscription data definition MUST include a type attribute restricted to exactly one of: keyword, author, or arXiv category.
- **FR-002**: The subscription data definition MUST include a value attribute holding the specific keyword, author name, or arXiv category being tracked.
- **FR-003**: The subscription data definition MUST include a display label attribute, separate from the value, used to show the subscription to a person.
- **FR-004**: The subscription data definition MUST include a check interval attribute restricted to exactly one of: 6 hours, 12 hours, 24 hours, 48 hours, or 72 hours.
- **FR-005**: Any attempt to set a subscription's check interval to a value outside the five allowed options MUST be rejected, leaving the subscription's prior valid check interval unchanged.
- **FR-006**: The subscription data definition MUST include a last-checked attribute recording the most recent time the subscription was checked for new papers. This attribute is what lets a later feature compute the window of time that elapsed while the plugin was not running (see 002).
- **FR-007**: The subscription data definition MUST include an enabled attribute indicating whether the subscription is currently active.
- **FR-008**: The paper data definition MUST include title, publication year, a list of authors, citation count, abstract, and source identifier attributes.
- **FR-009**: Publication year MUST be treated as a required attribute of paper data that can never be empty for the paper to be considered valid, and MUST be a finite number — a non-finite value (NaN or Infinity) is treated as unknown and held back, not valid.
- **FR-010**: A collected paper whose publication year is unknown MUST be held back from becoming a valid paper record, rather than being discarded outright, until a publication year becomes known.
- **FR-011**: The plugin settings data definition MUST include a default value for where collected data is stored, and that default MUST be a concrete, non-empty, immediately usable location — not an empty or unset value — so the plugin is usable right after installation with no required setup.
- **FR-012**: The plugin settings data definition MUST include a default value for whether the summarization feature is enabled.
- **FR-013**: The plugin settings data definition MUST include default values for graph display options.
- **FR-014**: Subscription, paper, and settings data that is missing any of its respective required attributes MUST be identifiable as invalid.
- **FR-015**: A paper's source identifier MUST be globally unique per paper and MUST structurally encode which external provider issued it (e.g., `arxiv:2301.12345`), so that identifiers from different providers can never collide. This specification does not require recognizing the same underlying paper when it is issued different identifiers by different providers.
- **FR-016**: Later features MAY add further attributes to the Subscription, Paper, or Settings entities defined here (for example, a read/unread flag or citation-relationship data) without needing those attributes to be defined by this specification, provided no attribute fixed here is removed or redefined.
- **FR-017**: Citation count MUST be a finite, non-negative number; a negative or non-finite citation count makes the paper invalid.
- **FR-018**: The paper data definition MUST include a `citationsKnown` boolean attribute, `true` when its citation count and references were supplied by a citation-aware provider and `false` when the paper was promoted without that data (citation count defaulted to 0, references defaulted to an empty list). Missing or unconfirmed citation data MUST NOT hold a paper back from becoming a valid record — publication year (FR-009/FR-010) remains the only hold-back trigger.

### Key Entities

*The attributes listed below are each entity's required minimum. Later features may extend these entities with additional attributes as needed (see FR-016), without requiring changes to this specification.*

- **Subscription**: A tracked search criterion the plugin periodically checks for new papers. Attributes: type (keyword / author / arXiv category), value, display label, check interval (6/12/24/48/72 hours only), last-checked time, enabled flag.
- **Paper**: The logical shape of a single academic paper. Attributes: title, publication year (required, never empty), list of authors, citation count, `citationsKnown` (whether that citation count/references are confirmed by a citation-aware provider, or defaulted because they were unavailable), abstract, source identifier (globally unique per paper, structurally encodes its originating provider, e.g. `arxiv:2301.12345`; serves as this paper's deduplication key), and outbound citation references. A paper without a known publication year is held back rather than becoming a valid record; missing citation data is not a hold-back reason and is instead recorded via `citationsKnown = false`. How a Paper is *stored* — as a synchronized JSON record + Markdown note — is defined by the persistence feature (003), not here.
- **Plugin Settings**: Plugin-wide configuration, always resolving to a complete set of defaults. Attributes: default storage location, default summarization-enabled value, default graph display options.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every feature specified after this one can define its data needs by referencing only this specification's entity definitions, with zero follow-up questions about subscription, paper, or settings data shape.
- **SC-002**: 100% of subscription records missing any of its defined attributes, or using a check interval outside the five allowed options, are identified as invalid.
- **SC-003**: 100% of paper records missing a publication year — or carrying a non-finite year, a negative/non-finite citation count, or a missing/non-boolean `citationsKnown` value — or missing any of its defined attributes, are identified as invalid.
- **SC-006**: 100% of promoted papers carry a `citationsKnown` value that accurately reflects whether their citation count/references came from a citation-aware provider, so a stored citation count of 0 is never mistaken for a confirmed zero when it is not.
- **SC-004**: 100% of newly loaded plugin settings resolve to a complete set of default values (storage location, summarization enabled, graph display options) with no missing group, even before a person changes anything.
- **SC-005**: 100% of paper records can be deduplicated using their source identifier alone, with zero possibility of two different papers issued by different providers sharing an identifier.

## Assumptions

- The default check interval for a newly created subscription (when none is explicitly chosen) is 24 hours, the middle option of the five allowed values.
- The default storage location is a dedicated, concrete, non-empty folder path within the Obsidian vault, resolved automatically with no setup required; this specification does not fix the exact folder name/path.
- Summarization is disabled by default, consistent with the project's commitment that features making outside calls stay off until a person opts in.
- Default graph display options are placeholder values that the future graph-display feature may refine; this specification only requires that some default exists and that the settings shape has a place for it.
- A paper's source identifier is assumed to always be available at the point a paper is collected, since collection itself is out of scope for this specification.
- A subscription's value and display label are always both present once a subscription is created, even when identical in content.

## Out of Scope

- Actually collecting papers, communicating with external providers, displaying anything on screen, or performing file I/O is not covered here. This feature covers definition only.
- How a Paper is persisted — in particular the synchronized JSON-record/Markdown-note representation the plugin operates on and the user edits — is owned by the note-persistence feature (003), not here. This feature defines only the logical Paper/Subscription/Settings shapes and their validators.
