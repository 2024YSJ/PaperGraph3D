# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

This repo (`PaperGraph3D`) is mid build-out — features 001, 002, and 003 are implemented and verified. `src/models/{subscription,paper,settings}.ts` hold the 001 core data structures (types + runtime validators, including the core `Paper.embedding`/`embeddingModel`/`embeddingSource` fields and the optional `embeddingProvider`/`localEmbeddingModel` settings). `src/collection/` holds the 002 subscription-based collection pipeline (arXiv + Semantic Scholar clients, dedupe, enrichment, promotion, scheduler, backfill) **plus the content-embedding layer**: a bundled offline hashed-TF baseline (`embedding.ts`), a user-supplied on-device local-transformer provider via a lazy `@huggingface/transformers` import (`localTransformer.ts` / `embeddingUpgrade.ts`), and corpus re-embedding on provider switch (`reembed.ts`) — all behind an explicit **three-way provider selector** (bundled / local-transformer / LLM), with the LLM path a stubbed hook until 004. `src/persistence/` holds the 003 record+note persistence layer (paired JSON record + Markdown note, JSON-authoritative reconciliation, tombstoned delete). `src/main.ts` is real plugin code wiring the 002 collection pipeline into 003 persistence and kicking off the background re-embed pass on load (not the stock sample); full lifecycle assembly is still owned by the future 008 feature. `src/settings.ts` holds the settings interface/defaults and a minimal `PaperGraph3DSettingTab`; the embedding-provider selector UI and the four-section settings screen are 008's scope (the fields exist in the model but have no UI yet). `manifest.json` declares `id: "paper-graph-3d"` and `isDesktopOnly: true` (deliberately desktop-only; see the constitution). The one remaining embedding gap is **T039** (bundling/shipping the local-transformer runtime), deferred as environment-gated — until it lands, selecting the local-transformer provider gracefully falls back to the offline baseline. Feature 005 (manual-paper-refresh) and later features remain drafts under `specs-input/`.

## Commands

```bash
npm install       # install dependencies
npm run dev       # esbuild watch mode: bundles src/main.ts -> main.js on change
npm run build     # tsc --noEmit type-check, then production esbuild bundle (minified, no sourcemap)
npm run lint      # eslint . (eslint-plugin-obsidianmd rules)
npm version patch|minor|major   # bumps manifest.json + package.json version, updates versions.json
```

There is no npm test suite/script configured. Verification is skill-driven: per-spec assert suites under `specs-test/<spec>/` (via `/spec-test`) and cross-spec integration suites under `specs-chain-test/<chain>/` (via `/specs-chain-test`), each an esbuild+node `.ts` plus a `report.md`. As of the latest run, 001/002/003 and the 001→002→003 chain all pass (0 failed; scheduler/live-network/Obsidian-lifecycle/DOM cases are recorded as SKIP with reasons).

To manually try the plugin in Obsidian, copy `main.js`, `manifest.json`, and `styles.css` into `<Vault>/.obsidian/plugins/<plugin-id>/`, then reload Obsidian and enable it under Settings → Community plugins.

## Architecture

- This is an **Obsidian community plugin**: TypeScript in `src/` is bundled by esbuild (`esbuild.config.mjs`) into a single CJS `main.js` at the repo root, which Obsidian loads directly. `obsidian`, `electron`, and the `@codemirror`/`@lezer` packages are marked external; everything else must be bundled since only one output file is loaded.
- `src/main.ts` is the `Plugin` subclass — lifecycle (`onload`/`onunload`), command registration, ribbon icon, status bar, settings tab wiring. Per `AGENTS.md`, keep this file to lifecycle/wiring only and delegate feature logic to new modules under `src/` (e.g. `commands/`, `ui/`, `utils/`) as functionality is added.
- `src/settings.ts` holds the settings interface, defaults, and `PluginSettingTab` UI. Settings are persisted via `this.loadData()` / `this.saveData()` on the plugin instance.
- Release artifacts (`main.js`, `manifest.json`, `styles.css`) must end up at the plugin root — this is what a vault's `.obsidian/plugins/<id>/` folder expects. `main.js` is gitignored and never committed; it's produced by `npm run build` and attached to GitHub releases instead.
- `manifest.json`'s `id` is a stable identifier — do not change it after a real release. `version` follows SemVer and must stay in sync with `package.json` and `versions.json` (handled by `version-bump.mjs` via `npm version`).

## CI

- `.github/workflows/lint.yml`: on every push/PR to any branch, runs `npm ci`, `npm run build`, `npm run lint` across Node 20/22/24.
- `.github/workflows/release.yml`: on tag push, builds the plugin and creates a **draft** GitHub release containing `main.js`, `manifest.json`, `styles.css` (if present), with build provenance attestation. Tags must exactly match `manifest.json`'s `version` (no `v` prefix; see `.npmrc`'s `tag-version-prefix=""`).

## Conventions (see `AGENTS.md` for the full guide)

`AGENTS.md` has the exhaustive Obsidian plugin guidance (manifest field rules, UX copy style, security/privacy policy, mobile-compatibility notes, troubleshooting). The load-bearing points:

- Tabs, single quotes, LF line endings, UTF-8 (`.editorconfig`); TypeScript `strict: true`.
- Use `this.registerEvent(...)`, `this.registerDomEvent(...)`, `this.registerInterval(...)` for anything needing cleanup — never attach raw listeners, so unload doesn't leak.
- Avoid Node/Electron-only APIs unless `isDesktopOnly` is intentionally `true`; default to mobile-compatible code.
- No network calls or telemetry without an obvious user-facing reason, explicit opt-in, and documentation — plugin should work fully offline by default.
- Command IDs are stable once released; don't rename them.

## Spec Kit

This repo uses [GitHub Spec Kit](https://github.com/github/spec-kit) for spec-driven development, integrated with Claude Code via `speckit-*` skills. Installed extensions:

- **git** — auto-creates a numbered feature branch (`specs/<NNN-name>`-style numbering) before `/speckit.specify` runs (non-optional hook); optional auto-commit hooks around other lifecycle steps (all disabled by default in `.specify/extensions/git/git-config.yml`).
- **agent-context** — keeps the managed block below in sync with the active feature's plan path after `/speckit.specify` and `/speckit.plan`. Configured to manage this file (`.specify/extensions/agent-context/agent-context-config.yml` → `context_file: "CLAUDE.md"`). Don't hand-edit between the markers; it's regenerated.
- **bug** — `/speckit.bug.assess`, `/speckit.bug.fix`, `/speckit.bug.test` for triaging bug reports against the codebase, with per-bug reports under `.specify/bugs/<slug>/`.

`.specify/memory/constitution.md` is a ratified project constitution (v1.2.0 — last amended 2026-07-09 for the three explicitly-selected embedding providers: a bundled offline baseline, a user-supplied on-device local transformer given by file path or URL, and an external LLM API — with the local-model URL-fetch disclosed as an opt-in external access under Principle IV, atop the v1.1.0 desktop-only decision), not the bare template — it defines six binding principles (Obsidian Platform Compliance, Lifecycle-Safe Resource Management, Manifest Identity Stability, Transparent Use of Sensitive APIs, Bilingual UX/English-only code, Open-Source Code Quality & Extensibility) plus Additional Constraints and a Development Workflow section. `/speckit.plan`'s Constitution Check gate reads this file directly; treat it as binding and only amend it through its own Governance rules (version bump + Sync Impact Report), not by hand-editing content in place.

Feature specs under `specs/`: `001-core-data-models/`, `002-subscription-paper-collection/`, and `003-paper-note-persistence/` — all three specified, planned, implemented (`src/models`, `src/collection`, `src/persistence`), and verified under `specs-test/`. The content-embedding thread (bundled baseline / local-transformer / LLM three-provider selector, FR-044/FR-045/FR-046) is folded into 002's spec + tasks (Phase 9). Drafts for 004 summarization, 005 manual-paper-refresh, 006 graph-data conversion, 007 3D visualization, and 008 plugin assembly live under `specs-input/`; the whole set threads a content-similarity x,y graph layout (year fixed to the z axis) driven by the core `Paper.embedding`, produced by whichever embedding provider is selected.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
at specs/002-subscription-paper-collection/plan.md
<!-- SPECKIT END -->
