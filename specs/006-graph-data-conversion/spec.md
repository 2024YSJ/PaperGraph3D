# Feature Specification: Graph Data Conversion

**Feature Branch**: `006-graph-data-conversion`

**Created**: 2026-07-15

**Status**: Draft

**Input**: User description: "Read the stored papers and convert them into graph data made of nodes and directional connections, ready to be drawn on screen. Conversion reads the canonical JSON records (not the Markdown note bodies). Each node has at least a title and publication year; papers without a publication year are excluded. Citation relationships become directional connections. Conversion also computes a 2D (x,y) similarity layout by projecting each node's content embedding, carrying publication year separately for the year axis. This conversion draws nothing — it only produces a data structure. It is read-only over the persisted records."

## Clarifications

### Session 2026-07-04

- Q: Does conversion read the Markdown notes or the JSON records? → A: It reads the canonical JSON records (the plugin's source of truth, owned by 003; the logical Paper shape is from 001). It does not parse note bodies. This keeps the graph immune to a user's free-form edits and matches the rule that the plugin operates on its internal JSON record — the plugin's normalized store, not any provider's wire format (which only 002 ever sees).
- Q: How are citation directions determined? → A: Each record carries its outbound references (the papers it cites). A directional connection A→B is created when record A's references include B. Inbound "cited-by" is derived by inverting these connections; it is never stored.
- Q: What happens to a reference whose target paper is not stored in the vault? → A: The connection to a missing target is either ignored or handled separately (not drawn) rather than fabricating a node for it; conversion never fails because of a dangling reference.

### Session 2026-07-07

- Q: Does conversion compute node positions, or only produce abstract nodes/edges? → A: Conversion now also produces the **x,y layout** by projecting every node's content embedding into 2D, so content-similar papers are placed near each other. It does **not** project the year axis — publication year is carried on each node for 007 to map to the fixed year axis. This remains data production, not drawing (FR-007 still holds).
- Q: What projection, and how is it kept stable as papers accumulate? → A: The default is **PCA** (deterministic, with fixed sign-canonicalization so the layout never mirror-flips between runs). New papers are placed onto a **cached projection basis** (out-of-sample) instead of re-solving the whole layout each time; the basis is refit only on defined triggers. An optional higher-separation projection (UMAP) MAY be offered but is not the default. Only embeddings sharing one `embeddingModel` space may be projected together. *(Superseded 2026-07-20 by OQ-4: UMAP is deferred to future work — v1 is PCA-only.)*

### Session 2026-07-20

- Q: The draft assumed a three-way embedding-provider selector (bundled / local-transformer / LLM), with per-provider dimensionality and "provider-switch" re-embedding. Is that still the model? → A: **No — reconciled against `develop`.** The project moved to a **single fixed on-device embedding model, SPECTER2** (`specter2-proximity-onnx`; constitution v1.3.0). There is no provider switch and no per-provider dimensionality. The canonical embedding space is SPECTER2's; a paper is either canonical (SPECTER2-embedded) or not-yet-canonical (still on the bundled hashed-TF baseline, or pending because the ~108 MB SPECTER2 model isn't downloaded or hasn't embedded it yet). The not-yet-canonical case takes FR-011's fallback position. FR-008/009/010/011 are reworded accordingly; the core (nodes, edges, deterministic PCA layout, fallback for pending/non-canonical) is unchanged.
- Q: How does a citation edge resolve between a reference and a stored paper? → A: **Exact `PaperSourceId` string equality.** An edge A→B exists iff A's reference string equals B's `sourceId`; a reference in a non-matching scheme or not in the corpus is a dangling edge and is dropped (FR-005). No cross-scheme normalization in v1. Rationale: 002 collects arXiv-only, and `toPaperSourceId` already stores any arXiv-resolvable reference as `arxiv:<id>`, so exact matching connects every edge that *could* connect — a `semanticScholar:<id>` reference is by definition a non-arXiv paper that cannot be a node anyway.
- Q: If an embedding is empty/pending, does conversion re-embed it? → A: **No — conversion never re-embeds.** Bringing pending/baseline papers into the canonical SPECTER2 space is 002's background re-embed (`reembed.ts`, kicked off on load); conversion is read-only over 003 and does not wait for it. A pending/non-canonical node takes FR-011's fallback position now, and a later conversion run — after re-embed has converged it — projects it into the layout, so the graph is eventually consistent. (This is the empty-*embedding* case, distinct from OQ-1's empty-*references*/edge case.)
- Q: When a paper's references are empty ("cites nothing" vs "not yet enriched"), how does conversion handle it? → A: **Build edges only from references actually present** (empty → no edges); conversion does not distinguish the two cases for edge-building. Each node carries the existing `citationsKnown` flag, so 007 can distinguish "confirmed no citations" (`citationsKnown: true`) from "not yet enriched" (`false`). No new "enriched" signal is invented — an un-enriched paper gains its edges automatically once 002/005 enriches it and conversion re-runs (edges are eventually consistent, the same pattern as embeddings).
- Q: Where does the shared `isUncited` helper live, so 006/007 use it without importing from 004? → A: **Relocate it to a neutral core module (`src/models/`, alongside the Paper type whose `citationCount`/`citationsKnown` fields it reads).** 004/006/007 all import the one helper; no feature owns it. Implementation is a small refactor (move `isUncited.ts`, update 004's import). Satisfies the locked "one shared uncited helper" rule.
- Q: What corpus growth triggers a basis refit? → A: **≥20% growth since the last fit AND at least 25 new papers** — a relative threshold with a small absolute floor so a tiny corpus does not refit constantly. Exact numbers are tunable in planning; the other refit triggers (explicit "recompute layout" action, canonical-model change) are unchanged.
- Q: Ship UMAP in v1, and what computes the projection? → A: **PCA-only in v1, computed in-process** (a light deterministic linear-algebra routine — SVD/eigendecomposition — no heavy external projection/ML library). UMAP "cluster mode" is **deferred to future work**: it is stochastic (fights FR-009's determinism), has no linear basis for stable out-of-sample placement (fights FR-010/SC-006), and adds bundle weight. It stays cleanly addable later behind the optional-mode flag with no rework.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Produce nodes and connections for the display feature (Priority: P1)

As the developer building the on-screen 3D display (007), I want to receive already-organized node and connection data — including each node's computed (x,y) position — instead of parsing vault files myself, so that I can focus purely on drawing.

**Why this priority**: The 3D view (007) cannot be built until it has a clean data structure to render; this feature is that structure's producer. It is the single dependency gate between the persisted corpus (003) and the visualization (007).

**Independent Test**: Provide a set of stored JSON records (some citing each other, one missing a publication year, one citing a non-stored paper) and confirm the output is a node list and a directional connection list matching the records, with the year-less paper excluded and the dangling reference not drawn.

**Acceptance Scenarios**:

1. **Given** stored paper records, **When** conversion runs, **Then** it produces a list of nodes, each with at least a title and publication year, read from the JSON records (never from the Markdown note body).
2. **Given** a stored record with no publication year, **When** conversion runs, **Then** that paper is excluded from the node list.
3. **Given** records where A cites B, **When** conversion runs, **Then** a directional connection from A to B exists.
4. **Given** a record citing a paper not stored in the vault, **When** conversion runs, **Then** the conversion does not fail and no fabricated node is created for the missing target.

---

### User Story 2 - Compute a stable content-similarity layout (Priority: P2)

As the developer building the display, I want each node to arrive with an (x,y) position such that content-similar papers sit near each other and the layout does not reshuffle every time a paper is added, so the view is legible and stable across sessions.

**Why this priority**: The graph is viable (renderable) with nodes and edges alone (P1), but the similarity layout is what makes the 3D view meaningful rather than arbitrary. It builds on P1's node list.

**Independent Test**: Convert the same set of records twice and confirm identical (x,y) positions (deterministic default); add one new record and confirm existing nodes keep their positions (out-of-sample placement, no full re-solve) until a refit trigger fires.

**Acceptance Scenarios**:

1. **Given** a set of records with canonical-space embeddings, **When** conversion runs twice, **Then** every node receives the same (x,y) position both times (no mirror-flip, no reshuffle).
2. **Given** an existing converted corpus, **When** one new paper is added and conversion re-runs below the refit threshold, **Then** existing nodes keep their positions and the new node is placed onto the cached basis.
3. **Given** a node whose embedding is pending, absent, or in a non-canonical space, **When** conversion runs, **Then** the node still receives a deterministic fallback position and conversion does not fail.

---

### Edge Cases

- If a record cites a paper that doesn't exist in the vault, that connection is ignored or handled separately, and conversion still succeeds.
- If a single record is malformed and required information can't be read, the whole conversion MUST NOT fail — that record is skipped and the rest are converted.
- If two records reference each other (a citation cycle), both directional connections are produced; conversion does not loop or fail.
- Nodes carry the shared uncited signal (FR-012, `citationsKnown && citationCount === 0`) so the display can distinguish uncited papers. This is the paper's **global** citation status and is distinct from a node's **in-graph inbound-edge count** — a paper can be globally cited yet have zero inbound edges because its citers aren't in the corpus, so 007 must use the uncited flag, not inbound degree, to mark "uncited." This feature only produces the data; it applies no visual styling.
- If the corpus is empty, conversion produces an empty node list and empty connection list without error.
- If every embedding is pending/absent (e.g., brand-new corpus mid-embed), every node gets a fallback position and conversion still succeeds.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: All stored paper records MUST be read from their canonical JSON form and converted into a list of nodes; the Markdown note bodies MUST NOT be parsed for this purpose.
- **FR-002**: Each node MUST include at least a title and publication year; a record without a publication year MUST be excluded from conversion.
- **FR-003**: Citation relationships MUST be represented as directional connections, showing which paper cites which, derived from each record's outbound references.
- **FR-004**: Inbound "cited-by" information, if needed by the display, MUST be derived by inverting the directional connections rather than stored separately.
- **FR-005**: A reference whose target paper is not stored MUST NOT cause conversion to fail; the dangling connection is ignored or handled separately (no fabricated node).
- **FR-006**: A single malformed record MUST NOT fail the whole conversion; it is skipped and the remaining records are still converted.
- **FR-007**: This conversion MUST NOT draw anything on screen; it produces only a data structure (nodes + connections, and their computed x,y positions).
- **FR-008**: Conversion MUST compute a two-dimensional similarity layout (x,y) for every node by projecting the nodes' content embeddings into 2D, such that content-similar papers are positioned near one another. Only vectors in the corpus's single **canonical** embedding space — the fixed on-device SPECTER2 model — are projected together; a node whose vector is not yet in that canonical space (still on the bundled baseline because SPECTER2 has not embedded it yet) or is pending/absent is placed by FR-011's fallback rather than mixed into the projection. The publication-year axis MUST NOT be part of this projection; each node carries its publication year for 007 to place on the fixed year axis.
- **FR-009**: The default projection MUST be deterministic and reproducible — PCA with a fixed sign-canonicalization rule — so the same records yield the same layout across runs. Only embeddings in the corpus's single canonical `embeddingModel` space (the fixed SPECTER2 model) may be projected together; that space has a fixed input dimensionality, and the projection output is always 2D. PCA is computed in-process (a light deterministic linear-algebra routine — SVD/eigendecomposition — no heavy external projection/ML library). A non-linear "cluster mode" (e.g., UMAP) is **out of scope for v1**, deferred to future work (see Out of Scope).
- **FR-010**: To keep the layout stable as the corpus grows, conversion MUST place new nodes onto a **cached projection basis** (out-of-sample) rather than re-solving the full projection each time. The basis MUST be refit only on defined triggers: corpus growth beyond a threshold (default: ≥20% growth since the last fit AND at least 25 new papers — tunable in planning), an explicit user "recompute layout" action, or a change in the canonical embedding model (e.g., a new SPECTER2 release). The basis is a regenerable plugin-managed cache, never per-paper state.
- **FR-011**: A node whose embedding is pending or absent, or whose vector is not yet in the canonical SPECTER2 space (e.g., a paper collected before the SPECTER2 model was present, so still on the bundled baseline), MUST still be assigned a deterministic fallback position within its year plane and MUST NOT cause conversion to fail — consistent with the rule that one malformed record never fails the whole conversion (FR-006). Conversion MUST NOT re-embed: converging pending/baseline papers into the SPECTER2 space is 002's background re-embed (`reembed.ts`), and conversion does not wait for it. Such a node stays at its fallback position until a later conversion run — after re-embed has converged it — projects it into the layout, so the graph is eventually consistent.
- **FR-012**: The "uncited" status a node carries MUST be derived from the same shared uncited rule used elsewhere in the plugin (citations known AND citation count is zero) — a single `isUncited` helper relocated to a neutral core module (`src/models/`, alongside the Paper type whose citation fields it reads) so 004/006/007 all import it with no cross-feature coupling — not a re-implemented citation-count check, so 004/006/007 agree on which papers count as uncited.

### Key Entities

- **Node**: A converted paper, carrying at least title and publication year (plus whatever the display needs: source identifier, citation status — `citationCount` and `citationsKnown`, letting 007 tell a confirmed-uncited paper from a not-yet-enriched one — and the shared uncited flag), read from a Paper's JSON record (persistence owned by 003), plus an (x,y) layout position derived from its content embedding via the similarity projection; its publication year is carried separately for the year axis.
- **Connection**: A directional edge A→B meaning paper A cites paper B, derived from A's outbound references (matched by source identifier).
- **Graph Data**: The (node list, connection list) — including each node's computed (x,y) position — handed to the display feature (007). Transient output, not persisted as its own file; it references the regenerable projection basis.
- **Projection Basis**: The cached, regenerable PCA basis (mean vector + principal axes + sign canonicalization) used to place nodes out-of-sample. A plugin-managed cache **separate from 003's record/note store** — persisting or refreshing it is not a write to any paper record, so the read-only-over-003 rule still holds. Refit only on defined triggers; never per-paper state; fully regenerable from the corpus if lost.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The number of converted nodes equals the number of stored paper records, minus records excluded for a missing publication year and minus skipped malformed records.
- **SC-002**: A directional connection exists between exactly the paper pairs that have a citation relationship in the records (no missing edges for stored targets, no fabricated edges for dangling targets).
- **SC-003**: Conversion completes successfully even when records contain dangling references or a malformed entry — zero total-conversion failures from a single bad record.
- **SC-004**: Conversion reads only JSON records; zero graph output depends on parsing a user's Markdown body.
- **SC-005**: Content-similar papers are placed measurably closer in (x,y) than dissimilar ones; the same records reproduce the same layout across runs (deterministic default).
- **SC-006**: Adding a new paper places it via the cached basis without moving existing nodes (no full re-solve) except on an explicit refit trigger.
- **SC-007**: Every stored paper with a publication year appears as a node, including papers whose embedding is pending or not yet in the canonical SPECTER2 space — those receive a deterministic fallback position (identical across runs) and are never dropped.
- **SC-008**: Each node's uncited status matches the shared `isUncited` rule exactly (`citationsKnown === true && citationCount === 0`), agreeing with 004 and 007 on every paper.

## Assumptions

- Stored records expose their outbound references and content embedding in the shape fixed by 001; this feature only inverts and assembles them — it does not fetch citation data or compute embeddings (that is 002/005 and the embedding layer).
- The persisted corpus is read through the existing read-only enumeration surface owned by 003 (records are the source of truth); this feature creates, modifies, and deletes nothing in 003's record/note store. Its own regenerable projection-basis cache is a separate plugin-managed artifact (see Key Entities → Projection Basis), not a paper record, so persisting/refreshing it does not violate the read-only-over-003 rule.
- The display feature (007) decides visual encoding; this feature only guarantees each node carries the data needed to compute those encodings (year, citation/uncited status, position).
- Edges match by the source-identifier scheme already fixed by 002/001; a reference and a stored paper connect when their source identifiers are equal.
- The corpus fits comfortably in memory for a desktop-only plugin (per the project's desktop-only constraint), so projection can be computed in-process.
- Conversion is invoked on demand by its consumer (007/008); like 004, it does not self-trigger or run on a timer. Each run reads the current persisted corpus and produces a fresh graph-data structure (reusing the cached basis per FR-010), so the graph stays eventually consistent as embeddings/enrichment converge in the background.

## Dependencies

- **001 (core data models)**: the Paper shape — title, publication year, source identifier, outbound references, citation count/known flag, embedding + embeddingModel + embeddingSource. Read-only; this feature never redefines these types.
- **003 (paper-note persistence)**: the canonical JSON records and their read-only enumeration surface. Read-only; no record/note is created, modified, or deleted here.
- Shared uncited rule: one `isUncited` helper, relocated to a neutral core module (`src/models/`) so it is reused — not re-implemented — across 004/006/007 (FR-012).
- Feeds **007 (3D visualization)**, which consumes this graph data and owns all rendering, interaction, and the mapping of publication year to the depth axis.

## Open Questions

*All resolved via `/speckit-clarify` (Session 2026-07-20); kept for traceability. Each answer is recorded under Clarifications and folded into the requirements above.*

- **OQ-1 — Empty references: "cites nothing" vs "not yet enriched".** → **Resolved (Session 2026-07-20)**: build edges from present references only; carry `citationsKnown` on each node so 007 distinguishes the two; no new signal; edges are eventually consistent (fill in once 002/005 enriches and conversion re-runs). See Clarifications.
- **OQ-2 — Reference scheme and edge matching.** → **Resolved (Session 2026-07-20)**: exact `PaperSourceId` string equality; cross-scheme or not-in-corpus references dangle and drop (FR-005). Complete for an arXiv-only corpus — see Clarifications.
- **OQ-3 — Refit trigger thresholds.** → **Resolved (Session 2026-07-20)**: refit on ≥20% corpus growth since the last fit AND ≥25 new papers (tunable). See Clarifications / FR-010.
- **OQ-4 — UMAP mode and projection library.** → **Resolved (Session 2026-07-20)**: PCA-only in v1, computed in-process (no heavy library); UMAP deferred to future work. See Clarifications / Out of Scope.
- **OQ-5 — Shared uncited helper location.** → **Resolved (Session 2026-07-20)**: relocate `isUncited` to a neutral core module (`src/models/`) so 004/006/007 share one helper with no cross-feature coupling. See Clarifications.

## Out of Scope

- Actual on-screen rendering and interaction are owned by 007. (Conversion owns the x,y layout **data** — the projection — but 007 owns rendering/interaction and the mapping of publication year to the depth axis.)
- Creating, modifying, or deleting record/note files is owned by 003; this feature is read-only over stored records.
- Fetching or refreshing citation data is owned by 002/005.
- Computing content embeddings is owned by the embedding layer (002); this feature only projects existing embeddings.
- **Future work — non-linear "cluster mode" (UMAP).** v1 ships deterministic PCA only. UMAP is deferred because it is stochastic (conflicts with FR-009's determinism), lacks a linear basis for stable out-of-sample placement (conflicts with FR-010/SC-006), and adds bundle weight; it remains cleanly addable later behind the optional-mode flag with no rework of the PCA path.
