# Feature Specification: Citation-Based Paper Expansion

**Feature Branch**: `009-citation-expansion`

**Created**: 2026-07-05

**Status**: Future Work (deferred — implement after the core plugin 001–008 is complete)

**Input**: "When a paper is collected (subscribed), automatically find the papers it cites and add them as their own paper nodes — separately from keyword subscriptions and author subscriptions. A cited paper that is not yet in the vault should become a real, stored paper node (not merely a dangling edge), so the citation graph fills in with the actual works a subscribed paper builds on."

> **Note (why this is future work):** In the current design, subscriptions exist only for keyword / author / arXiv category (002, FR-001), and citation references become graph *edges* only between papers already stored in the vault — a reference to a paper not yet collected is deliberately **not** turned into a node (006, FR-005 and its clarifications). This feature adds the missing capability: promoting a subscribed paper's outbound references into first-class, stored paper nodes. It is recorded here so it can be picked up as a follow-on once 001–008 ship, without disturbing those specs.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Expand a subscribed paper into the works it cites (Priority: P1)

As a researcher tracking a topic, when a paper is collected through one of my subscriptions, I want the plugin to automatically pull in the papers that paper cites and store them as their own nodes, so that my graph shows not just the papers matching my keywords/authors but also the foundational works they build on — without my having to subscribe to each cited paper myself.

**Why this priority**: This is the core value of the feature — turning a flat list of subscription matches into a connected citation neighborhood. Everything else (depth control, deduplication, styling) refines this behavior.

**Independent Test**: Collect a single "seed" paper whose (stubbed) enrichment response lists three references. Confirm that, after expansion runs, three additional papers exist as stored nodes, each connected to the seed by a directional citation edge, and none of them required a keyword/author/category subscription.

**Acceptance Scenarios**:

1. **Given** a newly collected paper with a non-empty, enriched reference list, **When** expansion runs, **Then** each referenced paper that resolves to a real work is collected and stored as its own paper node.
2. **Given** an expanded (cited) paper is stored, **When** graph conversion (006) runs, **Then** a directional connection from the citing paper to the cited paper exists and is no longer a dangling edge.
3. **Given** a cited paper is added by expansion rather than by a subscription, **When** the user views it, **Then** it is distinguishable as citation-sourced (e.g., it carries a provenance marker) and is **not** attributed to any keyword or author subscription.

---

### User Story 2 - Bounded expansion depth (Priority: P1)

As a user, I want to control how far the citation expansion reaches (e.g., only the papers directly cited by my subscribed papers, or one further hop), so that expanding one paper does not recursively pull in thousands of papers and flood my vault.

**Why this priority**: Unbounded citation expansion grows super-linearly and would make the feature unusable. A depth bound is what keeps it safe to turn on.

**Independent Test**: With a maximum depth of 1, collect a seed paper whose references themselves have references. Confirm only the seed's *direct* references are added, and the references-of-references are **not** collected.

**Acceptance Scenarios**:

1. **Given** an expansion depth limit of N, **When** expansion runs from a seed paper, **Then** papers more than N citation hops away from any seed are **not** collected.
2. **Given** the depth limit is 0 (or the feature is disabled), **When** a paper is collected, **Then** no citation expansion occurs and behavior is identical to the current 002/006 pipeline.
3. **Given** an expansion in progress reaches the depth limit, **When** it stops, **Then** references beyond the limit are left as dangling edges (handled exactly as 006 handles any not-yet-stored reference), not as errors.

---

### User Story 3 - Deduplicate against existing and subscription-sourced papers (Priority: P2)

As a user, I don't want the same paper stored twice just because it was both cited by a subscribed paper and matched by a subscription, so that my graph has one node per work.

**Why this priority**: Without dedup, expansion would create duplicate nodes and duplicate edges, undermining the graph's meaning. It is P2 because the core expansion (US1) is demonstrable first, but this must land before the feature is shippable.

**Independent Test**: Pre-store a paper P (as if collected by a keyword subscription). Collect a seed paper that cites P. Confirm expansion does **not** create a second copy of P; instead it reuses the existing node and simply adds the citing edge.

**Acceptance Scenarios**:

1. **Given** a cited paper whose source identifier already matches a stored paper, **When** expansion runs, **Then** the existing paper is reused (no duplicate node) and only the missing citation edge is added.
2. **Given** the same cited paper is reachable from two different seed papers, **When** expansion runs, **Then** it is collected and stored only once.
3. **Given** a paper later matched by a subscription that was already added by expansion, **When** the subscription collects it, **Then** it is not duplicated; its provenance may be updated to reflect both sources.

---

### Edge Cases

- A cited paper cannot be resolved to a real, identifiable work (no usable identifier from the citation-aware provider) → it is left as a dangling edge (per 006) and **not** fabricated as a node; expansion does not fail.
- A subscribed paper has **unknown** references (e.g., collected from arXiv without Semantic Scholar enrichment, per 002 FR-015) → there is nothing to expand yet; expansion is skipped for that paper until a later enrichment or manual refresh (005) supplies references.
- A citation cycle exists (A cites B, B cites A) → expansion must terminate (visited-set / depth bound) and must not loop.
- A single seed produces an unusually large reference list → expanded papers are collected sequentially without freezing the interface, following the same non-freezing rule as 002 FR-013.
- A provider is unreachable while resolving a cited paper → that cited paper is skipped for this pass and retried on a later refresh (005); the seed paper and its other references are unaffected.
- Expansion is turned off after papers were already added by it → previously expanded papers remain (they are ordinary stored papers now); no retroactive deletion.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When a paper is collected and has an enriched, non-empty reference list, the system MUST be able to collect each referenced work and store it as its own paper node, independent of any keyword/author/arXiv-category subscription.
- **FR-002**: Citation-based expansion MUST be a distinct paper source from subscriptions; an expanded paper MUST NOT be attributed to a keyword or author subscription, and MUST carry provenance identifying it as citation-sourced (including which paper(s) cited it).
- **FR-003**: Expansion MUST be bounded by a configurable maximum citation depth; papers more than that many hops from any seed MUST NOT be collected. A depth of 0 (or a disabled setting) MUST reproduce the current 002/006 behavior exactly.
- **FR-004**: Expansion MUST be individually enable/disable-able by the user, and MUST default to **off** (opt-in), because it collects papers the user did not explicitly subscribe to.
- **FR-005**: An expanded paper whose source identifier already matches a stored paper MUST reuse the existing node rather than create a duplicate; only the missing citation edge (and provenance) is added.
- **FR-006**: The same cited work reachable through multiple paths (multiple seeds, a cycle, or overlapping expansions) MUST be collected and stored only once, deduplicated by source identifier.
- **FR-007**: A reference that cannot be resolved to an identifiable real work MUST be left as a dangling edge handled by 006, and MUST NOT be fabricated into a node; expansion MUST NOT fail because of an unresolvable reference.
- **FR-008**: Expansion MUST reuse the existing collection pipeline (002) for actually fetching, enriching, promoting, and persisting each cited paper — it introduces *which* papers to collect (a seed's references) and *how far* to go (depth), not a second, parallel provider/persistence path. All external calls remain confined to 002; all file writes remain owned by 003.
- **FR-009**: A large expansion MUST process cited papers sequentially without freezing the interface (same non-freezing guarantee as 002 FR-013).
- **FR-010**: Expansion MUST terminate on citation cycles via a visited-set and the depth bound, and MUST NOT loop or re-collect an already-visited paper within a single expansion run.
- **FR-011**: A paper with **unknown** references (not yet enriched) MUST NOT be expanded until references are known; when a later enrichment or manual refresh (005) supplies references, expansion MAY run for it then.
- **FR-012**: Once stored, an expanded paper MUST be indistinguishable from any other stored paper to downstream features (003 persistence, 006 graph conversion, 007 display) except for its provenance marker; it MUST participate normally in graph conversion so the citing→cited edge resolves.

### Key Entities

- **Seed Paper**: A paper collected by a subscription (or by a prior expansion within the depth limit) whose enriched references are the input to an expansion pass.
- **Expanded Paper**: A `Paper` (001) collected because a seed cited it, carrying provenance that marks it as citation-sourced rather than subscription-sourced. Otherwise an ordinary stored paper.
- **Expansion Provenance**: The record of *why* a paper is in the vault — which seed paper(s) cited it and at what depth — distinct from the subscription attribution used for subscription-collected papers. Enables User Story 1 scenario 3 and FR-002.
- **Expansion Depth**: The maximum number of citation hops expansion follows outward from any subscription-collected seed. A user setting; bounds the entire feature (FR-003).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a seed paper with an enriched reference list, 100% of its *resolvable* references become stored paper nodes connected to the seed by a directional citation edge (subject to the depth bound), with zero of them attributed to a keyword/author subscription.
- **SC-002**: With expansion depth N, no stored paper is more than N citation hops from a subscription-collected seed; setting depth 0 / disabling the feature yields byte-for-byte the same set of stored papers as the current 002/006 pipeline.
- **SC-003**: No work is stored more than once as a result of expansion — one node per source identifier, even across multiple seeds and citation cycles.
- **SC-004**: Expansion makes zero external calls outside the 002 provider layer and performs zero file writes outside 003; it only orchestrates which papers 002 collects.
- **SC-005**: An expansion over a large reference set completes without freezing the interface, and terminates on cyclic citations.

## Assumptions

- The citation-aware provider (Semantic Scholar, via 002 enrichment) supplies each reference with an identifier usable as a `sourceId`, so a cited paper can be both resolved for collection and matched for deduplication. (This depends on 002 OQ-3 / OQ-4 being settled; if references cannot be resolved to collectable identifiers, this feature reduces to leaving them as dangling edges.)
- The current pipeline ordering (002 enriches → optionally summarizes via 004 → persists via 003) is reused per expanded paper; this feature adds a step that feeds a seed's references back into that same pipeline under a depth bound, rather than replacing it.
- "A paper was collected" is observable to this feature at the point 002 finishes processing a paper, so expansion can be triggered from there.

## Open Questions

*Recorded for when this feature is picked up; none are settled.*

- **OQ-1 — Expansion direction.** Only outbound references (papers the seed cites), or also inbound citations (papers that cite the seed, "cited-by")? The input scopes this to cited papers (outbound); inbound expansion would be a larger, separate capability.
- **OQ-2 — Default depth and hard ceiling.** What is the default `maxDepth` (likely 1), and is there a non-overridable hard ceiling to prevent runaway vault growth regardless of user setting?
- **OQ-3 — Provenance model.** How is citation-source provenance stored on a `Paper` (001) / its record (003) — a dedicated field, a flag plus a citing-paper list, or a separate index? Interacts with 003's record schema (003 OQ-1).
- **OQ-4 — Lifecycle of expanded papers.** If the seed paper that pulled in an expanded paper is later deleted, does the expanded paper stay, get garbage-collected if nothing else cites it, or is it always kept? (Mirrors the general question of orphan-node cleanup.)
- **OQ-5 — Interaction with catch-up collection (002).** Should expansion also run during off-period catch-up, or only for papers collected while the plugin is actively running? Controls how much a long off period can expand at once.
- **OQ-6 — Rate-limit budget.** Expansion multiplies the number of provider look-ups per subscribed paper; how does it share 002's retry/back-off and rate-limit budget so it doesn't starve normal subscription collection?

## Out of Scope

- All external database communication, parsing, enrichment, promotion, and the per-paper processing pipeline remain owned by 002; this feature only decides *which additional papers* (a seed's references) to feed into that pipeline and *how deep* to go.
- Persisting record/note pairs is owned by 003; expanded papers are persisted through 003 unchanged.
- Summarization of expanded papers is owned by 004 (invoked by 002's pipeline as usual).
- Manual refresh of an already-stored paper is owned by 005.
- Converting stored papers (including expanded ones) into nodes/edges is owned by 006; this feature only ensures the cited papers become *stored* so 006's edges resolve instead of dangling.
- On-screen rendering and any citation-source visual styling are owned by 007.
- Introducing a new "subscribe to a specific paper" subscription type is **not** part of this feature; expansion is triggered by citation relationships, not by a new subscription type.
