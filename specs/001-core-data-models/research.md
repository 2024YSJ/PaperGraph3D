# Phase 0 Research: Core Data Structures

All `[NEEDS CLARIFICATION]` items from the spec were already resolved during `/speckit-clarify` (see `spec.md` § Clarifications). The research below covers the remaining *technical* decisions needed to turn the spec's business rules into a concrete TypeScript design, informed by how the eight downstream feature notes (subscription collection, note-saving, summarization, refresh, graph-data conversion, 3D visualization, plugin assembly) will actually consume this data.

## 1. Verifying the data model without a test framework

**Decision**: No test runner is added. Verification relies on (a) `tsc --noEmit` (already gating `npm run build`) for structural/type correctness, and (b) a manual `quickstart.md` script, executed once via the existing `esbuild` devDependency (`npx esbuild <script>.ts --bundle --platform=node --outfile=<tmp>.js && node <tmp>.js`), that exercises the exported validators against representative valid/invalid records and prints pass/fail.

**Rationale**: `CLAUDE.md` states plainly that "there is no test suite/script configured in this repo," and the constitution's Development Workflow gate only requires `npm run build` and `npm run lint` to pass. Introducing a test runner (or a new devDependency like `ts-node`/`tsx`) is a repo-wide tooling decision that a single foundational "define the data shapes" feature shouldn't make unilaterally. Using `esbuild` — already a devDependency, already used to bundle the plugin — to run a throwaway validation script needs zero new dependencies and works identically across the Node 20/22/24 CI matrix.

**Alternatives considered**:
- *Add `node:test` + an `npm test` script*: rejected — still requires deciding a repo-wide convention (file naming, `npm test` wiring, CI workflow changes) that's out of scope for a data-definition feature; better decided once a feature exists that actually has behavior worth regression-testing.
- *Add `ts-node`/`tsx` as a devDependency*: rejected — new dependency weight for a single feature's manual verification need.
- *Rely on TypeScript types alone, no runtime validators*: rejected outright — it directly contradicts the spec. `SC-002`/`SC-003`/`SC-005` require that invalid data (missing fields, disallowed check interval, colliding source IDs) be *identifiable at runtime*, which compile-time-only types cannot do once data crosses a boundary (e.g., loaded from `loadData()` or an external API response) that isn't type-checked.

## 2. Representing the restricted check-interval enum

**Decision**: `type CheckIntervalHours = 6 | 12 | 24 | 48 | 72;` paired with a runtime-readable constant `export const ALLOWED_CHECK_INTERVALS_HOURS: readonly CheckIntervalHours[] = [6, 12, 24, 48, 72] as const;`. Validation (`FR-005`) checks membership in this array, not just the TS type, since callers may pass arbitrary numbers (e.g., from settings UI input or persisted JSON) that TypeScript's compile-time union can't stop.

**Rationale**: TypeScript union types are erased at runtime — a `number` arriving from `JSON.parse` or a UI text field has no compile-time guarantee of being one of the five values. Pairing the literal-union type (for compile-time ergonomics when constructing data in code) with an exported array (for runtime membership checks) is the standard TS pattern for "closed set validated at both compile time and runtime."

**Alternatives considered**:
- *String enum (`'6h' | '12h' | ...`)*: rejected — the spec phrases the interval purely in hours as a number ("6 hours, 12 hours, ..."); a plain numeric union needs no string-parsing/formatting layer downstream.
- *TypeScript `enum`*: rejected — numeric TS enums complicate the "restricted to these five values" runtime check (reverse mappings, extra allowed numeric values under `enum`'s loose numeric checking) versus a plain literal union + array.

## 3. Modeling the "hold back" rule for papers missing a publication year

**Decision**: Two related types — `PaperCandidate` (what a collection feature has *before* validation: `publicationYear` is `number | undefined`) and `Paper` (the validated shape from the spec, where `publicationYear: number` is always present) — bridged by `function toPaper(candidate: PaperCandidate): Paper | undefined`, which returns `undefined` (i.e., "held back," not created) when the year is missing or non-finite (`NaN`/`Infinity`).

**Rationale**: This directly encodes `FR-009`/`FR-010`/the spec's Edge Cases entry ("held back — not created as a valid paper record — rather than being permanently discarded") as a type-level invariant: once a value has type `Paper`, its `publicationYear` is guaranteed present, so every downstream feature (note-saving, refresh, graph conversion) that consumes `Paper` never needs to re-check for a missing year. The `undefined` return (rather than throwing) matches "held back to be reconsidered later" — the caller keeps the raw candidate and can retry `toPaper()` on a later collection pass once a year becomes available, rather than the data being destroyed.

**Alternatives considered**:
- *Make `publicationYear` optional on `Paper` itself and check it everywhere it's used*: rejected — reintroduces the missing-year check into every downstream feature, which is exactly what a shared foundational type should prevent (spec `SC-001`).
- *Throw an exception for a missing year*: rejected — "held back" implies the data is retained for a possible future retry, not an error condition to propagate/crash on; a plain `undefined` return is the natural "not yet valid" signal for a pure function.

**Scope of the "hold back" fallback** (clarified spec Session 2026-07-04): `PaperCandidate`/`toPaper()` is *not* a retry mechanism for a failed API call — those are two different failure modes at two different layers:

1. *API call fails* (network error, timeout, rate limit, 5xx): no/partial response. The correct response is to re-call. This is the collection feature's (`002`) concern, not this feature's — `PaperCandidate` plays no role.
2. *API call succeeds but the record has no publication year* (e.g. arXiv preprints or Semantic Scholar records with a null year): re-calling the same provider is pointless — it deterministically returns the same missing year. This is the only case `toPaper()` addresses. The year is expected to arrive later from a *different* path (a preprint that is subsequently published, a second provider that has the year, or a later metadata-enrichment pass), which is why the already-fetched title/authors/abstract/citations are kept rather than discarded and re-fetched.

The held-back candidate's lifetime is scoped to a single collection pass **in memory** — `toPaper()` is a pure function that persists nothing, and this feature does not add any pending/retry store. Re-evaluation is delegated to the next scheduled subscription check, which re-fetches and re-runs the gate. Whether a held-back candidate is ever persisted or queued for retry across sessions is explicitly out of scope for 001 and left to the collection feature. This is why the fallback is modeled as a *type* (the pre-validation `PaperCandidate` shape) plus a *gate* (`toPaper()`), not as storage: 001 fixes only the shared shape and the single validation boundary so the eight downstream features never re-implement "is the year missing?" inconsistently (`SC-001`).

**Why citation data is never a hold-back reason, and why `citationsKnown` exists** (clarified spec Session 2026-07-05, FR-018): `002` collects under a *windowed* search (each subscription's `lastCheckedAt` advances forward and is never re-searched). If missing/unenriched citation data held a candidate back the same way a missing year does, that paper would fall out of the search window the moment `lastCheckedAt` advances and could never be re-surfaced by a normal scheduled check — an enrichment failure (provider down, rate-limited, not yet indexed, or an unresolved cross-provider identity match) would silently and permanently lose an otherwise-complete paper. Extending the hold-back rule to citation data was considered and rejected for exactly this reason.

Instead, `toPaper()` always promotes a candidate that has a year, and defaults an unknown `citationCount`/`references` to `0`/`[]` as before — but now also sets `citationsKnown: candidate.citationCount !== undefined`, carrying the candidate's unknown-vs-zero distinction onto the `Paper` instead of letting the `?? 0` default erase it. This means the persisted paper itself (once written by `003`) becomes the durable record of "still needs enrichment" — `005`'s manual refresh (or any future auto-heal sweep) can target exactly the `citationsKnown === false` papers directly from storage, with no need to re-scan any collection window to find them.

**Alternatives considered**:
- *Hold back on missing citation data too, same as year*: rejected — causes permanent, silent paper loss under windowed collection, as above.
- *A tri-state status enum (e.g. `'confirmed' | 'unavailable' | 'unenriched'`) instead of a boolean*: considered, to distinguish "enrichment attempted and failed" from "enrichment never attempted." Rejected for 001 as unnecessary complexity — downstream consumers (`004`/`007`) only ever need the binary "is this citation count trustworthy," and a finer-grained attempt/outcome history (if ever needed for retry bookkeeping) belongs in the collection feature's own operational state, not in the shared `Paper` shape.

## 4. Encoding a provider-tagged, globally-unique `sourceId`

**Decision**: `type SourceProvider = 'arxiv' | 'semanticScholar';` and `type PaperSourceId = \`${SourceProvider}:${string}\`;` (a TypeScript template literal type), with a runtime helper `isPaperSourceId(value: string): value is PaperSourceId` that checks for a recognized `provider:` prefix.

**Rationale**: Directly implements the clarification answer for `FR-015` — uniqueness is guaranteed because two different providers can never produce the same prefix, and the prefix is visible directly in the identifier (useful for debugging, logging, and for later features like the 3D-view's "copy source link" action to dispatch on provider without a separate lookup). The provider union is named after the two providers downstream spec `002` explicitly names (arXiv, Semantic Scholar); per the spec's extensibility clarification (`FR-016`), adding a third provider later is an additive change to this one union, not a redefinition of the `Paper` shape.

**Alternatives considered**:
- *Opaque `sourceId: string` with no structure*: rejected by the clarification answer — leaves cross-provider collisions merely "unlikely," not structurally impossible.
- *A separate `provider` field alongside a bare id*: considered viable, but the template-literal-string form keeps `sourceId` a single value usable directly as a natural unique key/filename-safe token (relevant to downstream feature `003`'s "note filenames must prevent collisions"), while still letting code cheaply extract the provider by splitting on `:`.

## 5. Module layout

**Decision**: One file per entity under a new `src/models/` directory (`subscription.ts`, `paper.ts`, `settings.ts`), each exporting its type(s), any constants, and its own validator function(s). No barrel `index.ts` is added since nothing yet imports these modules (out of scope for this feature).

**Rationale**: Matches constitution Principle VI ("focused, single-responsibility modules under `src/`... e.g. `commands/`, `ui/`, `utils/`") and keeps each file comfortably under the ~300-line reconsideration threshold. `src/models/` is a natural sibling to the `commands/`/`ui/`/`utils/` examples the constitution already names.
