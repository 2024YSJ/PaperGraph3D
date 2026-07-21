# Feature Specification: Core Data Structures

**Feature Branch**: `001-core-data-models`

**Created**: 2026-07-02

**Status**: Draft

**Input**: User description: "Define the shared data structures that every other feature in the plugin will build on. This feature does not display anything on screen by itself.

User wants subscription, paper, and settings data to have one fixed shape so every later feature can reference the same definitions. Subscriptions need a type (keyword/author/arXiv category), value, display label, check interval (one of 6/12/24/48/72 hours), last-checked time, and enabled flag. Papers need title, publication year, authors, citation count, abstract, and source identifier, with publication year required and never empty. Settings need default values for storage location, summarization enabled, and graph display options. Must establish what happens when a paper has no known publication year, and must reject check intervals outside the allowed list."

## Clarifications

### Session 2026-07-02

- Q: What should serve as a paper's stable unique identity for deduplication, and should the source identifier be structured to encode which provider issued it? → A: The source identifier MUST be globally unique per paper and MUST structurally encode its originating provider (e.g., `arxiv:2301.12345`), guaranteeing no collision between providers. Recognizing the same underlying paper across two different providers is out of scope for this specification.
- Q: Is the Subscription/Paper/Settings shape defined here a closed, fixed set of attributes, or an open baseline that later features may extend? → A: Open/extensible baseline — the attributes defined here are a required minimum; later features may add further attributes to these same entities (e.g., a read/unread flag, citation-relationship data) as long as they don't remove or redefine what's fixed here.
- Q: Should the default storage location resolve to a concrete, non-empty, usable path automatically, or remain empty/unset until a person configures it? → A: Concrete non-empty default — settings data always resolves to a real, usable folder path (e.g., a `PaperGraph3D/` folder within the vault) the moment the plugin loads, with no required setup before other features can write data.

### Session 2026-07-04

- Q: When a collected paper has no known publication year, what exactly is the scope of "held back" — is it persisted for later retry, and how does it differ from an API call that fails outright? → A: These are two distinct cases handled at different layers, and only the second is this spec's concern. (1) An API call that fails or returns an incomplete/absent response (network error, rate limit, server error) is NOT covered here — the correct response is to re-call, which is the collection feature's retry concern. (2) A call that *succeeds* but whose returned record genuinely lacks a publication year is what "held back" means: the incomplete record is kept as the pre-validation shape and does not become a valid paper. Re-calling the same provider would deterministically return the same missing year, so retry is not a same-call re-fetch — the year is expected to arrive later from a different path (e.g., a preprint that is later published, a second provider, or a metadata-enrichment pass). This spec fixes only (a) the pre-validation shape that carries the year as optional and (b) the single validation gate that converts it to a valid paper once a year is present. The held-back record lives only in memory for the current collection pass and is NOT persisted by this feature; re-evaluation is delegated to the next scheduled subscription check (which re-fetches and re-runs the gate). Where or whether a held-back record is persisted or queued for retry is out of scope, owned by the collection feature (002).

### Session 2026-07-05

- Q: What counts as a valid publication year and citation count — are non-finite (NaN/Infinity) or negative values acceptable? → A: No. A valid publication year MUST be a finite number; a non-finite value (NaN or Infinity, e.g. produced by a failed numeric parse) is treated exactly like an unknown year — held back, never valid. A citation count MUST be a finite, non-negative number; a non-finite or negative citation count makes the paper invalid. These refine the "required, never empty" rule for year and add a range rule for citation count (reflected in `isValidPaper` and `toPaper`).
- Q: Publication year is the sole hold-back trigger, but a paper can also be promoted without its citation count/references ever being confirmed by a citation-aware provider (e.g. an arXiv-only paper, or one where enrichment failed). Once promoted, a defaulted `citationCount: 0` is indistinguishable from a confirmed zero unless something records the difference — should this distinction be preserved on the `Paper` shape itself, and does missing citation data ever justify a hold-back? → A: The distinction MUST be preserved, and it MUST NOT be a hold-back trigger. `Paper` carries a `citationsKnown` boolean: `true` when `citationCount`/`references` came from a citation-aware provider (a stored `0` then means "confirmed uncited"); `false` when the paper was promoted without that data (a stored `0` then means "unknown, not confirmed uncited"). Publication year remains the *only* condition that holds a candidate back from becoming a valid `Paper` — missing or unconfirmed citation data never does. This is what lets a windowed collection process (002) persist a paper immediately instead of losing it by holding it out of a search window that will not be revisited; the flag preserves the accuracy distinction that would otherwise be collapsed at promotion. Correcting a `false` flag later (enrichment, or manual refresh 005) is out of scope here — this specification fixes only the shape and the promotion-time rule.

### Session 2026-07-07

- Q: Is a paper's content embedding an optional extension (FR-016) or part of the core Paper shape? → A: Core. Every valid `Paper` carries a content embedding — a fixed-length, L2-normalized numeric vector derived from the paper's title + abstract. It is not an FR-016 add-on; it is a required attribute of the normalized shape. It is never a hold-back trigger: because a valid paper always has a title (FR-014), a baseline embedding is always locally computable, so publication year (FR-009/FR-010) remains the sole condition that holds a candidate back. The similarity-based graph layout (260702-006/260702-007) consumes this embedding.
- Q: Embeddings may come from a local model or an LLM API (Claude / Gemini / OpenAI), which are different vector spaces — how is that kept coherent? → A: Each `Paper` records the `embeddingModel` (identifier + version) and `embeddingSource` (`local` | `llm`) that produced its vector. Any comparison or projection (260702-006) MUST only be performed among papers sharing the same `embeddingModel` space; mixing spaces is invalid. Changing the embedding provider requires re-embedding affected papers, owned by 260702-002. **[Superseded 2026-07-16]** The selector is retired: the canonical space is one fixed on-device model (SPECTER2), never user-selectable, and `embeddingSource` is always `local`. The reasoning here — that mixing spaces is invalid — is exactly why: a selectable provider is a selectable dimensionality. See the amended FR-022 and constitution v1.3.0.

### Session 2026-07-09

- Q: Collection is always online (it calls arXiv), so must the user register a local embedding model, or can an LLM API key alone drive embeddings — and if a corpus ends up with a mix of local and LLM vectors, how is a single coherent layout preserved? → A: The local baseline model is **bundled** with the plugin and is never installed or registered by the user; enabling LLM-provider embeddings requires only supplying an API key. At any moment the corpus has exactly one **canonical embedding space** — the configured provider's `embeddingModel` (the bundled local model by default, or the configured LLM model). Local and LLM vectors are *never* mixed in one projection (they are different spaces — FR-020); instead the corpus converges to the single canonical space. The local baseline vector is always attached at promotion as an immediate fallback so no paper is ever persisted without a vector, but when an LLM space is canonical a paper still carrying only its local vector is treated as **pending upgrade** and re-embedded; off-canonical / pending papers receive a deterministic fallback position (260702-006) and are not projected together with canonical-space papers until re-embedded. Switching the embedding provider re-embeds the corpus from the persisted papers to the new canonical space (owned by 260702-002), never by rescanning collection. Offline *viewing* is unaffected regardless of provider, because every vector — local or LLM — is persisted (260702-003).

### Session 2026-07-09 (continued)

- Q: The offline embedding option is now a real transformer model the user supplies by file path or URL (not only the bundled baseline), so there are three ways to produce embeddings — bundled baseline, user-supplied local transformer, and LLM API. When more than one is configured, which is canonical? → A: The canonical provider is chosen by an **explicit single selector**, not by implicit precedence. The three mutually exclusive options are: (1) the **bundled local baseline** (default, zero setup); (2) a **user-supplied local transformer** (a local file path or URL to a transformer model, run on-device via the plugin's bundled inference runtime — no credentials, no data leaves the vault); (3) a **configured LLM API** (API key only, sends only title+abstract per 260702-004's data-minimization contract). Exactly one selected provider's `embeddingModel` is canonical at a time (this extends the two-way "bundled-or-LLM" wording of the earlier 2026-07-09 clarification to three explicit choices). The bundled baseline is ALWAYS also computed as the immediate fallback so no paper is ever persisted without a vector, regardless of the selection. Both the bundled baseline and a user-supplied local transformer record `embeddingSource = local` (distinguished by `embeddingModel`); only the LLM API records `llm`. Changing the selection re-embeds the corpus to the newly-selected canonical space (owned by 260702-002); selecting a different local transformer model is likewise a provider change (its `embeddingModel` differs) and triggers re-embedding. See FR-022. **[Superseded 2026-07-16]** The selector is retired: the canonical space is one fixed on-device model (SPECTER2), never user-selectable, and `embeddingSource` is always `local`. The reasoning here — that mixing spaces is invalid — is exactly why: a selectable provider is a selectable dimensionality. See the amended FR-022 and constitution v1.3.0.
- Q: `publicationYear` is a bare year integer, but providers (arXiv's `<published>`) give a full timestamp, and downstream features want month/day precision (note display, date sorting/filtering, month-level folders). Should the Paper shape carry finer precision? → A: Yes — add an **optional `publicationDate`** (ISO `YYYY-MM-DD`, UTC) as an **additive FR-016 extension** (FR-023), populated from the provider's full date when available and `undefined` when only a year is known. `publicationYear` is deliberately **kept unchanged** — it stays the required attribute, the sole hold-back trigger, and the graph z-axis / 005-window key; `publicationDate` only adds finer precision for consumers that want it, and never gates validity. (Session 2026-07-11.)

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

- What happens when a paper is collected without a known publication year? First distinguish two cases. If the *API call failed* (no response, or an incomplete response due to a network/rate-limit/server error), that is not this feature's concern — the collection feature simply re-calls. If the *call succeeded* but the returned record genuinely has no publication year, the paper is held back — not created as a valid paper record — rather than being permanently discarded, so it can be reconsidered later if a publication year becomes known. "Held back" here is scoped to the current collection pass in memory: the incomplete record is not persisted by this feature, and re-evaluation happens on the next scheduled subscription check (which re-fetches and re-runs the validation gate). Re-calling the same provider immediately would return the same missing year, so retry is deliberately deferred to a later pass where the year may arrive from a different path (see Clarifications, Session 2026-07-04).
- What happens when a paper's publication year is present but not a real number (NaN or Infinity, e.g. from a failed numeric parse)? It is treated exactly like an unknown year — held back, not created as a valid paper record — rather than slipping through as a valid year.
- What happens when a paper has a valid publication year but its citation count/references were never confirmed by a citation-aware provider (e.g. an arXiv-only paper, or a failed enrichment attempt)? It is still promoted to a valid paper record — publication year is the only hold-back trigger — with citation count defaulted to 0, references defaulted to an empty list, and `citationsKnown` set to `false` so this "unconfirmed zero" is never mistaken for a genuine zero. Correcting it later is out of scope here (see 002/005).
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
- **FR-009**: Publication year MUST be treated as a required attribute of paper data that can never be empty for the paper to be considered valid, and MUST be a finite number — a non-finite value (NaN or Infinity) is treated as unknown and held back, not valid.
- **FR-010**: A collected paper whose publication year is unknown MUST be held back from becoming a valid paper record, rather than being discarded outright, until a publication year becomes known.
- **FR-011**: The plugin settings data definition MUST include a default value for where collected data is stored, and that default MUST be a concrete, non-empty, immediately usable location — not an empty or unset value — so the plugin is usable right after installation with no required setup.
- **FR-012**: The plugin settings data definition MUST include a default value for whether the summarization feature is enabled.
- **FR-013**: The plugin settings data definition MUST include default values for graph display options.
- **FR-014**: Subscription, paper, and settings data that is missing any of its respective required attributes MUST be identifiable as invalid.
- **FR-015**: A paper's source identifier MUST be globally unique per paper and MUST structurally encode which external provider issued it (e.g., a provider-prefixed value such as `arxiv:2301.12345`), so that identifiers from different providers can never collide. This specification does not require recognizing the same underlying paper when it is issued different identifiers by different providers.
- **FR-016**: Later features MAY add further attributes to the Subscription, Paper, or Settings entities defined here (for example, a read/unread flag or citation-relationship data) without needing those attributes to be defined by this specification, provided no attribute fixed here is removed or redefined.
- **FR-017**: Citation count MUST be a finite, non-negative number; a negative or non-finite citation count makes the paper invalid.
- **FR-018**: The paper data definition MUST include a `citationsKnown` boolean attribute, `true` when its citation count and references were supplied by a citation-aware provider and `false` when the paper was promoted without that data (citation count defaulted to 0, references defaulted to an empty list). Missing or unconfirmed citation data MUST NOT hold a paper back from becoming a valid record — publication year (FR-009/FR-010) remains the only hold-back trigger.
- **FR-019**: The Paper data definition MUST include a **content embedding**: a fixed-length, L2-normalized numeric vector derived from the paper's title and abstract. This is a required core attribute of the Paper shape (not an FR-016 extension). A paper whose abstract is empty is still embedded from its title alone.
- **FR-020**: The Paper data definition MUST include `embeddingModel` (a stable model identifier + version, **including the vector's dimensionality**) and `embeddingSource` (`local` — the only value; every embedding is produced on-device, and the bundled baseline is distinguished from the canonical model by `embeddingModel`). Embeddings MUST only be compared or jointly projected among papers sharing the one **canonical** `embeddingModel` space (FR-022).
- **FR-021**: A missing or transiently-failed embedding MUST NOT invalidate a paper or hold it back — publication year (FR-009/FR-010) remains the only hold-back trigger. Such a paper is still promoted and persisted with its embedding marked pending (via `embeddingSource`/metadata) and is re-embedded later into the corpus's current canonical space (FR-022), mirroring the `citationsKnown` treatment of unconfirmed citation data (FR-018).
- **FR-022**: The canonical embedding space MUST be produced by **exactly one fixed on-device model**, chosen by the plugin and **not user-selectable**. This is a constraint derived from FR-020, not a preference: only vectors sharing one `embeddingModel` space may be projected together, so a user-chosen provider is a user-chosen dimensionality and no corpus survives the choice. A single canonical `embeddingModel` id — dimensionality included — makes a mixed-dimensionality corpus unrepresentable rather than merely discouraged. Embedding MUST require no credentials and MUST NOT send paper data anywhere. The **bundled local baseline** MUST be bundled with the plugin, require no setup, and MUST ALWAYS be computed as an immediate fallback at promotion, so no paper is ever persisted without a vector; a paper carrying only the baseline vector MUST be marked pending upgrade and re-embedded once the canonical model is available. Because the canonical model's weights are too large to bundle, they MUST be obtained once by an **explicit user action** and stored locally; every embedding afterwards is offline (see 260702-002 FR-046). Re-embedding MUST run from the persisted papers, never by rescanning collection (owned by 260702-002). Vectors from different `embeddingModel` spaces MUST NOT be mixed within a single projection.
- **FR-023**: The Paper data definition MAY include an optional **`publicationDate`** — the paper's month/day-precision publication date as an ISO `YYYY-MM-DD` (UTC) string — when a provider supplies a full timestamp (e.g. arXiv's `<published>`); it is absent (`undefined`) when only a bare year is known. This is an **additive FR-016 extension**, not a redefinition of `publicationYear`: `publicationYear` remains the required attribute (FR-008) and the sole hold-back trigger (FR-009/FR-010), and stays the graph z-axis / windowing key. `publicationDate`, when present, MUST be consistent with `publicationYear` (its year equals `publicationYear`). A missing or unparseable date MUST NOT hold a paper back or invalidate it — only a missing/invalid `publicationYear` does. Consumers that need finer-than-year precision (note display, date sorting/filtering, month-level foldering) read `publicationDate`; those that need only the year continue to read `publicationYear`.

### Key Entities

*The attributes listed below are each entity's required minimum. Later features may extend these entities with additional attributes as needed (see FR-016), without requiring changes to this specification.*

- **Subscription**: A tracked search criterion the plugin periodically checks for new papers. Attributes: type (keyword / author / arXiv category), value, display label, check interval (6/12/24/48/72 hours only), last-checked time, enabled flag.
- **Paper**: A single academic paper referenced by the plugin. Attributes: title, publication year (required, never empty), list of authors, citation count, `citationsKnown` (whether that citation count/references are confirmed by a citation-aware provider, or defaulted because they were unavailable), abstract, source identifier (globally unique per paper, structurally encodes its originating provider, e.g. `arxiv:2301.12345`; serves as this paper's deduplication key). A paper without a known publication year is held back rather than becoming a valid record; missing citation data is not a hold-back reason and is instead recorded via `citationsKnown = false`. Every valid Paper also carries a **content embedding** (a fixed-length, L2-normalized vector over title + abstract) plus its `embeddingModel`/`embeddingSource` metadata; a missing embedding is not a hold-back reason and is recorded as pending, analogous to `citationsKnown`.
- **Plugin Settings**: Plugin-wide configuration, always resolving to a complete set of defaults. Attributes: default storage location, default summarization-enabled value, default graph display options.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every feature specified after this one can define its data needs by referencing only this specification's entity definitions, with zero follow-up questions about subscription, paper, or settings data shape.
- **SC-002**: 100% of subscription records missing any of its six defined attributes, or using a check interval outside the five allowed options, are identified as invalid.
- **SC-003**: 100% of paper records missing a publication year — or carrying a non-finite year, a negative/non-finite citation count, or a missing/non-boolean `citationsKnown` value — or missing any of its defined attributes, are identified as invalid.
- **SC-004**: 100% of newly loaded plugin settings resolve to a complete set of default values (storage location, summarization enabled, graph display options) with no missing group, even before a person changes anything.
- **SC-005**: 100% of paper records can be deduplicated using their source identifier alone, with zero possibility of two different papers issued by different providers sharing an identifier.
- **SC-006**: 100% of promoted papers carry a `citationsKnown` value that accurately reflects whether their citation count/references came from a citation-aware provider, so a stored citation count of 0 is never mistaken for a confirmed zero when it is not.
- **SC-007**: 100% of valid papers carry a content embedding and an accurate `embeddingModel`/`embeddingSource`, so no two papers from different model spaces are ever projected together; only the single canonical space's vectors are projected, and papers still on the bundled baseline are re-embedded into it rather than mixed with it (FR-022).

## Assumptions

- The default check interval for a newly created subscription (when none is explicitly chosen) is 24 hours, the middle option of the five allowed values.
- The default storage location is a dedicated, concrete, non-empty folder path within the Obsidian vault, resolved automatically with no setup required; this specification does not fix the exact folder name/path, since storage itself is out of scope here.
- Summarization is disabled by default, consistent with the project's existing commitment that features making outside calls stay off until a person opts in.
- Default graph display options are placeholder values (e.g., a standard layout and a neutral, non-implementation-specific display mode) that the future graph-display feature may refine; this specification only requires that some default exists and that the settings shape has a place for it.
- A paper's source identifier (e.g., where/how it was found) is assumed to always be available at the point a paper is collected, since collection itself is out of scope for this specification.
- A subscription's value and display label are always both present once a subscription is created, even when they are identical in content (e.g., a plain keyword used as its own label).
