# Implementation Plan: Paper Summarization & Future-Directions Text

**Branch**: `004-paper-summarization` | **Date**: 2026-07-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-paper-summarization/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

This feature adds two independent, opt-in LLM-backed enrichments to a paper as it is collected: (1) a generated **summary** replacing the raw abstract in the note's managed region, with a **future-directions** description added when the paper is uncited (`citationCount === 0`), and (2) an optional **upgrade of the paper's content embedding** to an external LLM embedding when the user explicitly selects the LLM API as the corpus's canonical embedding provider (001 FR-022). Both are strictly additive: with everything off, collection and persistence work exactly as 002/003 already implement them, using the abstract and the mandatory bundled-baseline embedding (002 FR-044).

This plan is written against the **already-merged, real** 002/003 implementations on `develop` (commit `899abca`), not a hypothetical interface — 002's `PipelineHooks.summarize` seam (`src/collection/types.ts`) and 002's three-provider embedding dispatcher (`src/collection/embeddingUpgrade.ts`, `src/collection/reembed.ts`) already exist, tested and wired into `main.ts`, with an explicit stub at each point where this feature plugs in ("the LLM upgrade is a 004-owned hook stubbed until 004 ships"). 004's job is therefore narrowly scoped: implement the two functions those seams call, extend the two settings fields 004 owns (summarization provider/credential, LLM embedding credential), and make the two small, additive edits to already-merged 002 files that complete the stubs. 004 never performs file I/O (003's job) and never re-embeds the corpus itself (002's `reembedCorpus`, already implemented, does that); it only returns generated text or a vector, or a typed failure, and hands off.

## Technical Context

**Language/Version**: TypeScript 5.8, `strict: true` (existing `tsconfig.json`: ES2021 target, ESNext modules, `noUncheckedIndexedAccess`)

**Primary Dependencies**: None new. LLM text generation and LLM embedding both call an HTTP API — done via Obsidian's `requestUrl` (already used by 002's provider clients), never `fetch`, for desktop/mobile parity and to avoid CORS. Reference provider implementation targets OpenAI's Chat Completions and Embeddings REST endpoints (OQ-2/OQ-5, research.md); the provider abstraction is generic so a second provider (Claude, Gemini) is an additive module, not a rewrite.

**Storage**: This feature persists nothing itself. Generated summary/future-directions text and an upgraded embedding are handed to 003's `PaperStore.upsert()` as part of the single `PersistInput` 002 already builds (`paper`, `summary`, `futureDirections`) — 003's existing field-scoped merge (`wrap()`/`mergePaper()`) and abstract-fallback rendering (`renderProse()`) require no changes. Settings additions (`summarizationProvider`, `summarizationCredential`, `embeddingCredential`) persist through the existing `PluginSettings` blob (001), as additive optional fields.

**Testing**: No test runner is configured in this repo (matches 001/002/003). Correctness is verified via `tsc --noEmit`, `eslint .`, and a manual `quickstart.md` walkthrough (a stubbed-HTTP scratch script run via `esbuild`+`node`, no live network call) covering: summary generation success/failure/timeout/empty-short-fallback, future-directions gating on `citationCount === 0`, credential-invalid messaging, in-flight discard on toggle-off, LLM embedding success/failure/timeout/invalid-vector, and the `embeddingModel` naming contract (`llm:<model>:d<dim>`) that 002's `reembedCorpus`/`isCanonical` depend on.

**Target Platform**: Obsidian **desktop only** (constitution v1.2.0, Principle I exception — already ratified for 002's local-transformer/LLM embedding work; this feature's LLM calls are desktop-only by the same exception, no new mobile-compatibility burden since 004 introduces no additional platform constraint beyond what 002 already established).

**Project Type**: Obsidian community plugin — single TypeScript bundle via esbuild (matches existing `src/main.ts` entry point).

**Performance Goals**: N/A hard targets. The binding constraint is FR-007/FR-012: a slow or hung provider call MUST NOT stall collection — every generation/embedding call is wrapped in a bounded timeout (research.md Decision: 20s) via `AbortSignal`, matching the failure-classification pattern 002's own provider clients use.

**Constraints**: MUST NOT block note/record creation on any failure (FR-007/FR-012) — abstract/local-baseline fallback always applies. MUST send only `title`+`abstract` (+ for embedding, the same two fields) to a provider — never the full `Paper`, never references, never other users' data (data-minimization, constitution Principle IV). Credentials are stored in plaintext in the plugin's settings blob (same as 002's `semanticScholarApiKey` precedent) and MUST be disclosed in settings UI copy (008's job to place, 004's job to author the copy) per Principle IV and FR-013. MUST NOT self-trigger — only 002's pipeline invokes this feature's hooks, before persistence, once per paper (spec Assumptions).

**Scale/Scope**: A new `src/services/summarization/` directory (matching 003's `src/persistence/` precedent for module layout) plus two small, additive edits to already-merged 002 files (`src/collection/embeddingUpgrade.ts`, `src/collection/reembed.ts`) and one additive edit to `src/main.ts` (wiring the `summarize` hook and threading the LLM embedding credential — mirroring how 002 already wired `reembedCorpus`/`getEmbeddingConfig`). `src/models/settings.ts` gains three optional fields.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applicability | Assessment |
|---|---|---|
| I. Obsidian Platform Compliance | Applies | All HTTP calls use `requestUrl` (obsidian package), matching 002's provider-client precedent; desktop-only is already the ratified platform decision (v1.2.0) that this feature's LLM calls fall under, alongside 002's local-transformer/LLM embedding work. **Pass.** |
| II. Lifecycle-Safe Resource Management | Applies | This feature registers no listeners, intervals, or timers of its own — every call is a single awaited `requestUrl` bounded by an `AbortSignal` timeout, invoked synchronously within 002's already-lifecycle-safe pipeline loop. No new teardown obligation. **Pass.** |
| III. Manifest Identity Stability | N/A | `manifest.json` untouched. **Pass (vacuous).** |
| IV. Transparent Use of Sensitive APIs | Applies (NON-NEGOTIABLE data path) | Both toggles (summarization, LLM embedding upgrade) are off by default (FR-001, 001 FR-022 default `bundled`); enabling either requires explicit settings action + credentials; only `title`+`abstract` ever leaves the vault, never the full record; settings UI copy (authored by 004, placed by 008) MUST disclose what is sent, to whom, and that credentials are stored in plaintext — now a spec-level requirement (FR-013), backed by `constants.ts`'s `SUMMARIZATION_DISCLOSURE_COPY` and carried into tasks.md as an explicit deliverable (T006/T023) (research.md §12 records the disclosure-copy rationale). **Pass — FR-013 plus its T006/T023 implementation/verification close the documentation obligation, exactly like 002's Principle IV entry.** |
| V. Bilingual UX, English-Only Code | Applies | Credential-invalid / generation-unavailable user notices MUST be understandable to both Korean- and English-speaking users (matching `main.ts`'s existing bilingual `Notice` pattern for 002's subscription-failure copy); code/comments stay English. **Pass — carried into UX copy tasks.** |
| VI. Open-Source Code Quality & Extensibility | Applies | Provider abstraction (`SummarizationProvider`/`LlmEmbeddingProvider` interfaces) keeps `providers/openai.ts` swappable — adding Claude/Gemini later is a new file, not a rewrite. All new logic lives under `src/services/summarization/`, never in `main.ts` (which gains only wiring calls). **Pass.** |

No violations identified. Complexity Tracking table below is not needed.

**Post-Phase-1 re-check**: `data-model.md`, `contracts/summarization-api.md`, and `quickstart.md` were reviewed against the same six principles after design. The two edits to already-merged 002 files (`embeddingUpgrade.ts`'s `case 'llm'`, `reembed.ts`'s no-op guard removal) are additive completions of an explicitly-anticipated stub, not a redesign of 002 — they change no existing behavior for the `bundled`/`local-transformer` paths and add no new listener/timer. The settings-UI disclosure copy obligation (Principle IV) is captured as explicit tasks in tasks.md. No new violations were introduced by the detailed design.

## Project Structure

### Documentation (this feature)

```text
specs/004-paper-summarization/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/            # Phase 1 output (/speckit-plan command)
│   └── summarization-api.md
└── tasks.md              # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── main.ts                             # existing — gains: wire pipelineHooks.summarize (currently omitted per its own comment awaiting 004); thread settings.embeddingCredential into the existing getEmbeddingConfig() getter
├── models/
│   └── settings.ts                     # existing (001, extended by 002) — gains THREE optional fields owned by 004: summarizationProvider?, summarizationCredential?, embeddingCredential? (FR-016-style additive extensions, mirrors 002's semanticScholarApiKey/embeddingProvider precedent; validated in isValidPluginSettings; DEFAULT_PLUGIN_SETTINGS unchanged)
├── collection/                         # existing (002) — TWO small, additive edits completing an explicit stub, no other changes
│   ├── embeddingUpgrade.ts             # EmbeddingConfig gains credential?: string; case 'llm' calls this feature's llmEmbeddingUpgrade() instead of returning undefined
│   └── reembed.ts                      # removes the `if (config.provider === 'llm') return summary;` no-op guard (its own comment: "Removed once the LLM provider ships")
└── services/
    └── summarization/                  # NEW — this feature's entire footprint
        ├── types.ts                    # this feature's OWN internal types: SummarizationProvider (text-gen interface), LlmEmbeddingProvider (embedding interface — deliberately NOT named EmbeddingProvider, which 002's settings.ts already owns for the 3-way selector), GenerationResult/GenerationFailureReason, EmbeddingUpgradeResult/EmbeddingFailureReason
        ├── constants.ts                # timeout (20s), too-short threshold (research.md), embeddingModel prefix helper (`llm:`)
        ├── generate.ts                 # runGeneration() (summary + future-directions text, fallback/timeout/empty-short classification) and runEmbeddingGeneration() (LLM embedding, vector validation) — pure functions over an injected provider, no Obsidian imports (offline-testable)
        ├── isUncited.ts                # isUncited(input: { citationsKnown: boolean; citationCount: number }): boolean — minimal structural shape, NOT tied to the full Paper type, reusable by 007
        ├── hook.ts                     # summarizeHook(input: SummarizationInput): Promise<SummaryResult | undefined> — the adapter matching 002's PipelineHooks['summarize'] EXACTLY (types imported from ../../collection/pipeline, never redefined); reads live provider/credential via injected getters; empty-string futureDirections sentinel when not applicable (003's renderProse() already treats this as "skip")
        ├── embeddingHook.ts            # llmEmbeddingUpgrade(title, abstract, credential): Promise<EmbeddingResult | undefined> — the adapter 002's embeddingUpgrade.ts case 'llm' calls; EmbeddingResult type imported from ../../collection/embedding (the exact shape 002's dispatcher/reembed already expect), embeddingModel formatted as `llm:<model>:d<dim>` (load-bearing for reembed.ts's isCanonical() prefix check)
        └── providers/
            └── openai.ts                # openAiProvider: SummarizationProvider (chat completions) + openAiEmbeddingProvider: LlmEmbeddingProvider (embeddings endpoint), both via requestUrl
```

**Structure Decision**: Single project, no frontend/backend split. New logic lives entirely under `src/services/summarization/`, mirroring 003's `src/persistence/` and 002's `src/collection/` single-responsibility-module precedent — `main.ts` gains only wiring calls (two lines: the `summarize` hook, the embedding-credential getter field), never feature logic (constitution Principle VI). The two edits to `src/collection/embeddingUpgrade.ts`/`reembed.ts` are the narrowest possible completion of an already-designed, already-coded stub (both files already contain the exact case branch and a comment naming 004 as the owner) — 004 does not redesign 002's dispatcher, `EmbeddingConfig` shape, or re-embedding orchestration, all of which are already implemented and tested. `src/models/settings.ts` is extended, not owned, by 004 — same pattern 002 already used for `semanticScholarApiKey`/`embeddingProvider`/`localEmbeddingModel`.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

Not applicable — the Constitution Check above found no violations.
