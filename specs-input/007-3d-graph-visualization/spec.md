# Feature Specification: 3D Graph Visualization & Interaction

**Feature Branch**: `007-3d-graph-visualization`

**Created**: 2026-07-04

**Status**: Draft

**Input**: "Visualize paper nodes and citation relationships in three-dimensional space and let the user explore and interact with them. Publication year is fixed to one axis so same-year papers share a plane. The user can rotate/zoom/pan, hover for a summary+citation panel, spot uncited recent papers, click a node to open its note, right-click for six actions, narrow a year range, and search-and-jump to a paper. Interactions that change or open a paper act through the same JSON-record/Markdown-note pairing the rest of the plugin uses."

## Clarifications

### Session 2026-07-04

- Q: Where does the graph get its data? → A: From the graph-data conversion feature (006), which reads the canonical JSON records. This feature only displays and interacts with data that already exists; it never parses vault files itself.
- Q: When an interaction opens or changes a paper (open note, refresh, remove), what does it act on? → A: Opening a paper opens its Markdown note (the user-facing surface). Refresh runs through 005 and remove-from-graph, if it deletes, runs through 003's coordinated delete of the record + note pairing. This feature originates the user intent but delegates the data operation.
- Q: Does "remove from graph" delete the paper or just hide it? → A: This must be unambiguous to the user. "Remove from graph" hides the node from the current view by default; deleting the underlying record/note is a distinct, clearly-labeled, confirmed action because deletion is irreversible.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See papers arranged by publication year in 3D (Priority: P2)

As a user, I want my collected papers arranged so their publication order is immediately clear, in a 3D space I can rotate, zoom, and pan.

**Why this priority**: The spatial-by-year layout is the plugin's signature view and the frame every other interaction hangs on.

**Independent Test**: Load graph data spanning several years and confirm papers from different years sit on different planes along the year axis, and that rotate/zoom/pan controls move the view responsively.

**Acceptance Scenarios**:

1. **Given** graph data spanning multiple years, **When** it is displayed, **Then** publication year is fixed to one axis and same-year papers share a plane, while different years sit on different planes (depths).
2. **Given** the graph is displayed, **When** the user rotates, zooms, or pans, **Then** the view responds and the exploration remains fluid.
3. **Given** citation relationships exist, **When** the graph is displayed, **Then** directional connections between papers are drawn.

---

### User Story 2 - Inspect and open papers (Priority: P2)

As a user, I want to hover a node for its summary and citation info, click it to open its note, and easily spot recent uncited papers.

**Why this priority**: Inspection and navigation turn a static picture into a usable research tool.

**Independent Test**: Hover a node and confirm a panel with its summary and citation info appears; click a node and confirm its Markdown note opens; confirm uncited papers are visually distinct.

**Acceptance Scenarios**:

1. **Given** a node, **When** the user hovers it, **Then** a panel appears containing that paper's summary and citation information.
2. **Given** a node, **When** the user clicks it, **Then** that paper's Markdown note opens.
3. **Given** papers that nobody has cited yet, **When** the graph is displayed, **Then** they are visually distinguished from other nodes.

---

### User Story 3 - Right-click actions on a node (Priority: P2)

As a user, I want to right-click a node and immediately run one of six actions: open note, refresh this paper, copy source link, copy title, toggle read/unread, and remove from graph.

**Why this priority**: Direct manipulation from the graph is what makes it a control surface, not just a picture.

**Independent Test**: Right-click a node and confirm all six actions are offered and each produces an immediately observable result, with refresh delegating to 005 and a deleting remove delegating to 003.

**Acceptance Scenarios**:

1. **Given** a node, **When** the user right-clicks it, **Then** a menu offers exactly six actions: open note, refresh this paper, copy source link, copy title, toggle read/unread, remove from graph.
2. **Given** the menu, **When** the user picks "open note", **Then** the paper's Markdown note opens.
3. **Given** the menu, **When** the user picks "refresh this paper", **Then** a refresh runs via 005 and the updated citation data is reflected.
4. **Given** the menu, **When** the user picks "copy source link" or "copy title", **Then** the corresponding value is placed on the clipboard.
5. **Given** the menu, **When** the user toggles read/unread, **Then** the node's read state changes and is visibly reflected.
6. **Given** the menu, **When** the user picks "remove from graph", **Then** the node is removed from the current view; if the action is the clearly-labeled delete variant, it is confirmed first and then deletes the record + note pairing via 003.

---

### User Story 4 - Filter by year and search-and-jump (Priority: P3)

As a user, I want to narrow the graph to a specific year range and to search a paper by name and have the view move to it.

**Why this priority**: Navigation aids that matter most once many papers accumulate.

**Independent Test**: Narrow a year range and confirm out-of-range papers disappear entirely; search a known title and confirm the view moves to it; search a missing title and confirm a no-results message.

**Acceptance Scenarios**:

1. **Given** a year range control, **When** the user narrows it, **Then** papers outside the range are completely hidden from the screen.
2. **Given** search, **When** the user searches an existing paper by name, **Then** the view moves so that paper is immediately visible.
3. **Given** search, **When** a search returns no results, **Then** the user is informed.

---

### Edge Cases

- If the graph has no papers at all, a message is shown instead of a blank screen.
- "Remove from graph" must make unmistakably clear whether it only hides the node or also deletes the underlying record/note; deletion is irreversible, is separately labeled, and is confirmed before it runs.
- Exploration controls must remain responsive even with a very large number of accumulated papers.
- The user must be informed when a search returns no results.
- If a hovered paper has no summary (feature 004 off or fell back to abstract), the panel shows the abstract/citation info it does have rather than an empty panel.
- Read/unread is a display state; where it is persisted (an extension field on the record per 001 FR-016) must keep the JSON/Markdown pairing consistent through 003.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The graph MUST be displayed in three-dimensional space with publication year fixed to one axis, so that same-year papers sit on the same plane and different years sit on different planes.
- **FR-002**: The user MUST be able to rotate, zoom, and pan to explore the graph, and exploration MUST remain responsive even with a large number of papers.
- **FR-003**: Directional citation connections MUST be drawn between papers as provided by the graph data (006).
- **FR-004**: Hovering a node MUST bring up a panel containing that paper's summary and citation information (falling back to the abstract when no summary exists).
- **FR-005**: Papers that nobody has cited yet MUST be visually distinguished from other nodes.
- **FR-006**: Clicking a node MUST open that paper's Markdown note.
- **FR-007**: Right-clicking a node MUST offer exactly six actions: open note, refresh this paper, copy source link, copy title, toggle read/unread, remove from graph. Each MUST produce an immediately observable result.
- **FR-008**: "Refresh this paper" MUST run through the manual-refresh feature (005); "remove from graph", when it deletes, MUST run through the coordinated record+note delete in 003.
- **FR-009**: The user MUST be able to narrow a year range so that out-of-range papers are completely hidden from the screen.
- **FR-010**: The user MUST be able to search for a specific paper and have the view move to it; a search with no results MUST inform the user.
- **FR-011**: When there are no papers to show, a message MUST be shown instead of a blank screen.
- **FR-012**: "Remove from graph" MUST make clear whether it hides the node or deletes the underlying data; the deleting variant MUST be separately labeled and confirmed before running, because deletion is irreversible.
- **FR-013**: This feature MUST consume graph data from 006 and MUST NOT parse vault files or contact external providers directly.

### Key Entities

- **Graph View**: The 3D rendering of nodes and connections, with camera controls, hover panel, year-range filter, and search.
- **Node (displayed)**: A rendered paper positioned by publication year, styled to reflect citation and read/unread status; backed by a paper's record via 006.
- **Right-Click Action Set**: The fixed set of six per-node actions, each delegating any data change to 003/005 rather than mutating state directly.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Paper nodes from different years always sit on different planes (depths).
- **SC-002**: Narrowing the year range makes out-of-range papers disappear from the screen entirely.
- **SC-003**: A paper found via search causes the view to move to it so it is immediately visible; a no-result search informs the user.
- **SC-004**: Each right-click action produces an immediately observable result (note opens, clipboard copied, read state toggles, node disappears, refresh reflected).
- **SC-005**: With zero papers, a message is shown rather than a blank screen.
- **SC-006**: Any deleting "remove" action is confirmed before it irreversibly deletes the record+note pairing.

## Assumptions

- Graph data (nodes + connections) is supplied by 006; this feature does not read stored files itself.
- Read/unread state is stored as an extension field on the paper record (001 FR-016) and kept consistent across the JSON/Markdown pairing by 003.
- The uncited visual distinction reads the record's citation count (0 = uncited). Its accuracy depends on collection (002) having enriched the paper's citation data before promotion (002 FR-016); an un-enriched paper reads 0 and is shown as uncited until a manual refresh (005) updates it.
- The 3D rendering technology is an implementation choice constrained by the project's mobile-compatibility and platform-compliance rules; this spec fixes behavior, not the rendering library.

## Open Questions

*Deferred to `/speckit.clarify` and `/speckit.plan` — recorded so refinement and planning address them. None are settled yet.*

- **OQ-1 — Intra-year-plane layout.** How are nodes positioned on the two non-year axes — force-directed, citation-driven, or a deterministic layout? (001's `layout` setting is a placeholder.)
- **OQ-2 — `colorScheme` meaning.** What does the graph-display color scheme (e.g. `byPublicationYear`) actually encode?
- **OQ-3 — "Most recent" definition** for the uncited highlight — same question as 004 OQ-1.
- **OQ-4 — Hide persistence.** When "remove from graph" only hides a node, is that hidden state persisted across sessions or session-only?
- **OQ-5 — Concrete scale/responsiveness targets** — what counts as a "large number of papers", and the responsiveness budget under it.
- **OQ-6 — Read/unread default and storage shape** — the default state and the extension-field representation (coordinate with 003).
- **OQ-7 — Mobile viability and `isDesktopOnly`.** The 3D rendering/interaction choice (OQ-1) decides whether the plugin can run on Obsidian mobile. `manifest.json` currently sets `isDesktopOnly: false` — the project default, per the constitution's mobile-compatibility principle, and consistent with the rest of the plugin (network via `requestUrl`, vault I/O) being mobile-capable. If the chosen 3D approach depends on Node/Electron APIs, or is unusable at acceptable performance on touch/mobile, then `isDesktopOnly` must flip to `true`. That is a deliberate decision to drop mobile support — to be recorded here and in the constitution's platform-compliance/mobile notes, not defaulted. Decide during 007 planning: keep the rendering mobile-compatible, or commit to desktop-only and set the manifest flag accordingly.

## Out of Scope

- Producing the graph data is owned by 006.
- Fetching/refreshing citation data is owned by 002/005; this feature only triggers a refresh, it does not perform the external call.
- Creating/deleting record/note files is owned by 003; this feature only originates the intent and delegates.
