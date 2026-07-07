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
| `publicationYear` | `number` | Yes, never empty | FR-009. The one hard, non-empty-required field; must be **finite** (`NaN`/`Infinity` are held back). A `PaperCandidate` (pre-validation) may have this `undefined`; a `Paper` never does. |
| `authors` | `string[]` | Yes (may be empty array) | FR-008. |
| `citationCount` | `number` | Yes (may be `0`) | FR-008. `0` alone does NOT mean "nobody has cited yet" — see `citationsKnown` below; downstream feature `260702-004` MUST check both fields together. |
| `citationsKnown` | `boolean` | Yes | FR-018. `true` when `citationCount`/`references` came from a citation-aware provider (a stored `0` then means "confirmed uncited"); `false` when the paper was promoted without that data (a stored `0` then means "unknown, not confirmed"). Never a hold-back trigger — see below. |
| `abstract` | `string` | Yes (may be empty string) | FR-008. |
| `sourceId` | `PaperSourceId` (`` `${SourceProvider}:${string}` ``) | Yes | FR-008/FR-015. Globally unique per paper; encodes the originating provider (`'arxiv' \| 'semanticScholar'`). This is the paper's deduplication key. |
| `references` | `PaperSourceId[]` | Yes (field present; may be empty `[]`) | **FR-016 additive extension**, not an original FR-008 field. Outbound citations — the sourceIds of the papers this one *cites*. Fixed here so features `260702-002`/`003`/`006` share one definition; see note below. |
| `embedding` | `number[] \| null` | Yes (field present; `null` = pending) | **FR-019 (core, 2026-07-07)**. L2-normalized content vector over title + abstract. `null` when not yet computed; never a hold-back trigger (FR-021). Populated by `260702-002` (local baseline) / optionally `260702-004` (LLM). |
| `embeddingModel` | `string \| null` | Yes (field present) | **FR-020**. Model identifier + version that produced `embedding`; `null` when pending. Only papers sharing one `embeddingModel` may be projected together (`260702-006`). |
| `embeddingSource` | `'local' \| 'llm' \| null` | Yes (field present) | **FR-020**. Provenance of `embedding`; `null` when pending. Mirrors the `citationsKnown` provenance pattern. |

**Two related shapes**:
- `PaperCandidate`: everything above except `publicationYear`, which is `number | undefined` — represents a paper as collected, before the "hold back" rule is applied. Its `embedding`/`embeddingModel`/`embeddingSource` are also `… | undefined` (not yet computed at collection time).
- `Paper`: the validated shape above, where `publicationYear` is always a `number`.

**Hold-back rule** (FR-010, Edge Cases): `toPaper(candidate: PaperCandidate): Paper | undefined` returns `undefined` when `candidate.publicationYear` is missing or non-finite (`NaN`/`Infinity`) — the paper is *not* discarded (the caller retains the `PaperCandidate` and may retry `toPaper()` later once a year is known), it simply never becomes a `Paper`. This addresses only a *successful* collection whose record lacks a year (where re-calling the provider would return the same missing value), **not** a failed API call — that is re-called by the collection feature. The held-back candidate is scoped to the current in-memory collection pass; this feature persists no pending/retry store (see Clarifications, Session 2026-07-04). **Publication year is the only hold-back trigger** (FR-018, Clarification Session 2026-07-05) — a candidate's citation count/references being unknown never holds it back; `toPaper()` instead sets `citationsKnown: candidate.citationCount !== undefined` and defaults an unknown `citationCount` to `0` and unknown `references` to `[]`, preserving the unknown-vs-zero distinction on the promoted `Paper` rather than losing it. This is what lets a windowed collection process (`260702-002`) persist a paper immediately instead of losing it when a search window advances past an unenriched candidate. The content embedding is likewise never a hold-back trigger (FR-021): `toPaper()` carries `embedding`/`embeddingModel`/`embeddingSource` through, defaulting any that are `undefined` to `null` (pending), to be filled by `260702-002` (local baseline) / `260702-004` (optional LLM).

**Validation**: `isValidPaper(data: unknown): data is Paper` — true only when every field above is present, `publicationYear` is a finite `number`, `citationCount` is a finite, non-negative `number`, and `citationsKnown` is a `boolean` (FR-009/FR-017/FR-018, SC-003). `embedding` MUST be `null` or an array of finite numbers; `embeddingModel` MUST be `null` or a string; `embeddingSource` MUST be `null`, `'local'`, or `'llm'` (FR-019/FR-020) — a pending (`null`) embedding is still valid.

**Deduplication**: `isPaperSourceId(value: string): value is PaperSourceId` and equality on `sourceId` is the full extent of this spec's deduplication guarantee (SC-005). Recognizing the same underlying paper issued different IDs by two different providers is explicitly out of scope (Clarification 2026-07-02).

**Citation relationships** (`references`, added 2026-07-03 as an FR-016 extension): stored **outbound-only** — each paper records the sourceIds of the papers it cites. The graph-conversion feature (`260702-006`) builds directional edges `A→B` from `A.references`, and derives `citedBy` by inverting the edge set at build time; a bidirectional `citedBy` field is deliberately **not** stored, to avoid having to keep two note files in sync per relationship. `isValidPaper` requires `references` to be an array of valid `PaperSourceId`s (empty is valid). Note that arXiv exposes no citation graph — citation data originates only from Semantic Scholar — and a `references` entry pointing to a paper absent from the vault is a dangling edge for `260702-006` to skip, not an error here. Populating `references` belongs to the collection/note-saving features; this spec fixes only its shape.

**Content embedding** (`embedding`/`embeddingModel`/`embeddingSource`, added 2026-07-07 as core fields, FR-019/FR-020/FR-021): a fixed-length, L2-normalized numeric vector over the paper's title + abstract, plus its model/provenance metadata. It is a **required core field** (not an FR-016 add-on) but is **never a hold-back trigger** — a paper is valid with a pending (`null`) embedding, mirroring how `citationsKnown` preserves an unknown-vs-confirmed distinction. The baseline vector is computed locally by `260702-002` at promotion (offline, no credentials); an optional LLM provider (`260702-004`) may replace it, setting `embeddingSource: 'llm'`. Only embeddings sharing one `embeddingModel` may be compared/projected together, so switching providers requires re-embedding the corpus. The graph-conversion feature (`260702-006`) projects these vectors to 2D (x,y) for the similarity layout, with the publication-year axis kept separate. This spec fixes only the shape and validation; computing and storing the vector belongs to `260702-002`/`003`/`004`.

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
