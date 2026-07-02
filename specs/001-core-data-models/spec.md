# Feature Specification: Core Data Structures

**Feature Branch**: `001-core-data-models`

**Created**: 2026-07-02

**Status**: Draft

**Input**: User description: "Define the shared data structures that every other feature in the plugin will build on. This feature does not display anything on screen by itself.

User wants subscription, paper, and settings data to have one fixed shape so every later feature can reference the same definitions. Subscriptions need a type (keyword/author/arXiv category), value, display label, check interval (one of 6/12/24/48/72 hours), last-checked time, and enabled flag. Papers need title, publication year, authors, citation count, abstract, and source identifier, with publication year required and never empty. Settings need default values for storage location, summarization enabled, and graph display options. Must establish what happens when a paper has no known publication year, and must reject check intervals outside the allowed list."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reference the subscription data shape (Priority: P1)

As a developer building the feature that lets a person track a keyword, author, or arXiv category, I want a single, fixed definition of what a subscription record contains, so that I can create, read, and check subscriptions without inventing or guessing fields that later turn out to be inconsistent with other features.

**Why this priority**: Subscriptions are the trigger for everything else the plugin does (checking for new papers). Every future feature that creates or reads subscriptions depends on this shape being fixed first.

**Independent Test**: Can be fully tested by constructing sample subscription records (valid and invalid) and confirming that every valid combination of type/value/label/interval/last-checked/enabled is accepted, and every record missing an attribute or using a disallowed check interval is identified as invalid — without needing any other feature to exist.

**Acceptance Scenarios**:

1. **Given** a new subscription is being defined, **When** it specifies a type of keyword, author, or arXiv category, a value, a display label, an allowed check interval, a last-checked time, and an enabled flag, **Then** the subscription is recognized as valid data.
2. **Given** a subscription is being defined, **When** its check interval is anything other than 6, 12, 24, 48, or 72 hours, **Then** the subscription is not accepted and its check interval is not changed.
3. **Given** a subscription is being defined, **When** one of the six required attributes is missing, **Then** the subscription is identified as invalid.

---

### User Story 2 - Reference the paper data shape (Priority: P2)

As a developer building the feature that collects and shows academic papers, I want a single, fixed definition of what a paper record contains — including the rule for what happens when a paper's publication year is unknown — so that I don't have to decide that rule myself or risk handling it differently from other features.

**Why this priority**: Papers are the core content of the plugin. Getting this shape and its one hard rule (publication year) settled before any collection or display feature is built prevents inconsistent handling of incomplete data across features.

**Independent Test**: Can be fully tested by constructing sample paper records (valid and invalid, including one with no publication year) and confirming that records with all six attributes and a known publication year are valid, while records missing a publication year are held back rather than treated as valid paper data.

**Acceptance Scenarios**:

1. **Given** a paper record is being defined, **When** it specifies a title, publication year, list of authors, citation count, abstract, and source identifier, **Then** the paper is recognized as valid data.
2. **Given** a paper record is being defined, **When** its publication year is unknown or empty, **Then** the paper is held back and is not treated as valid paper data until a publication year becomes known.
3. **Given** a paper record is being defined, **When** one of the six required attributes is missing entirely, **Then** the paper is identified as invalid.

---

### User Story 3 - Reference the settings data shape (Priority: P3)

As a developer building the settings UI or any feature that reads plugin-wide configuration, I want a single, fixed definition of what plugin settings contains and what its defaults are, so that the plugin always has a complete, predictable configuration even before a person changes anything.

**Why this priority**: Settings are read by many features but block none of them from being designed; they matter most once storage, summarization, and graph-display features exist, so they can follow subscription and paper definitions.

**Independent Test**: Can be fully tested by loading settings data with nothing configured yet and confirming a complete, valid default value exists for storage location, summarization enabled, and graph display options.

**Acceptance Scenarios**:

1. **Given** the plugin has never been configured, **When** its settings data is read, **Then** a default storage location, a default summarization-enabled value, and default graph display options are all present.
2. **Given** settings data is missing one of its three defined groups of values, **Then** the settings data is identified as invalid.

---

### Edge Cases

- What happens when a paper is collected without a known publication year? It is held back — not created as a valid paper record — rather than being permanently discarded, so it can be reconsidered later if a publication year becomes known.
- What happens when a check interval outside the allowed list (6, 12, 24, 48, or 72 hours) is attempted? The attempt is rejected and the subscription's check interval remains at its previous valid value (or its default, if newly created).
- What happens when a subscription type other than keyword, author, or arXiv category is attempted? The attempt is rejected in the same way as an invalid check interval.
- What happens when a subscription is created without an explicit check interval? It receives the default check interval defined by this specification (see Assumptions) rather than being left without one.
- What happens when settings data has not yet been saved (first run of the plugin)? The default values defined by this specification are used in full.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The subscription data definition MUST include a type attribute restricted to exactly one of: keyword, author, or arXiv category.
- **FR-002**: The subscription data definition MUST include a value attribute holding the specific keyword, author name, or arXiv category being tracked.
- **FR-003**: The subscription data definition MUST include a display label attribute, separate from the value, used to show the subscription to a person.
- **FR-004**: The subscription data definition MUST include a check interval attribute restricted to exactly one of: 6 hours, 12 hours, 24 hours, 48 hours, or 72 hours.
- **FR-005**: Any attempt to set a subscription's check interval to a value outside the five allowed options MUST be rejected, leaving the subscription's prior valid check interval unchanged.
- **FR-006**: The subscription data definition MUST include a last-checked attribute recording the most recent time the subscription was checked for new papers.
- **FR-007**: The subscription data definition MUST include an enabled attribute indicating whether the subscription is currently active.
- **FR-008**: The paper data definition MUST include title, publication year, a list of authors, citation count, abstract, and source identifier attributes.
- **FR-009**: Publication year MUST be treated as a required attribute of paper data that can never be empty for the paper to be considered valid.
- **FR-010**: A collected paper whose publication year is unknown MUST be held back from becoming a valid paper record, rather than being discarded outright, until a publication year becomes known.
- **FR-011**: The plugin settings data definition MUST include a default value for where collected data is stored.
- **FR-012**: The plugin settings data definition MUST include a default value for whether the summarization feature is enabled.
- **FR-013**: The plugin settings data definition MUST include default values for graph display options.
- **FR-014**: Subscription, paper, and settings data that is missing any of its respective required attributes MUST be identifiable as invalid.

### Key Entities

- **Subscription**: A tracked search criterion the plugin periodically checks for new papers. Attributes: type (keyword / author / arXiv category), value, display label, check interval (6/12/24/48/72 hours only), last-checked time, enabled flag.
- **Paper**: A single academic paper referenced by the plugin. Attributes: title, publication year (required, never empty), list of authors, citation count, abstract, source identifier. A paper without a known publication year is held back rather than becoming a valid record.
- **Plugin Settings**: Plugin-wide configuration, always resolving to a complete set of defaults. Attributes: default storage location, default summarization-enabled value, default graph display options.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every feature specified after this one can define its data needs by referencing only this specification's entity definitions, with zero follow-up questions about subscription, paper, or settings data shape.
- **SC-002**: 100% of subscription records missing any of its six defined attributes, or using a check interval outside the five allowed options, are identified as invalid.
- **SC-003**: 100% of paper records missing a publication year, or missing any of its six defined attributes, are identified as invalid.
- **SC-004**: 100% of newly loaded plugin settings resolve to a complete set of default values (storage location, summarization enabled, graph display options) with no missing group, even before a person changes anything.

## Assumptions

- The default check interval for a newly created subscription (when none is explicitly chosen) is 24 hours, the middle option of the five allowed values.
- The default storage location is a dedicated folder within the Obsidian vault; this specification only requires that a default value exists, not its exact path, since storage itself is out of scope here.
- Summarization is disabled by default, consistent with the project's existing commitment that features making outside calls stay off until a person opts in.
- Default graph display options are placeholder values (e.g., a standard layout and a neutral, non-implementation-specific display mode) that the future graph-display feature may refine; this specification only requires that some default exists and that the settings shape has a place for it.
- A paper's source identifier (e.g., where/how it was found) is assumed to always be available at the point a paper is collected, since collection itself is out of scope for this specification.
- A subscription's value and display label are always both present once a subscription is created, even when they are identical in content (e.g., a plain keyword used as its own label).
