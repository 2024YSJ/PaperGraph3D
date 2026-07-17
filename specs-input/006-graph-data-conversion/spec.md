# Feature Specification: Graph Data Conversion

**Feature Branch**: `006-graph-data-conversion`

**Created**: 2026-07-04

**Status**: Draft

**Input**: "Read the stored papers and convert them into graph data made of nodes and directional connections, ready to be drawn on screen. Because the plugin operates on JSON, conversion reads the canonical JSON records (not by parsing the Markdown note bodies). Each node has at least a title and publication year; papers without a publication year are excluded. Citation relationships become directional connections. This conversion draws nothing — it only produces a data structure."

## Clarifications

### Session 2026-07-04

- Q: Does conversion read the Markdown notes or the JSON records? → A: It reads the canonical JSON records (the plugin's source of truth, owned by 003; the logical Paper shape is from 001). It does not parse note bodies. This keeps the graph immune to a user's free-form edits and matches the rule that the plugin operates on its internal JSON record — the plugin's normalized store, not any provider's wire format (which only 002 ever sees).
- Q: How are citation directions determined? → A: Each record carries its outbound references (the papers it cites). A directional connection A→B is created when record A's references include B. Inbound "cited-by" is derived by inverting these connections; it is never stored.
- Q: What happens to a reference whose target paper is not stored in the vault? → A: The connection to a missing target is either ignored or handled separately (e.g., not drawn) rather than fabricating a node for it; conversion never fails because of a dangling reference.

### Session 2026-07-07

- Q: Does conversion compute node positions, or only produce abstract nodes/edges? → A: Conversion now also produces the **x,y layout** by projecting every node's content embedding (001 FR-019) into 2D, so content-similar papers are placed near each other. It does **not** project the year axis — publication year is carried on each node for 007 to map to the fixed year axis. This remains data production, not drawing (FR-007 still holds).
- Q: What projection, and how is it kept stable as papers accumulate? → A: The default is **PCA** (deterministic, with fixed sign-canonicalization so the layout never mirror-flips between runs). New papers are placed onto a **cached projection basis** (out-of-sample) instead of re-solving the whole layout each time; the basis is refit only on defined triggers. An optional higher-separation projection (UMAP) MAY be offered but is not the default. Only embeddings sharing one `embeddingModel` space (001 FR-020) may be projected together.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Produce nodes and connections for the display feature (Priority: P2)

As the developer building the on-screen display, I want to receive already-organized node and connection data instead of parsing vault files myself, so that I can focus purely on drawing.

**Why this priority**: The 3D view (007) cannot be built until it has a clean data structure to render; this feature is that structure's producer.

**Independent Test**: Provide a set of stored JSON records (some citing each other, one missing a publication year, one citing a non-stored paper) and confirm the output is a node list and a directional connection list matching the records, with the year-less paper excluded and the dangling reference not drawn.

**Acceptance Scenarios**:

1. **Given** stored paper records, **When** conversion runs, **Then** it produces a list of nodes, each with at least a title and publication year, read from the JSON records.
2. **Given** a stored record with no publication year, **When** conversion runs, **Then** that paper is excluded from the node list.
3. **Given** records where A cites B, **When** conversion runs, **Then** a directional connection from A to B exists.
4. **Given** a record citing a paper not stored in the vault, **When** conversion runs, **Then** the conversion does not fail and no fabricated node is created for the missing target.

---

### Edge Cases

- If a note records a citation to a paper that doesn't exist in the vault, that connection is ignored or handled separately, and conversion still succeeds.
- If a single record is malformed and required information can't be read, the whole conversion MUST NOT fail — that record is skipped and the rest are converted.
- If two records reference each other (a citation cycle), both directional connections are produced; conversion does not loop or fail.
- Nodes carry enough for the display feature to distinguish uncited papers (e.g., zero inbound connections), but this feature only produces data — it applies no visual styling.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: All stored paper records MUST be read from their canonical JSON form and converted into a list of nodes; the Markdown note bodies MUST NOT be parsed for this purpose.
- **FR-002**: Each node MUST include at least a title and publication year; a record without a publication year MUST be excluded from conversion.
- **FR-003**: Citation relationships MUST be represented as directional connections, showing which paper cites which, derived from each record's outbound references.
- **FR-004**: Inbound "cited-by" information, if needed by the display, MUST be derived by inverting the directional connections rather than stored separately.
- **FR-005**: A reference whose target paper is not stored MUST NOT cause conversion to fail; the dangling connection is ignored or handled separately.
- **FR-006**: A single malformed record MUST NOT fail the whole conversion; it is skipped and the remaining records are still converted.
- **FR-007**: This conversion MUST NOT draw anything on screen; it produces only a data structure (nodes + connections, and their computed x,y positions).
- **FR-008**: Conversion MUST compute a two-dimensional similarity layout (x,y) for every node by projecting the nodes' content embeddings (001 FR-019) into 2D, such that content-similar papers are positioned near one another. Only vectors in the corpus's single **canonical** embedding space (001 FR-022) are projected together; a node whose vector is in a non-canonical space (e.g., mid-re-embed after an embedding-provider switch) or is pending/absent is placed by FR-011's fallback rather than mixed into the projection. The publication-year axis MUST NOT be part of this projection; each node carries its publication year for 007 to place on the fixed year axis.
- **FR-009**: The default projection MUST be deterministic and reproducible — PCA with a fixed sign-canonicalization rule — so the same records yield the same layout across runs. Only embeddings in the corpus's single **canonical** `embeddingModel` space (001 FR-020/FR-022) may be projected together. The canonical space is fixed (001 FR-022): **768-dimensional** SPECTER2 vectors. PCA MUST still be fit over whatever dimensionality that space reports rather than a hard-coded 768, so a future model change stays a re-embed and not a rewrite; the projection output is always 2D. Papers still carrying the transitional bundled baseline (2048-d hashed TF, 002 FR-044) are **not** in the canonical space and MUST NOT be projected alongside SPECTER2 vectors — they are pending upgrade, and FR-011 governs what the graph does with them meanwhile. An optional non-linear "cluster mode" projection (e.g., UMAP) MAY be provided but MUST NOT be the default.
- **FR-010**: To keep the layout stable as the corpus grows, conversion MUST place new nodes onto a **cached projection basis** (out-of-sample) rather than re-solving the full projection each time. The basis MUST be refit only on defined triggers: corpus growth beyond a threshold, an explicit user "recompute layout" action, or an `embeddingModel`/space change. The basis is a regenerable plugin-managed cache (003 FR-016), never per-paper state.
- **FR-011**: A node whose embedding is pending or absent (001 FR-021), or whose vector is in a non-canonical space (an embeddingModel other than the corpus's current canonical one — e.g., a paper not yet re-embedded after a provider switch, 001 FR-022), MUST still be assigned a deterministic fallback position within its year plane and MUST NOT cause conversion to fail — consistent with the existing rule that one malformed record never fails the whole conversion (FR-006).

### Key Entities

- **Node**: A converted paper, carrying at least title and publication year (plus whatever the display needs, e.g., source identifier, citation status), read from a Paper's JSON record (persistence owned by 003), plus an (x,y) layout position derived from its content embedding via the similarity projection; its publication year is carried separately for the year axis.
- **Connection**: A directional edge A→B meaning paper A cites paper B, derived from A's outbound references.
- **Graph Data**: The (node list, connection list) — now including each node's computed (x,y) position — handed to the display feature. Transient output, not persisted as its own file; it references the regenerable projection basis (003 FR-016).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The number of converted nodes equals the number of stored paper records, minus records excluded for a missing publication year (and minus skipped malformed records).
- **SC-002**: A directional connection exists between exactly the paper pairs that have a citation relationship in the records.
- **SC-003**: Conversion completes successfully even when records contain dangling references or a malformed entry — zero total-conversion failures from a single bad record.
- **SC-004**: Conversion reads only JSON records; zero graph output depends on parsing a user's Markdown body.
- **SC-005**: Content-similar papers are placed measurably closer in (x,y) than dissimilar ones; the same records reproduce the same layout across runs (deterministic default).
- **SC-006**: Adding a new paper places it via the cached basis without moving existing nodes (no full re-solve) except on an explicit refit trigger.

## Assumptions

- Stored records expose their outbound references in the shape fixed by 001; this feature only inverts and assembles them, it does not fetch citation data (that is 002/005).
- The display feature (007) decides visual encoding; this feature only guarantees each node carries the data needed to compute those encodings (year, citation status).

## Open Questions

*Deferred to `/speckit.clarify` and `/speckit.plan` — recorded so refinement and planning address them. None are settled yet.*

- **OQ-1 — Empty references: "cites nothing" vs "not yet enriched".** Conversion cannot distinguish the two, so real citation edges may be silently missing until enrichment/refresh. Accept this, or require an "enriched" signal (002 OQ-5 / 003 OQ-1) so conversion can tell them apart?
- **OQ-2 — Reference scheme and edge matching.** Whether an edge connects depends on the reference `sourceId` scheme chosen in 002 (OQ-4): a reference whose scheme/prefix differs from stored papers' `sourceId`s becomes a dangling edge. The scheme must be confirmed so edges resolve.
- **OQ-3 — Refit trigger thresholds.** How much corpus growth forces a basis refit (e.g., ≥20% or ≥K new papers since last fit).
- **OQ-4 — UMAP mode and projection library.** Whether to ship the optional UMAP cluster mode in v1 (PCA-only first?), and the desktop-native projection library/approach (007 is desktop-only).

## Out of Scope

- Actual on-screen rendering and interaction are owned by 007. (Conversion now owns the x,y layout **data** — the projection — but 007 still owns rendering/interaction and the mapping of publication year to the depth axis.)
- Creating, modifying, or deleting record/note files is owned by 003; this feature is read-only over stored records.
- Fetching or refreshing citation data is owned by 002/005.
