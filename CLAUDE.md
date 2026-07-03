# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

This repo (`PaperGraph3D`) is early in build-out. The plugin entry points are still the unmodified Obsidian sample template — `manifest.json` still declares `id: "sample-plugin"`, and `src/main.ts` / `src/settings.ts` are the stock sample code (ribbon icon, sample modal, one settings field), not yet wired to any real feature. The first feature's output does exist: `src/models/{subscription,paper,settings}.ts` hold the core data structures (types plus runtime validators) from the `001-core-data-models` spec, but nothing imports them yet. Treat the sections below as the scaffolding/conventions the real plugin is being built on top of.

## Commands

```bash
npm install       # install dependencies
npm run dev       # esbuild watch mode: bundles src/main.ts -> main.js on change
npm run build     # tsc --noEmit type-check, then production esbuild bundle (minified, no sourcemap)
npm run lint      # eslint . (eslint-plugin-obsidianmd rules)
npm version patch|minor|major   # bumps manifest.json + package.json version, updates versions.json
```

There is no test suite/script configured in this repo.

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

`.specify/memory/constitution.md` is a ratified project constitution (v1.0.0), not the bare template — it defines six binding principles (Obsidian Platform Compliance, Lifecycle-Safe Resource Management, Manifest Identity Stability, Transparent Use of Sensitive APIs, Bilingual UX/English-only code, Open-Source Code Quality & Extensibility) plus Additional Constraints and a Development Workflow section. `/speckit.plan`'s Constitution Check gate reads this file directly; treat it as binding and only amend it through its own Governance rules (version bump + Sync Impact Report), not by hand-editing content in place.

One feature spec exists so far: `specs/001-core-data-models/` (core data structures — spec, plan, tasks, and design artifacts, all implemented under `src/models/`).

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
at specs/001-core-data-models/plan.md
<!-- SPECKIT END -->
