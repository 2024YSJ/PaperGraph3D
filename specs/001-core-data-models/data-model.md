# Phase 1 Data Model: Core Data Structures

Source: `spec.md` (Key Entities, Functional Requirements, Clarifications). Types below are the concrete TypeScript design; see `research.md` for the reasoning behind each modeling choice and `contracts/data-model-api.md` for the exact exported surface.

All three entities are an **open baseline** (FR-016, Clarification 2026-07-02): the fields below are each entity's *required minimum*. Later features may add further fields without needing to modify these files, as long as no field listed here is removed or redefined.

## Subscription

`src/models/subscription.ts`

| Field | Type | Required | Rule |
|---|---|---|---|
| `type` | `'keyword' \| 'author' \| 'arxivCategory'` | Yes | FR-001. Exactly one of the three; any other value is rejected. |
| `value` | `string` | Yes | FR-002. The raw keyword / author name / arXiv category code being tracked. |
| `label` | `string` | Yes | FR-003. Human-readable display label, distinct from `value` (may equal it in content). |
| `checkIntervalHours` | `CheckIntervalHours` (`6 \| 12 \| 24 \| 48 \| 72`) | Yes | FR-004/FR-005. Any other number is rejected; on rejection the prior valid value is kept (caller's responsibility — see contract). Default when unset: `24` (Assumptions). |
| `lastCheckedAt` | `number \| null` (epoch ms) | Yes (field always present) | FR-006. `null` before the subscription has ever been checked. |
| `enabled` | `boolean` | Yes | FR-007. Whether the subscription is currently active. |

**Identity**: A subscription's identity (how two subscription records are recognized as "the same subscription") is not defined by this spec — it is out of scope until the subscription-management feature (`260702-002`) specifies how subscriptions are listed/deleted.

**Validation**: `isValidSubscription(data: unknown): data is Subscription` — true only when every field above is present with a value satisfying its rule (SC-002).

**Interval assignment**: `assignCheckInterval(current: CheckIntervalHours, requested: number): CheckIntervalHours` — returns `requested` if it's one of the five allowed values, otherwise returns `current` unchanged (FR-005, Edge Cases).

## Paper

`src/models/paper.ts`

| Field | Type | Required | Rule |
|---|---|---|---|
| `title` | `string` | Yes | FR-008. |
| `publicationYear` | `number` | Yes, never empty | FR-009. The one hard, non-empty-required field. A `PaperCandidate` (pre-validation) may have this `undefined`; a `Paper` never does. |
| `authors` | `string[]` | Yes (may be empty array) | FR-008. |
| `citationCount` | `number` | Yes (may be `0`) | FR-008. `0` is how downstream feature `260702-004` detects "nobody has cited yet." |
| `abstract` | `string` | Yes (may be empty string) | FR-008. |
| `sourceId` | `PaperSourceId` (`` `${SourceProvider}:${string}` ``) | Yes | FR-008/FR-015. Globally unique per paper; encodes the originating provider (`'arxiv' \| 'semanticScholar'`). This is the paper's deduplication key. |
| `references` | `PaperSourceId[]` | Yes (field present; may be empty `[]`) | **FR-016 additive extension**, not an original FR-008 field. Outbound citations — the sourceIds of the papers this one *cites*. Fixed here so features `260702-002`/`003`/`006` share one definition; see note below. |

**Two related shapes**:
- `PaperCandidate`: everything above except `publicationYear`, which is `number | undefined` — represents a paper as collected, before the "hold back" rule is applied.
- `Paper`: the validated shape above, where `publicationYear` is always a `number`.

**Hold-back rule** (FR-010, Edge Cases): `toPaper(candidate: PaperCandidate): Paper | undefined` returns `undefined` when `candidate.publicationYear` is missing — the paper is *not* discarded (the caller retains the `PaperCandidate` and may retry `toPaper()` later once a year is known), it simply never becomes a `Paper`. This addresses only a *successful* collection whose record lacks a year (where re-calling the provider would return the same missing value), **not** a failed API call — that is re-called by the collection feature. The held-back candidate is scoped to the current in-memory collection pass; this feature persists no pending/retry store (see Clarifications, Session 2026-07-04).

**Validation**: `isValidPaper(data: unknown): data is Paper` — true only when every field above is present and `publicationYear` is a `number` (SC-003).

**Deduplication**: `isPaperSourceId(value: string): value is PaperSourceId` and equality on `sourceId` is the full extent of this spec's deduplication guarantee (SC-005). Recognizing the same underlying paper issued different IDs by two different providers is explicitly out of scope (Clarification 2026-07-02).

**Citation relationships** (`references`, added 2026-07-03 as an FR-016 extension): stored **outbound-only** — each paper records the sourceIds of the papers it cites. The graph-conversion feature (`260702-006`) builds directional edges `A→B` from `A.references`, and derives `citedBy` by inverting the edge set at build time; a bidirectional `citedBy` field is deliberately **not** stored, to avoid having to keep two note files in sync per relationship. `isValidPaper` requires `references` to be an array of valid `PaperSourceId`s (empty is valid). Note that arXiv exposes no citation graph — citation data originates only from Semantic Scholar — and a `references` entry pointing to a paper absent from the vault is a dangling edge for `260702-006` to skip, not an error here. Populating `references` belongs to the collection/note-saving features; this spec fixes only its shape.

## Plugin Settings

`src/models/settings.ts`

| Field | Type | Required | Rule |
|---|---|---|---|
| `storageLocation` | `string` | Yes, concrete & non-empty | FR-011. Vault-relative folder path. Default: `'PaperGraph3D'` (Assumptions) — resolved automatically, no setup required. |
| `summarizationEnabled` | `boolean` | Yes | FR-012. Default: `false` (Assumptions — off until explicit opt-in, per constitution Principle IV). |
| `graphDisplayOptions` | `GraphDisplayOptions` (open-ended object) | Yes | FR-013. Default values are placeholders the future graph-display feature may extend/refine (Assumptions, FR-016). |

**Defaults**: `DEFAULT_PLUGIN_SETTINGS: PluginSettings` — a fully-populated constant satisfying all three fields above, so settings are always complete even before a person changes anything (SC-004).

**Validation**: `isValidPluginSettings(data: unknown): data is PluginSettings` — true only when all three groups are present (SC-004).

## Cross-entity notes

- None of these three entities reference each other by type (e.g., `Subscription` does not embed `Paper[]`) — associations between a subscription and the papers it discovered are a concern for the collection feature (`260702-002`), not this spec.
- Every validator follows the same shape — `(data: unknown) => data is T` — so callers get a TypeScript type guard, not just a boolean, narrowing `unknown` input (e.g., from `JSON.parse` or `loadData()`) directly to the entity type on success.
