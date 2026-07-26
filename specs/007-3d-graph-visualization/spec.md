# Feature Specification: 3D Graph Visualization & Interaction

**Feature Branch**: `007-3d-graph-visualization`

**Created**: 2026-07-25

**Status**: Draft

**Input**: User description: "007의 논문 node들을 3d로 시각화 하는 기능" — visualize the paper nodes (and their citation relationships) produced by graph-data conversion (006) in three-dimensional space, and let the user explore and interact with them. Publication year is fixed to one axis so same-year papers share a plane; the user can rotate/zoom/pan, hover for a summary + citation panel, spot uncited recent papers, click a node to open its note, right-click for six actions, narrow a year range, and search-and-jump to a paper. Interactions that change or open a paper act through the same JSON-record / Markdown-note pairing the rest of the plugin uses. (Graduates the `specs-input/007-3d-graph-visualization` draft.)

## Clarifications

### Session 2026-07-04

- Q: Where does the graph get its data? → A: From the graph-data conversion feature (006), which reads the canonical JSON records and emits `GraphData` (nodes + directional connections + each node's computed x,y position). This feature only displays and interacts with data that already exists; it never parses vault files itself.
- Q: When an interaction opens or changes a paper (open note, refresh, remove), what does it act on? → A: Opening a paper opens its Markdown note (the user-facing surface). Refresh runs through 005 and remove-from-graph, if it deletes, runs through 003's coordinated delete of the record + note pairing. This feature originates the user intent but delegates the data operation.
- Q: Does "remove from graph" delete the paper or just hide it? → A: This must be unambiguous to the user. "Remove from graph" hides the node from the current view by default; deleting the underlying record/note is a distinct, clearly-labeled, confirmed action because deletion is irreversible.

### Session 2026-07-07

- Q: What determines node x,y? → A: x,y come from 006's **content-similarity projection** (the deterministic PCA projection of each paper's SPECTER2 content embedding); publication year remains fixed to the separate depth axis (FR-001, unchanged). Content-similar papers cluster in x,y and, because year owns the depth axis, the same topic across different years stacks into a vertical "column" through the year planes.
- Q: Mobile support? → A: The chosen approach (native on-device embedding + 3D rendering + in-memory projection) is **desktop-only**. `manifest.json` sets `isDesktopOnly: true`; this closes OQ-7 as a deliberate, recorded decision to drop mobile support.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See papers arranged by publication year in 3D (Priority: P1)

As a user, I want my collected papers arranged so their publication order is immediately clear, in a 3D space I can rotate, zoom, and pan.

**Why this priority**: The spatial-by-year layout is the plugin's signature view and the frame every other interaction hangs on. Nothing else in this feature is usable until nodes render in a navigable 3D space.

**Independent Test**: Load graph data spanning several years and confirm papers from different years sit on different planes along the year axis, and that rotate/zoom/pan controls move the view responsively.

**Acceptance Scenarios**:

1. **Given** graph data spanning multiple years, **When** it is displayed, **Then** publication year is fixed to one axis and same-year papers share a plane, while different years sit on different planes (depths).
2. **Given** the graph is displayed, **When** the user rotates, zooms, or pans, **Then** the view responds and the exploration remains fluid.
3. **Given** citation relationships exist in the graph data, **When** the graph is displayed, **Then** directional connections between papers are drawn.

---

### User Story 2 - Inspect and open papers (Priority: P2)

As a user, I want to hover a node for its summary and citation info, click it to open its note, and easily spot recent uncited papers.

**Why this priority**: Inspection and navigation turn a static picture into a usable research tool. Builds directly on Story 1's rendered graph.

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

**Why this priority**: Navigation aids that matter most once many papers accumulate. Valuable but not required for an MVP demonstration of the graph.

**Independent Test**: Narrow a year range and confirm out-of-range papers disappear entirely; search a known title and confirm the view moves to it; search a missing title and confirm a no-results message.

**Acceptance Scenarios**:

1. **Given** a year range control, **When** the user narrows it, **Then** papers outside the range are completely hidden from the screen.
2. **Given** search, **When** the user searches an existing paper by name, **Then** the view moves so that paper is immediately visible.
3. **Given** search, **When** a search returns no results, **Then** the user is informed.

---

### Edge Cases

- If the graph has no papers at all, a message is shown instead of a blank screen.
- "Remove from graph" must make unmistakably clear whether it only hides the node or also deletes the underlying record/note; deletion is irreversible, is separately labeled, and is confirmed before it runs.
- Exploration controls must remain responsive even with a very large number of accumulated papers (see FR-016–FR-021).
- The user must be informed when a search returns no results.
- If a hovered paper has no summary (feature 004 off or fell back to abstract), the panel shows the abstract / citation info it does have rather than an empty panel.
- Read/unread is a display state; where it is persisted (an extension field on the record per 001 FR-016) must keep the JSON / Markdown pairing consistent through 003.
- A node whose 006 position is a deterministic fallback (embedding pending / not yet in the canonical SPECTER2 space) still renders at its assigned year plane; the view MUST NOT fail or leave it unplaced.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The graph MUST be displayed in three-dimensional space with publication year fixed to one axis, so that same-year papers sit on the same plane and different years sit on different planes.
- **FR-002**: The user MUST be able to rotate, zoom, and pan to explore the graph, and exploration MUST remain responsive even with a large number of papers — the concrete node-count / frame-rate target is fixed in OQ-5 and delivered by the rendering / interaction requirements FR-016–FR-020.
- **FR-003**: Directional citation connections MUST be drawn between papers as provided by the graph data (006), with direction indicated (which paper cites which).
- **FR-004**: Hovering a node MUST bring up a panel containing that paper's summary and citation information (falling back to the abstract when no summary exists).
- **FR-005**: Papers that nobody has cited yet MUST be visually distinguished from other nodes, using the shared uncited flag carried on each node by 006 (not an in-graph inbound-edge count).
- **FR-006**: Clicking a node MUST open that paper's Markdown note.
- **FR-007**: Right-clicking a node MUST offer exactly six actions: open note, refresh this paper, copy source link, copy title, toggle read/unread, remove from graph. Each MUST produce an immediately observable result.
- **FR-008**: "Refresh this paper" MUST run through the manual-refresh feature (005); "remove from graph", when it deletes, MUST run through the coordinated record + note delete in 003.
- **FR-009**: The user MUST be able to narrow a year range so that out-of-range papers are completely hidden from the screen.
- **FR-010**: The user MUST be able to search for a specific paper and have the view move to it; a search with no results MUST inform the user.
- **FR-011**: When there are no papers to show, a message MUST be shown instead of a blank screen.
- **FR-012**: "Remove from graph" MUST make clear whether it hides the node or deletes the underlying data; the deleting variant MUST be separately labeled and confirmed before running, because deletion is irreversible.
- **FR-013**: This feature MUST consume graph data from 006 and MUST NOT parse vault files or contact external providers directly.
- **FR-014**: Node x,y placement MUST use the content-similarity projection provided by 006; the plugin MUST NOT re-derive positions from vault files itself (consistent with FR-013). Publication year remains fixed to the separate axis (FR-001). When a projection refit (006) changes positions, the view SHOULD animate the transition rather than snapping.
- **FR-015**: The plugin is desktop-only (`manifest.json` `isDesktopOnly: true`). The 3D rendering, on-device embedding, and projection MAY use Node/Electron/native capabilities accordingly, consistent with the constitution's platform-compliance rule for an intentional desktop-only plugin.
- **FR-016** *(instanced node rendering)*: Nodes MUST be rendered with a GPU-instanced / point-based technique — a single draw-call class for all nodes — rather than one mesh or scene object per node, so that tens of thousands of nodes render at an interactive frame rate (OQ-5). A per-node-object approach that degrades in the low thousands is non-conforming.
- **FR-017** *(label level-of-detail)*: Node text labels MUST be level-of-detail: rendered only for a bounded subset (e.g. the hovered, selected, searched, or otherwise salient nodes), never one persistent text label per node. Per-node text does not scale and is the primary render-cost cliff.
- **FR-018** *(edge level-of-detail)*: Citation edges (FR-003) MUST scale via level-of-detail / culling — e.g. drawn only for in-view or focused / expanded nodes — so edge rendering does not dominate cost at large node counts.
- **FR-019** *(sub-linear picking)*: Hover (FR-004) and click (FR-006) hit-testing MUST use a spatial index or GPU picking, not a per-frame linear scan over all nodes, so interaction latency stays roughly flat as the node count grows.
- **FR-020** *(default-scoped view)*: The default view MUST NOT render and interact with the entire accumulated corpus at once. At minimum the year-range filter (FR-009) scopes what is shown, and a persisted render-window setting (FR-021) provides the default scope; the view SHOULD additionally offer subscription and/or similarity-cluster scoping. Because the corpus accumulates without bound (a broad subscription can add ~100 papers/day), this in-view scoping — not raw draw performance — is the primary defense against visual clutter and interaction cost. (Bounding *total* accumulation via a retention/cap policy is out of scope for this feature; deferred to 002/008.)
- **FR-021** *(persisted render window)*: The settings screen (008) MUST expose a persisted **render window** — a publication-date range or a rolling window (e.g. "the last N years") — that bounds which papers the graph loads and renders **by default**, so a session never starts by materializing the whole corpus. It is stored as a `GraphDisplayOptions` extension field on settings (001 FR-016) and composes with the interactive year-range filter (FR-009), which may narrow further within it. To be a genuine cost control rather than a mere display filter, out-of-window papers SHOULD also be excluded from projection / load (006), so a large historical corpus imposes no rendering **or** projection cost while the window is narrow. An "all papers" setting MUST remain available for users who want the full graph.

### Key Entities

- **Graph View**: The 3D rendering of nodes and connections, with camera controls, hover panel, year-range filter, and search. A dedicated workspace view opened on demand by the user (via 008's command / ribbon wiring), not on a timer.
- **Node (displayed)**: A rendered paper positioned by publication year (depth axis) and by 006's x,y projection (in-plane), styled to reflect citation and read/unread status; backed by a paper's record via 006's `GraphNode`.
- **Right-Click Action Set**: The fixed set of six per-node actions, each delegating any data change to 003/005 rather than mutating state directly.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Paper nodes from different years always sit on different planes (depths).
- **SC-002**: Narrowing the year range makes out-of-range papers disappear from the screen entirely.
- **SC-003**: A paper found via search causes the view to move to it so it is immediately visible; a no-result search informs the user.
- **SC-004**: Each right-click action produces an immediately observable result (note opens, clipboard copied, read state toggles, node disappears, refresh reflected).
- **SC-005**: With zero papers, a message is shown rather than a blank screen.
- **SC-006**: Any deleting "remove" action is confirmed before it irreversibly deletes the record + note pairing.
- **SC-007**: Node x,y reflects content similarity (similar papers cluster), while every year still maps to a distinct plane on the fixed axis (SC-001 preserved).
- **SC-008**: Rotate/zoom/pan sustains an interactive frame rate (~50–60 fps) at the OQ-5 target node count (~50k in view) on a typical desktop GPU, and interaction latency does not visibly worsen as the corpus grows — verifying FR-016–FR-020.

## Assumptions

- Graph data (nodes + connections + each node's x,y position + basis model) is supplied by 006's `GraphData`; this feature does not read stored files itself.
- Read/unread state is stored as an extension field on the paper record (001 FR-016) and kept consistent across the JSON / Markdown pairing by 003.
- The uncited visual distinction reads the shared `isUncited` rule surfaced by 006 (`citationsKnown === true && citationCount === 0`). Its accuracy depends on collection (002) having enriched the paper's citation data; an un-enriched paper (`citationsKnown === false`) is not marked uncited until a manual refresh (005) or background enrichment updates it.
- The 3D rendering technology is an implementation choice fixed at planning time, constrained by the desktop-only decision and the constitution's platform-compliance rules; this spec fixes behavior, not the rendering library.
- The render window (FR-021) is a `GraphDisplayOptions` extension field on the plugin settings (001 FR-016), surfaced by the 008 settings screen and read by 007 (and, for the projection/load cost saving, honored by 006). Default value and whether it is a fixed range vs. a rolling "last N years" are settings/UX decisions owned by 001/008.
- The Graph View is opened, and its command/ribbon entry registered, by the plugin-assembly feature (008); this feature owns the view's contents and behavior, not the host-chrome wiring that launches it.

## Open Questions

*Deferred to `/speckit-clarify` and `/speckit-plan` — recorded so refinement and planning address them.*

- **OQ-1 — Intra-year-plane layout. [RESOLVED 2026-07-07]** x,y = content-similarity projection from 006 (deterministic PCA with sign-canonicalization; UMAP deferred to future work per 006 OQ-4).
- **OQ-2 — `colorScheme` meaning.** What does the graph-display color scheme (e.g. `byPublicationYear`) actually encode (year, read state, citation count, uncited)? Coordinate with 001's `GraphDisplayOptions` and 008.
- **OQ-3 — "Most recent" definition** for the uncited highlight — same question as 004 OQ-1. Does the uncited distinction apply to all uncited papers or only "recent" ones, and how is "recent" bounded?
- **OQ-4 — Hide persistence.** When "remove from graph" only hides a node, is that hidden state persisted across sessions or session-only?
- **OQ-5 — Concrete scale/responsiveness targets. [RESOLVED 2026-07-13]** "Large" is ~50,000 nodes in view; the responsiveness budget is an interactive ~50–60 fps for rotate/zoom/pan on a typical desktop GPU (SC-008). Met by two independent levers: (1) rendering/interaction technique (FR-016–FR-019) and (2) in-view scoping (FR-020/FR-021). Bounding total corpus accumulation is deferred to 002/008.
- **OQ-6 — Read/unread default and storage shape** — the default state and the extension-field representation (coordinate with 001/003).
- **OQ-7 — Mobile viability and `isDesktopOnly`. [RESOLVED 2026-07-07 → desktop-only]** Committed to desktop-only; `manifest.json` `isDesktopOnly` is `true`, recorded here and in the constitution's platform-compliance / mobile notes.

## Dependencies

- **006 (graph-data conversion)**: supplies `GraphData` — nodes (id, title, publication year, citation count/known flag, uncited flag, computed x,y position, position source), directional connections, and the projection basis model. Read-only consumer; 007 never re-derives positions or parses records.
- **003 (paper-note persistence)**: the coordinated record + note operations that a deleting "remove" and read/unread toggle delegate to. 007 originates intent; 003 owns the write.
- **005 (manual paper refresh)**: the "refresh this paper" action delegates the external re-fetch here.
- **004 (paper summarization)**: supplies the summary shown in the hover panel (with abstract fallback).
- **008 (plugin assembly)**: registers the command / ribbon that opens the Graph View and owns the settings screen exposing the render window (FR-021). 007 owns the view's contents; 008 owns the host-chrome wiring that launches it.

## Out of Scope

- Producing the graph data (nodes, connections, x,y projection) is owned by 006.
- Fetching / refreshing citation data is owned by 002/005; this feature only triggers a refresh, it does not perform the external call.
- Creating / deleting record/note files is owned by 003; this feature only originates the intent and delegates.
- Registering the command / ribbon entry that opens the view, and the settings screen UI, are owned by 008.
- Bounding total corpus accumulation (a retention / cap policy) is deferred to 002/008.
