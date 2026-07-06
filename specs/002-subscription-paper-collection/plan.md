# Implementation Plan: Subscription-Based Paper Collection

**Branch**: `002-subscription-paper-collection` | **Date**: 2026-07-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-subscription-paper-collection/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Collect new papers from arXiv (discovery, Atom XML) and Semantic Scholar (citation enrichment only, JSON) on behalf of each registered subscription (001), each on its own check interval while the plugin runs (via one shared recurring tick, not a timer per subscription — research.md Decision 4), immediately upon a genuinely new subscription's registration (rather than waiting for the next tick), and as a single bounded catch-up search per enabled subscription when the plugin loads after being off or when a long-disabled subscription is re-enabled. Every discovered response is parsed into a `PaperCandidate` (001) with a version-stripped, stable `sourceId`, batch-enriched with citation data across the whole check's surviving candidates in one Semantic Scholar request rather than one per paper (arXiv-ID-only match — no title/author fallback, to eliminate false-positive matches), then promoted to a `Paper` only once it has a publication year — missing citation data never holds a paper back, it is promoted immediately with `citationsKnown = false` so it is never lost by advancing past the search window, and a search window that yields more papers than a single query can page through is covered across successive checks rather than permanently truncated. This feature owns the end-to-end per-paper pipeline (enrich → optionally invoke summarization 003/004 hook → hand off to persistence 003) but implements none of those downstream steps itself, and is the *only* place in the plugin that makes an external network call.

## Technical Context

**Language/Version**: TypeScript 5.8, `strict: true` (existing `tsconfig.json`: ES2021 target, ESNext modules, `noUncheckedIndexedAccess`)

**Primary Dependencies**: None new for HTTP — Obsidian's `requestUrl` (from the external `obsidian` package, already a project dependency) is used for arXiv/Semantic Scholar calls instead of `fetch`/Node `http`, since it works identically on desktop and mobile and avoids CORS restrictions `fetch` hits in the Obsidian sandbox. Atom XML (arXiv) is parsed with the DOM `DOMParser`, which is available in both the desktop (Electron/Chromium) and mobile (Capacitor/WebView) Obsidian runtimes — no new XML-parsing library is introduced.

**Storage**: This feature persists exactly one thing — the `Subscription[]` list — through the plugin's own `loadData()`/`saveData()`, as a sibling key alongside 001's `PluginSettings` in one shared JSON object (`{ settings, subscriptions }`); every write is read-modify-write against that whole object so a subscription-list save never clobbers settings written by another part of the plugin, or vice versa. Writing collected papers (JSON record + Markdown note) is 003's responsibility. This feature otherwise holds only in-memory per-run state (in-flight dedupe set, retry counters, a per-subscription in-progress guard).

**Testing**: No test runner is configured in this repo (confirmed in `CLAUDE.md`/`package.json`), consistent with 001. Correctness is verified via (a) `tsc --noEmit` strict type-checking, and (b) a manual `quickstart.md` walkthrough exercising the Atom XML / Semantic Scholar JSON parsers, the candidate→Paper promotion/enrichment logic, and the scheduler, using stubbed provider payloads so no live network call is made — matching 001's own plan.md testing approach exactly (a scratch script run via `esbuild`+`node`, not a persisted test suite). See `research.md` for rationale. (The separate `/spec-test` skill, which generates and runs assert-style tests against an already-implemented spec and writes results under `specs-test/<spec>/`, is an independent, post-implementation verification pass this repo can invoke against any feature — as it already has for 001 — and is not something this plan declares or depends on.)

**Target Platform**: Obsidian desktop + mobile (plugin must stay mobile-compatible; `requestUrl` + `DOMParser` are both available on mobile, so this feature introduces no desktop-only APIs)

**Project Type**: Obsidian community plugin — single TypeScript bundle via esbuild (matches existing `src/main.ts` entry point / single-project layout)

**Performance Goals**: N/A hard targets — the constraint that matters is UI responsiveness: a large discovered batch (Edge Cases: right after registering a subscription, or a long off-period catch-up) must be processed sequentially (not in a tight synchronous loop) so Obsidian's UI thread never freezes.

**Constraints**: Must not depend on Node/Electron-only networking (mobile-compatible per constitution Principle I); every network call this feature makes MUST be disclosed per constitution Principle IV (README + settings UI describe what is called, why, and that it is opt-in via enabling a subscription); MUST NOT let any other module make external calls (FR-008); MUST NOT persist raw provider payloads (FR-008); `tsc --noEmit` and `eslint .` must keep passing repo-wide.

**Scale/Scope**: A handful of new modules under a new `src/collection/` directory — one file per provider client (arXiv, Semantic Scholar), one per provider's parsing-to-candidate mapping (arXiv, Semantic Scholar), one each for enrichment and promotion, one for dedup, one for the per-subscription scheduler (recurring tick + catch-up-on-load + immediate-on-register), and one for per-paper pipeline orchestration (which also owns the sequential, non-blocking batch loop — there is no separate batch-queue module). Each stays within the constitution's ~300-line split guidance; the only existing files modified are `src/main.ts` (gaining scheduler start wiring in `onload` — no corresponding `onunload` code is needed, see Constitution Check) and `src/models/settings.ts` (gaining exactly one optional field, `semanticScholarApiKey?: string`, as an FR-016-style additive extension to 001's `PluginSettings` — FR-020; no existing 001 field is removed or redefined).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applicability | Assessment |
|---|---|---|
| I. Obsidian Platform Compliance | Applies | Networking uses `requestUrl` (obsidian package, already external/bundled-by-host) and `DOMParser`/`JSON.parse` — no Node/Electron-only APIs, so behavior is identical on desktop and mobile. **Pass.** |
| II. Lifecycle-Safe Resource Management | Applies (NON-NEGOTIABLE) | The single recurring check tick MUST be created via `this.registerInterval(...)` — never a raw `setInterval` — so `onunload` cleanup is automatic and no manual `stop()` is required (research.md Decision 4 chose one coarse 15-min tick over one timer per subscription precisely to avoid per-subscription teardown bookkeeping). Catch-up-on-load and the immediate-on-register check run through that same machinery and need no separate listener. **Pass, contingent on Phase 1 design honoring this — re-verified below.** |
| III. Manifest Identity Stability | N/A | `manifest.json` is not touched by this feature. **Pass (vacuous).** |
| IV. Transparent Use of Sensitive APIs | Applies | This is the plugin's only feature making network calls (arXiv, Semantic Scholar). Requires: default state is "off" until a subscription is registered (opt-in by construction — no subscriptions means no calls), and README/settings UI copy MUST disclose what is called and why. Tracked as a Phase 1/implementation deliverable, not a design blocker. **Pass, with a documentation obligation carried into tasks.md.** |
| V. Bilingual UX, English-Only Code | Applies | User-facing failure notices (unreachable provider, truncated catch-up window) MUST be understandable to both Korean- and English-speaking users; all code/comments stay English. **Pass — carried into UX copy tasks.** |
| VI. Open-Source Code Quality & Extensibility | Applies | Provider clients, parsing, enrichment/promotion, scheduling, and batch processing are split into separate single-responsibility modules under a new `src/collection/` directory (not `main.ts`), so adding a third provider later extends rather than rewrites this feature. **Pass.** |

No violations identified. Complexity Tracking table below is not needed.

**Post-Phase-1 re-check**: `data-model.md`, `contracts/`, and `quickstart.md` were reviewed against the same six principles after design. The scheduler design registers its recurring tick through `this.registerInterval(...)` exclusively and relies entirely on Obsidian's own automatic cleanup of that registration on `onunload` — there is deliberately no separate `stop()` function anywhere in this design (research.md Decision 4, contracts § scheduler.ts, tasks.md T020); the only network calls remain confined to the two provider-client modules; no raw provider payload crosses into another module's contract (each contract's output type is the 001 `PaperCandidate`/`Paper` shape). All six principles remain satisfied; no new violations were introduced by the detailed design.

## Project Structure

### Documentation (this feature)

```text
specs/002-subscription-paper-collection/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── main.ts                       # existing — gains scheduler start wiring in onload only (no onunload code — registerInterval auto-cleans)
├── models/                       # existing (001) — Subscription, Paper, PaperCandidate read-only; settings.ts gains one optional field semanticScholarApiKey (FR-020, FR-016 extension)
└── collection/                   # NEW — this feature's entire footprint
    ├── subscriptionStore.ts       # Subscription[] CRUD (register/list/delete/enable/setInterval) + persistence read/write hook; the settings-screen UI (008) calls this, it builds no UI itself
    ├── types.ts                   # shared in-memory intermediate types (CollectionWindow, ArxivEntry, SemanticScholarPaper, EnrichmentOutcome, CollectionRunState, PipelineHooks) imported by the files below
    ├── arxivClient.ts             # arXiv Atom XML query + response fetch (requestUrl)
    ├── semanticScholarClient.ts   # Semantic Scholar batch enrichment fetch (requestUrl; POST /paper/batch, plus a single-paper GET retained for 005)
    ├── arxivParser.ts             # Atom XML -> PaperCandidate (citationCount/references left undefined)
    ├── semanticScholarParser.ts   # Semantic Scholar JSON -> intermediate citation shape (citationCount + references); the pipeline applies it onto a candidate, not this parser
    ├── enrichment.ts              # arXiv-ID-only identity matching (no title/author fallback); terminal-absence vs transient-failure classification
    ├── promotion.ts               # PaperCandidate -> Paper gate (delegates to 001's toPaper()/isValidPaper()), citationsKnown bookkeeping
    ├── dedupe.ts                  # per-run sourceId dedupe across subscriptions/overlapping windows
    ├── scheduler.ts               # ONE 15-min registerInterval tick (not one timer per subscription — research.md Decision 4) that checks each due subscription + single catch-up-on-load pass + immediate checkNow on new registration; owns lastCheckedAt advancement
    └── pipeline.ts                # per-paper orchestration: enrich -> (hook) summarize -> hand off to (hook) persist; also owns the sequential, non-blocking batch loop (runCollectionPass) over a discovered batch
```

**Structure Decision**: Single project (no frontend/backend split). All new code lives under a new `src/collection/` directory, one file per responsibility, matching the constitution's single-responsibility module rule and mirroring 001's `src/models/` precedent. `src/main.ts` gains only the wiring needed to start the scheduler through `registerInterval` in `onload` (no `onunload` teardown code is needed — Obsidian auto-clears a `registerInterval`-registered tick); the only other existing file modified is `src/models/settings.ts`, which gains a single optional `semanticScholarApiKey?: string` field on `PluginSettings` (an FR-016-permitted additive extension, FR-020 — no 001 field removed or redefined). `pipeline.ts` calls into 003 (persistence) and 004 (summarization) through narrow function-call hooks defined in this feature's contract, not through direct imports of their internals, so this feature can be implemented and tested (with stub hooks) before 003/004 exist. `subscriptionStore.ts` owns subscription CRUD and persistence (per 008's clarification that 008 builds only the settings-screen UI and calls into the feature that owns the underlying data); this feature's own "management" User Story is therefore satisfied by these functions alone, with no UI, exactly like 001's data-only-no-UI precedent.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

Not applicable — the Constitution Check above found no violations.
