---

description: "Task list for Paper Summarization & Future-Directions Text"
---

# Tasks: Paper Summarization & Future-Directions Text

> **[Amended 2026-07-16 — the LLM embedding half of this feature is withdrawn]**
>
> Everything below about **embeddings** — `LlmEmbeddingProvider`, `embeddingHook.ts`,
> `runEmbeddingGeneration`, `openAiEmbeddingProvider`, `llmEmbeddingModelId`, the
> `llm:<model>:d<dim>` naming contract, `EmbeddingConfig.credential`, the
> `embeddingCredential` setting, and the independent embedding toggle — **no longer
> applies**. That code is deleted and FR-010/FR-011/FR-012 are withdrawn.
>
> Why: embedding dimensionality varied by provider and model, but only vectors sharing
> one space can be projected together (001 FR-020) — a selectable provider was a
> selectable dimensionality. The canonical space is now one fixed on-device model
> (SPECTER2), owned by 002. See constitution v1.3.0 and 002 FR-045/FR-046.
>
> **Summarization is unaffected** and everything below about generating summary text
> — the provider abstraction, the three providers, the timeout/fallback rules, the
> disclosure copy — is still current.

**Input**: Design documents from `/specs/004-paper-summarization/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/summarization-api.md, quickstart.md

**Tests**: Not explicitly requested in `spec.md`. `plan.md`/`research.md` follow 001/002/003's precedent of no test framework in this repo. Correctness relies on `tsc --noEmit`, `eslint .`, and the manual `quickstart.md` walkthrough (stubbed `SummarizationProvider`/`LlmEmbeddingProvider`, no live network) — see the Polish phase.

**Organization**: Tasks are grouped by user story per `spec.md`'s priorities (Opt in to summaries = P2/US1, Future directions for uncited recent papers = P3/US2, Configure provider and credentials = P2/US3) so each can be implemented and verified independently. US1 and US3 share priority P2; US3 is sequenced first because US1's own independent test requires a configured (stubbed) provider/credential pair to exist, and US3 is also where this feature's other opt-in surface — the LLM embedding upgrade (FR-010/FR-011/FR-012, no dedicated user story of its own but scoped under the "Summarization Settings" key entity alongside provider/credential configuration) — is implemented, since it shares US3's settings surface and provider-swap requirement (Principle VI).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Every description includes the exact file path

## Path Conventions

Single project (this repo is one Obsidian plugin bundle, no frontend/backend split). All new files live under `src/services/summarization/`, per `plan.md`'s Project Structure. Four existing files are touched: `src/models/settings.ts` (Foundational phase, three additive optional fields — T004), `src/collection/embeddingUpgrade.ts` and `src/collection/reembed.ts` (US3 phase, completing an already-anticipated stub — T014, T015), and `src/main.ts` (US1/US3 phases, wiring the `summarize` hook and the `embeddingCredential` getter — T011, T015); no other existing file is modified.

---

## Phase 1: Setup

**Purpose**: Confirm a clean baseline before adding new files.

- [X] T001 Create the `src/services/summarization/` and `src/services/summarization/providers/` directories and confirm `npm run build` and `npm run lint` both still pass on the unmodified baseline (with 001/002/003's code already present, including the explicit `case 'llm':` stubs in `src/collection/embeddingUpgrade.ts`/`src/collection/reembed.ts`, per research.md §8), so any later failure is known to come from this feature's new code

**Checkpoint**: Baseline confirmed clean — safe to start adding summarization modules.

---

## Phase 2: Foundational

**Purpose**: Blocking prerequisites shared by every user story — the shared type vocabulary, the uncited-detection helper, the too-short/timeout constants, and the three new settings fields all three stories' phases read from.

- [X] T002 [P] Define this feature's own internal types in `src/services/summarization/types.ts` — `SummarizationProvider` (text-gen interface: `id`, `generate(input: SummarizationInput, credential, signal): Promise<{ summary, futureDirections? }>`, importing `SummarizationInput` from `../../collection/pipeline`), `GenerationFailureReason`/`GenerationOutcome`, `LlmEmbeddingProvider` (embedding interface: `id`, `embed(title, abstract, credential, signal): Promise<{ vector, model }>` — deliberately NOT named `EmbeddingProvider`, which `src/models/settings.ts` already owns for the 3-way selector, research.md §8), `EmbeddingFailureReason`/`EmbeddingOutcome` — per `data-model.md` §2 (verbatim code block)
- [X] T003 [P] Implement `isUncited(input: UncitedCheckInput): boolean` in `src/services/summarization/isUncited.ts` — returns `true` only when `citationsKnown && citationCount === 0`; an un-enriched `citationCount === 0` with `citationsKnown === false` is NOT uncited (spec Edge Cases, 002 FR-016/FR-018) — per `data-model.md` §4 and `contracts/summarization-api.md` § isUncited.ts (FR-004; structurally satisfied by both `SummarizationInput` here and a future full `Paper`, no cast, research.md §9)
- [X] T004 [P] Add three optional fields to `PluginSettings` in `src/models/settings.ts`: `summarizationProvider?: string` (FR-006, which `SummarizationProvider.id` to use — absent means "not configured" even if `summarizationEnabled` is `true`), `summarizationCredential?: string` (FR-006, plaintext, disclosed per constitution Principle IV / FR-013), `embeddingCredential?: string` (FR-010, independent of `summarizationCredential` per FR-011 — sharing is allowed, not required; this pair of independently-optional fields is what makes FR-011's "enabling either MUST NOT require the other" true at the settings-model level) — all FR-016-style additive extensions of 001's baseline, `DEFAULT_PLUGIN_SETTINGS` left unchanged (all three absent by default), and widen `isValidPluginSettings()` with three `undefined`-or-`string` checks matching the existing `semanticScholarApiKey` pattern — per `data-model.md` §3 (verbatim code block) (FR-006, FR-010, FR-011)
- [X] T005 [P] Define shared constants in `src/services/summarization/constants.ts`: the 20-second generation timeout (research.md §11), the 20-trimmed-character too-short/empty threshold applied independently to `summary` and `futureDirections` (research.md §5, data-model.md §2), and the `llm:` embeddingModel prefix helper used to format `` `llm:${modelId}:d${dimension}` `` (data-model.md §5 — binding, required by 002's already-merged `reembed.ts`'s `isCanonical()`)
- [X] T006 [P] Author the settings-UI disclosure copy (constitution Principle IV / FR-013 — what is sent to a provider, that only `title`+`abstract` ever leave the vault, and that credentials are stored in plaintext) as exported string constants in `src/services/summarization/constants.ts`, ready for 008 to place in the summarization settings section — English source strings only (constitution Principle V; Korean-facing translation is a bilingual-UX concern outside 004's code, per the existing `main.ts` `Notice` precedent) (FR-013)

**Checkpoint**: Shared types, `isUncited`, the three settings fields, and constants all exist — US1, US2, and US3 can each build on them independently.

---

## Phase 3: User Story 3 - Configure provider and credentials (Priority: P2)

**Goal**: Let the user select a summarization provider and enter credentials in settings, have those credentials actually used for generation, get informed on an invalid-credential failure rather than a silent one, and — sharing this same settings surface — optionally select the LLM API as the corpus's canonical embedding provider (FR-010/FR-011/FR-012) with its own independent credential.

**Independent Test**: Enter a (stubbed) provider and credentials, confirm they are threaded into a generation call; feed back a credential-rejection from the stub and confirm the user is informed; separately, confirm `llmEmbeddingUpgrade` invoked with a valid stubbed credential produces a correctly-`llm:`-prefixed `EmbeddingResult`, and with no credential resolves `undefined` without any call — per `quickstart.md` § Provider & credentials and § LLM embedding upgrade.

### Implementation for User Story 3

- [X] T007 [P] [US3] Implement `runGeneration(input, provider, credential): Promise<GenerationOutcome>` and `runEmbeddingGeneration(title, abstract, provider, credential): Promise<EmbeddingOutcome>` in `src/services/summarization/generate.ts` — both apply the 20s timeout (T005) via an `AbortSignal` passed to the provider's `generate`/`embed` call, classifying a post-abort rejection as `'timeout'`; neither ever throws — every provider-call rejection (network error, non-2xx, malformed JSON) is caught and classified into a `GenerationFailureReason`/`EmbeddingFailureReason` (`'invalid-credentials'` for a 401/403-style rejection, `'provider-error'` otherwise); `runGeneration` applies T005's too-short/empty threshold to `summary` unconditionally, applying the same threshold to `futureDirections` only when the outcome includes one (`generate.ts` itself is agnostic to `isUncited` — that gating lives in `hook.ts`, T009); `runEmbeddingGeneration`'s `EmbeddingOutcome.vector` must be a non-empty array of finite numbers (`Number.isFinite`), anything else is `'invalid-vector'` — per `contracts/summarization-api.md` § generate.ts and `data-model.md` §2 (FR-007, FR-008, FR-012; depends on T002, T005)
- [X] T008 [P] [US3] Implement `openAiProvider: SummarizationProvider` and `openAiEmbeddingProvider: LlmEmbeddingProvider` in `src/services/summarization/providers/openai.ts` — both call Obsidian's `requestUrl` (never `fetch`, matching every 002 provider client, constitution Principle I); `openAiProvider.generate` sends only `{ title, abstract }` (never `citationCount`/`citationsKnown`) via Chat Completions; `openAiEmbeddingProvider.embed` sends only `{ title, abstract }` via the Embeddings endpoint (`text-embedding-3-small`, research.md §4), and `model` in its resolved value is the raw OpenAI model id (`text-embedding-3-small`) — this provider stays ignorant of the `llm:<model>:d<dim>` naming contract, which is `embeddingHook.ts`'s job (T010) — per `contracts/summarization-api.md` § providers/openai.ts (FR-006; depends on T002)
- [X] T009 [US3] Implement `createSummarizeHook(config: SummarizeHookConfig): (input: SummarizationInput) => Promise<SummaryResult | undefined>` in `src/services/summarization/hook.ts` — this is the exact function signature `PipelineHooks['summarize']` requires (`main.ts` wires it with no adapter of its own, T011); returns `undefined` (never throws) when no provider is configured (`config.getProvider()` is `undefined`), no credential is configured (`config.getCredential()` is `undefined`/empty), generation times out, generation returns invalid credentials (calling `config.notifyCredentialProblem(message)` first, FR-008), or the summary is empty/too-short; only *summary* failure triggers the full `undefined` return — per `contracts/summarization-api.md` § hook.ts (FR-006, FR-007, FR-008; depends on T003, T007)
- [X] T010 [US3] Implement `llmEmbeddingUpgrade(title, abstract, credential, config?): Promise<EmbeddingResult | undefined>` in `src/services/summarization/embeddingHook.ts` — returns `undefined` (never throws) when `credential` is `undefined`/empty, the call times out, credentials are rejected, or the returned vector is invalid, matching `upgradeEmbedding()`'s existing `local-transformer` branch's "any failure → undefined, caller keeps the baseline" contract exactly; on success, formats `embeddingModel` as `` `llm:${model}:d${vector.length}` `` (T005's helper) and sets `embeddingSource: 'llm'` — this exact shape is what `src/collection/embeddingUpgrade.ts`'s `case 'llm':` branch (T014) returns directly, and what `src/collection/reembed.ts`'s `isCanonical()` inspects (T015) — per `contracts/summarization-api.md` § embeddingHook.ts and `data-model.md` §5 (FR-010, FR-012; depends on T007, T008)
- [X] T011 [US3] Wire `pipelineHooks.summarize = createSummarizeHook({ getProvider: () => (this.settings.summarizationProvider === 'openai' ? openAiProvider : undefined), getCredential: () => this.settings.summarizationCredential, notifyCredentialProblem: (message) => new Notice(message) })` into the existing `pipelineHooks` object in `src/main.ts`, resolving the prior placeholder comment ("stays omitted (undefined) until 004 ships") — per `contracts/summarization-api.md` § Edits to already-merged 002 files › src/main.ts (FR-006, FR-008; depends on T008, T009)
- [X] T012 [P] [US3] Add `credential?: string;` to `EmbeddingConfig` in `src/collection/embeddingUpgrade.ts` — a single additive optional field, no other line in this file's interface changes — per `contracts/summarization-api.md` § Edits to already-merged 002 files › embeddingUpgrade.ts and `data-model.md` §1 (FR-010, FR-011 — this field being independent of `summarizationCredential`, T004, is what lets the embedding upgrade be enabled without summarization; depends on none, can run alongside T007-T011)
- [X] T013 [US3] Replace `embeddingUpgrade.ts`'s `case 'llm':` stub body (currently `return undefined;` with a comment naming 004 as the owner) with: trim `config.credential`, return `undefined` immediately if empty/absent, otherwise `return await llmEmbeddingUpgrade(title, abstract, credential);` — plus the corresponding `import { llmEmbeddingUpgrade } from '../services/summarization/embeddingHook';` at the top; no other line in this file changes — the `'local-transformer'`/`'bundled'` branches, the function's `try/catch`/return-type, and every other comment are untouched — per `contracts/summarization-api.md` § Edits to already-merged 002 files › embeddingUpgrade.ts (FR-010, FR-012; depends on T010, T012)
- [X] T014 [US3] Remove `src/collection/reembed.ts`'s no-op guard (`if (config.provider === 'llm') { return summary; }` and its "Removed once the LLM provider ships" comment) — no other line in this file changes; `isCanonical()`'s existing `case 'llm': return model.startsWith('llm:');` already works correctly once real `llm:`-prefixed vectors exist (T010) and requires no edit — per `contracts/summarization-api.md` § Edits to already-merged 002 files › reembed.ts (FR-010; depends on T010)
- [X] T015 [US3] Add `credential: this.settings.embeddingCredential` to both the `reembedCorpus(paperStore, { provider, localModel, ... })` call's config object in `src/main.ts`'s `onload` and the `getEmbeddingConfig` getter passed into `runSubscriptionCheck` (`() => ({ provider: ..., localModel: ..., credential: this.settings.embeddingCredential })`) — no other line in either call site changes — per `contracts/summarization-api.md` § Edits to already-merged 002 files › src/main.ts (FR-010; depends on T012)

**Checkpoint**: User Story 3 is fully functional and independently testable — provider/credential configuration drives both the summarization hook and the LLM embedding upgrade end-to-end with a stubbed provider; invalid-credential messaging (FR-008) and the `llm:` naming contract (data-model.md §5) are both satisfiable per `quickstart.md`.

---

## Phase 4: User Story 1 - Opt in to summaries (Priority: P2)

**Goal**: With the feature on and a configured (stubbed) provider/credential pair (US3), persist a paper and confirm a generated summary appears instead of the abstract; with the feature off, confirm the note is created with just the abstract and no call is made.

**Independent Test**: With `createSummarizeHook` wired (T011) and a fake provider resolving a valid summary, confirm `SummaryResult.summary` is returned; with `getProvider`/`getCredential` returning `undefined` (feature off/unconfigured), confirm the hook resolves `undefined` with zero calls to the fake `generate` — per `quickstart.md` § Opt-in summary generation.

### Implementation for User Story 1

- [X] T016 [US1] Verify (no new implementation — T009's `createSummarizeHook` already implements this, T011 already wires it) that `hook.ts`'s disabled/unconfigured path (`getProvider()` or `getCredential()` returning `undefined`) resolves `undefined` before any `generate` call, satisfying FR-001/FR-002/SC-001, and that a successful generation (T007/T009) is added to the paper's record/note via 002's existing `pipelineHooks.persist` call (no summarization-side change needed — 003's `wrap()`/`mergePaper()` already places `summary` into the managed region) — per `quickstart.md` § Opt-in summary generation and `data-model.md` §6 (FR-001, FR-002, FR-003, FR-005, SC-001; depends on T009, T011)
- [X] T017 [US1] Verify the too-short/empty (T007's threshold), timeout (T007's `AbortSignal`), provider-rejection, and in-flight-discard scenarios each resolve `undefined` from `createSummarizeHook`'s returned function (no new implementation beyond T007/T009 — this task is the `quickstart.md` scratch-script assertions themselves, written in `scratch/verify-summarization.ts` per `quickstart.md` § Setup, confirming FR-007/FR-009/SC-003 end-to-end) (FR-007, FR-009, SC-003; depends on T007, T009)

**Checkpoint**: User Stories 1 and 3 both work independently and together — SC-001/SC-003 are satisfiable end-to-end with a stubbed provider.

---

## Phase 5: User Story 2 - Future directions for uncited recent papers (Priority: P3)

**Goal**: An uncited paper (`citationsKnown: true, citationCount: 0`) receives both a summary and a future-directions description; an already-cited paper receives only a summary, with no future-directions call even attempted.

**Independent Test**: Persist one paper with `citationCount: 0` (`citationsKnown: true`) and one with a positive count through the wired hook (T011) and confirm the uncited one's `SummaryResult.futureDirections` is non-empty while the cited one's is exactly `''` and no future-directions generation is attempted for it — per `quickstart.md` § Future-directions gating.

### Implementation for User Story 2

- [X] T018 [US2] Extend `hook.ts`'s `createSummarizeHook` (T009) to call `isUncited(input)` (T003) after a successful summary: when `false`, set `futureDirections: ''` without attempting a future-directions generation call at all (the already-implemented 003 "not applicable" sentinel, research.md §2); when `true`, request a future-directions generation from the same provider call/a follow-up call per `contracts/summarization-api.md` § hook.ts — per `data-model.md` §2 and research.md §2 (FR-004; depends on T009)
- [X] T019 [US2] Extend `generate.ts`'s `runGeneration` (T007) so a future-directions-specific too-short/empty shortfall degrades only `futureDirections` to `''` in the returned `GenerationOutcome`, never discarding an otherwise-successful `summary` (i.e., never turning the whole outcome to `ok: false`) — per `data-model.md` §2 (research.md §2: "a future-directions-specific shortfall degrades `futureDirections` to `''`, not the whole outcome to failure") (FR-004, FR-007; depends on T007, T018)
- [X] T020 [US2] Verify the "unknown citation status is not uncited" edge case (`citationsKnown: false, citationCount: 0` → `isUncited` is `false`, spec Edge Cases / 002 FR-016/FR-018) is exercised in `scratch/verify-summarization.ts` per `quickstart.md` § Future-directions gating (no new implementation — T003 already implements this) (FR-004, SC-002; depends on T003, T018)

**Checkpoint**: All three user stories are independently functional — SC-002 is satisfiable end-to-end alongside SC-001/SC-003.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Full-feature verification and cleanup that spans all three user stories.

- [X] T021 [P] Run `npm run build` (`tsc --noEmit` + esbuild bundle) and `npm run lint` (`eslint .`) across the full feature and fix any type/lint errors surfaced by the new `src/services/summarization/` modules or the edits to `embeddingUpgrade.ts`/`reembed.ts`/`main.ts`/`settings.ts`
- [X] T022 [P] Write and run `scratch/verify-summarization.ts` per `quickstart.md`'s Setup/Run sections, asserting every scenario listed under `quickstart.md` § Scenarios to assert (opt-in summary generation, future-directions gating, provider & credentials, LLM embedding upgrade, the `isCanonical()` naming-contract check, the FR-011 independent-toggles check, and the SC-004 shape check) — 20/20 `PASS`, zero `FAIL` (confirmed 2026-07-11); `scratch/` deleted afterward
- [X] T023 Confirm the settings-UI disclosure copy (T006) reads correctly against constitution Principle IV / FR-013's requirement (what is sent, to whom, plaintext storage disclosure) — final content review only, since placement in the settings tab UI itself is 008's job, not 004's (FR-013): reviewed `SUMMARIZATION_DISCLOSURE_COPY` in `constants.ts` — `whatIsSent`/`embeddingWhatIsSent` name the exact data sent (title+abstract only, never the full record) and `credentialStorage` names the plaintext-storage fact; all three required disclosure elements present

**Checkpoint**: Feature complete — `tsc --noEmit`/`eslint .` clean, `quickstart.md` fully green, disclosure copy ready for 008 to place.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user story phases (T002's types are used by every later file; T003's `isUncited` is used by US2's T018; T004's settings fields are read by US1's T011 and US3's T011/T015; T005's constants are used by T007/T010; T006's copy is polished in T023).
- **User Story 3 (Phase 3)**: Depends on Foundational (Phase 2) only. Sequenced before US1/US2 despite equal (US1) or lower (US2) spec-listed order because US1's hook (T009) and US2's gating (T018) are both built directly on top of US3's `createSummarizeHook`/`generate.ts`/`providers/openai.ts` (T007-T010) — this is a dependency-ordering choice, not a change to spec.md's priority values (US1=P2, US3=P2, US2=P3).
- **User Story 1 (Phase 4)**: Depends on Foundational (Phase 2) and US3's T009/T011 (the hook must exist and be wired before its disabled/enabled/failure paths can be verified).
- **User Story 2 (Phase 5)**: Depends on Foundational (Phase 2), US3's T009 (extends `hook.ts`), and is verified through US1's already-wired T011.
- **Polish (Phase 6)**: Depends on all three user story phases being complete.

### Within Each User Story

- Types/constants before generation logic.
- Generation logic (`generate.ts`) and providers (`providers/openai.ts`) before the adapters that call them (`hook.ts`, `embeddingHook.ts`).
- Adapters before the `main.ts`/`embeddingUpgrade.ts`/`reembed.ts` wiring that consumes them.
- Story complete before moving to the next phase.

### Parallel Opportunities

- All Foundational tasks (T002-T006) marked [P] can run in parallel — each touches a distinct file or a distinct, non-overlapping part of `settings.ts`.
- T007 and T008 (US3) can run in parallel — `generate.ts` and `providers/openai.ts` are independent files with no cross-dependency until T009/T010 consume both.
- T012 (the `EmbeddingConfig` field addition) can run in parallel with T007-T011 — it touches only an interface declaration, independent of `embeddingHook.ts`'s implementation, though T013 (which fills the `case 'llm':` body) depends on both T010 and T012.
- T021 and T022 (Polish) can run together once all three user stories are implemented.

---

## Parallel Example: Kicking off Foundational together

```bash
# Launch all Foundational tasks together:
Task: "Define shared types in src/services/summarization/types.ts"
Task: "Implement isUncited() in src/services/summarization/isUncited.ts"
Task: "Add three optional fields to PluginSettings in src/models/settings.ts"
Task: "Define shared constants in src/services/summarization/constants.ts"
Task: "Author settings-UI disclosure copy in src/services/summarization/constants.ts"
```

---

## Implementation Strategy

### MVP First (User Story 3 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 3 (provider/credentials + LLM embedding upgrade)
4. **STOP and VALIDATE**: Test User Story 3 independently via `quickstart.md` § Provider & credentials and § LLM embedding upgrade
5. This alone completes the entire embedding-upgrade seam (research.md §8) even before any summary text flows

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 3 → Test independently → the `embeddingUpgrade.ts`/`reembed.ts` stubs are now fully resolved
3. Add User Story 1 → Test independently → summaries now replace abstracts end-to-end
4. Add User Story 2 → Test independently → uncited papers now also get future-directions text
5. Polish: full build/lint/quickstart pass, disclosure copy review

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 3 (T007-T015)
   - Developer B: prepares User Story 1's verification scaffolding (T016-T017) against US3's contracts, ready to run once T009/T011 land
3. User Story 2 (T018-T020) starts once US3's T009 lands, in parallel with US1

---

## Notes

- [P] tasks = different files, no dependencies (or non-overlapping edits to the same interface declaration, as with T004/T012).
- [Story] label maps task to specific user story for traceability.
- Each user story should be independently completable and testable per its `quickstart.md` section.
- This feature never performs file I/O itself (003's job) and never re-embeds the corpus itself (002's already-implemented `reembedCorpus`, T014/T015 only complete its LLM seam).
- Stop at any checkpoint to validate a story independently.
- Avoid: vague tasks, same-file conflicts (note T004/T012 touch different files despite both being settings-adjacent), cross-story dependencies that break independence.
