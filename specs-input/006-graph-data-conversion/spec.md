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
- **FR-002a**: Each node MUST carry the record's citation count and its `citationsKnown` flag (001/002 FR-018), so the display (007) can distinguish a confirmed-uncited paper (`citationsKnown = true`, count 0) from one merely not-yet-enriched (`citationsKnown = false`) rather than treating both empty-reference cases identically.
- **FR-003**: Citation relationships MUST be represented as directional connections, showing which paper cites which, derived from each record's outbound references.
- **FR-004**: Inbound "cited-by" information, if needed by the display, MUST be derived by inverting the directional connections rather than stored separately.
- **FR-005**: A reference whose target paper is not stored MUST NOT cause conversion to fail; the dangling connection is ignored or handled separately.
- **FR-006**: A single malformed record MUST NOT fail the whole conversion; it is skipped and the remaining records are still converted.
- **FR-007**: This conversion MUST NOT draw anything on screen; it produces only a data structure (nodes + connections).

### Key Entities

- **Node**: A converted paper, carrying at least title and publication year (plus whatever the display needs — source identifier, citation count, and the `citationsKnown` flag (001/002 FR-018) so the display can tell a confirmed-uncited paper from an un-enriched one), read from a Paper's JSON record (persistence owned by 003).
- **Connection**: A directional edge A→B meaning paper A cites paper B, derived from A's outbound references.
- **Graph Data**: The pair of (node list, connection list) handed to the display feature. Transient output, not persisted as its own file.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The number of converted nodes equals the number of stored paper records, minus records excluded for a missing publication year (and minus skipped malformed records).
- **SC-002**: A directional connection exists between exactly the paper pairs that have a citation relationship in the records.
- **SC-003**: Conversion completes successfully even when records contain dangling references or a malformed entry — zero total-conversion failures from a single bad record.
- **SC-004**: Conversion reads only JSON records; zero graph output depends on parsing a user's Markdown body.

## Assumptions

- Stored records expose their outbound references in the shape fixed by 001; this feature only inverts and assembles them, it does not fetch citation data (that is 002/005).
- The display feature (007) decides visual encoding; this feature only guarantees each node carries the data needed to compute those encodings (year, citation status).

## Open Questions

*Deferred to `/speckit.clarify` and `/speckit.plan` — recorded so refinement and planning address them. None are settled yet.*

- ~~**OQ-1 — Empty references: "cites nothing" vs "not yet enriched".**~~ Resolved by 002 (FR-018): every stored `Paper` carries a `citationsKnown` boolean. `citationsKnown = false` means the paper was promoted without confirmed citation data, so its empty `references` mean "not yet enriched", not "cites nothing"; `citationsKnown = true` with empty references means genuinely cites nothing. This feature MUST carry `citationsKnown` (and citation count) onto each node so the display (007) can distinguish an un-enriched paper from a genuinely reference-less one, rather than silently treating a false-flagged paper as edgeless. (There is no separate 002/003 "enriched" flag to wait on — `citationsKnown` is it.)
- ~~**OQ-2 — Reference scheme and edge matching.**~~ Resolved by 002 (FR-019 + version-stripped `sourceId`): every reference's `sourceId` is normalized to the `arxiv:` scheme whenever the referenced work has a known arXiv ID (falling back to `semanticScholar:` only when it does not), and every paper's own `sourceId` is built from the version-stripped base arXiv id. An edge A→B therefore matches by exact `sourceId` string equality; a reference carrying only a `semanticScholar:` id (no arXiv id available) simply lands as a dangling edge to a not-stored target (FR-005), which is expected, not a bug to fix here.

## Out of Scope

- Actual on-screen rendering and interaction are owned by 007.
- Creating, modifying, or deleting record/note files is owned by 003; this feature is read-only over stored records.
- Fetching or refreshing citation data is owned by 002/005.
