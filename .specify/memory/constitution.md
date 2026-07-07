<!--
Sync Impact Report
==================
Version change: 1.0.0 → 1.1.0 (amendment 2026-07-07: desktop-only platform decision + LLM embedding disclosure)
Modified principles:
  - I. Obsidian Plugin Platform Compliance — mobile-default note now records the
    deliberate desktop-only decision for PaperGraph3D (features 006/007)
  - IV. Transparent Use of Sensitive APIs — optional LLM embedding providers
    (Claude / Gemini / OpenAI) noted as disclosed opt-in external calls
New/updated sections: Additional Constraints → "Platform target (desktop-only)" bullet
Prior history: [TEMPLATE] → 1.0.0 (initial concrete ratification); modified principles then: N/A (first time placeholders filled in)
Added sections:
  - I. Obsidian Plugin Platform Compliance
  - II. Lifecycle-Safe Resource Management (NON-NEGOTIABLE)
  - III. Manifest Identity Stability
  - IV. Transparent Use of Sensitive APIs
  - V. Bilingual UX, English-Only Code
  - VI. Open-Source Code Quality & Extensibility
  - Additional Constraints (technology stack, style, security/privacy)
  - Development Workflow (build/lint gates, Spec Kit lifecycle)
  - Governance
Removed sections: [PRINCIPLE_1..5_NAME]/[SECTION_2/3_NAME] placeholder scaffold
Templates requiring updates:
  - .specify/templates/plan-template.md — ✅ no edit needed (Constitution Check
    section reads gates dynamically from this file)
  - .specify/templates/spec-template.md — ✅ no edit needed (no new mandatory
    spec sections introduced)
  - .specify/templates/tasks-template.md — ✅ no edit needed (cleanup/security
    concerns already covered by existing Polish phase bullets)
  - .specify/templates/commands/*.md — N/A (directory does not exist; commands
    are implemented as .claude/skills/speckit-*)
  - CLAUDE.md / AGENTS.md — ✅ no edit needed; this constitution is additive to
    and consistent with existing conventions documented there
Follow-up TODOs: none
-->

# PaperGraph3D Constitution

## Core Principles

### I. Obsidian Plugin Platform Compliance

TypeScript source under `src/` MUST be compiled and bundled by esbuild into a
single `main.js` that Obsidian loads directly; `obsidian`, `electron`, and the
`@codemirror`/`@lezer` packages stay external, and every other dependency MUST
be bundled since only one output file is loaded. `npm run build` (type-check
via `tsc --noEmit`, then production bundle) MUST succeed before any release,
and the release artifacts (`main.js`, `manifest.json`, `styles.css`) MUST end
up at the plugin root, matching the `<Vault>/.obsidian/plugins/<id>/` layout.
Code MUST default to mobile-compatible APIs; Node/Electron-only APIs are only
allowed when `isDesktopOnly` is deliberately set and documented. PaperGraph3D
has made that deliberate, documented decision: the 3D graph, native local
content-embedding, and in-memory 2D projection (features 006/007) require
desktop/Electron capabilities, so `manifest.json` sets `isDesktopOnly: true`
and mobile support is intentionally dropped (see Additional Constraints →
Platform target).

**Rationale**: Obsidian only loads one bundle and enforces a specific plugin
folder shape — deviating breaks installation for every user, on every
platform, not just an edge case.

### II. Lifecycle-Safe Resource Management (NON-NEGOTIABLE)

The `Plugin` subclass MUST treat `onload`/`onunload` as the only lifecycle
entry and exit points. Any event listener, DOM listener, or interval MUST be
registered through `this.registerEvent(...)`, `this.registerDomEvent(...)`,
or `this.registerInterval(...)` — raw `addEventListener`, `setInterval`, or
`app.workspace.on` calls without the corresponding `register*` wrapper are
prohibited. After `onunload` runs, zero listeners, intervals, or background
timers may remain active.

**Rationale**: Obsidian reloads plugins routinely (settings changes, plugin
updates, dev-mode hot reload); unmanaged resources leak memory and silently
duplicate handlers across reloads.

### III. Manifest Identity Stability

`manifest.json`'s `id` MUST exactly match the plugin's folder name inside
`.obsidian/plugins/`, and once the plugin has a real release, `id` MUST NOT
change. `version` MUST follow SemVer and MUST stay synchronized across
`manifest.json`, `package.json`, and `versions.json` (via `npm version`,
never hand-edited independently).

**Rationale**: `id` is the external identifier used by installs and the
community plugin catalog; changing it orphans existing users' installations.

### IV. Transparent Use of Sensitive APIs

Before shipping any network request, external data fetch, or dynamic/
arbitrary code execution, the change MUST explain — in the PR/commit
description, in `README.md`, and in the relevant settings UI — what is being
called, why, what data (if any) leaves the device, and how the user opts in.
No such capability may ship silently enabled by default; the default state
MUST be off or fully disclosed at first use.

**Rationale**: The plugin must work fully offline by default; users granting
access to their vault need to know exactly when that trust is extended
outside it.

### V. Bilingual UX, English-Only Code

User-facing text (commands, settings labels, notices, modals) MUST stay
understandable to both Korean- and English-speaking users — provide both
languages where they diverge, or default to plain, translation-friendly
English. Code comments, identifiers, commit messages, and internal docs MUST
be written in English regardless of UI language, so the codebase reads
uniformly for any contributor.

**Rationale**: The user base spans Korean and English speakers, but a public
open-source codebase needs one consistent language for maintainers who join
later.

### VI. Open-Source Code Quality & Extensibility

Because this plugin ships as public open source, feature logic MUST live in
focused, single-responsibility modules under `src/` (e.g. `commands/`,
`ui/`, `utils/`) rather than in `main.ts`, which stays limited to lifecycle
wiring, command registration, and settings-tab hookup. New features MUST be
designed so they extend rather than require rewriting unrelated modules
(e.g., adding a new subscription type or graph interaction must not force
changes across unrelated files). Any file exceeding roughly 300 lines MUST be
reconsidered for splitting.

**Rationale**: Strangers read, fork, and review public repositories; unclear
structure or tangled coupling raises the cost of every future contribution,
including the maintainer's own.

## Additional Constraints

- **Platform target (desktop-only)**: PaperGraph3D is a **desktop-only** plugin
  — `manifest.json` `isDesktopOnly: true`. This is the deliberate, documented
  exception Principle I allows: the 3D visualization (007) and native local
  content-embedding + 2D projection (002/006) depend on desktop/Electron
  capabilities not viable on Obsidian mobile. Optional summary/embedding
  upgrades may call external LLM providers (Claude / Gemini / OpenAI); like all
  sensitive-API use these are opt-in, credential-gated, and disclosed per
  Principle IV, and the plugin still functions fully offline (local baseline
  embedding, no summaries) with them off.
- **Toolchain lock-in**: npm is the package manager and esbuild is the
  bundler; `esbuild.config.mjs` and the npm scripts are the source of truth
  for how `src/main.ts` becomes `main.js`.
- **Style**: Tabs for indentation, single quotes, LF line endings, UTF-8
  (enforced by `.editorconfig`); TypeScript `strict: true`.
- **Security & privacy baseline**: No hidden telemetry; read/write only what
  is necessary inside the vault; never access files outside the vault; never
  auto-update plugin code outside normal releases. This constitution's
  Principle IV is the binding summary — `AGENTS.md`'s Security, privacy, and
  compliance section is the detailed implementation guide and MUST NOT be
  contradicted.
- **UX copy**: Sentence case for headings/buttons/titles; arrow notation for
  navigation instructions (e.g., **Settings → Community plugins**), per
  `AGENTS.md`.

## Development Workflow

- `npm run build` (type-check + bundle) and `npm run lint`
  (`eslint-plugin-obsidianmd` rules) MUST both pass locally before a change is
  considered done; CI (`.github/workflows/lint.yml`) enforces both across
  Node 20/22/24 on every push and PR.
- New functionality proceeds through the Spec Kit lifecycle
  (`/speckit-specify` → optional `/speckit-clarify` → `/speckit-plan` →
  `/speckit-tasks` → optional `/speckit-analyze` → `/speckit-implement`); the
  `/speckit-plan` Constitution Check gate MUST be evaluated against the six
  principles above before implementation begins.
- Command IDs registered via `this.addCommand(...)` are stable once released
  and MUST NOT be renamed.
- Release tags MUST exactly match `manifest.json`'s `version` (no `v`
  prefix), per `.github/workflows/release.yml` and `.npmrc`.

## Governance

This constitution supersedes ad-hoc practice whenever it conflicts with
other guidance; `AGENTS.md` and `CLAUDE.md` remain the detailed how-to and
MUST be kept consistent with it, not the other way around. Amendments are
made by editing this file directly:

- **MAJOR**: backward-incompatible removal or redefinition of a principle.
- **MINOR**: a new principle or materially expanded guidance is added.
- **PATCH**: wording, clarification, or typo fixes with no rule change.

Every amendment MUST update the version below, refresh the Sync Impact
Report comment at the top of this file, and re-check the templates listed
there for needed edits. `/speckit-plan` MUST cite the specific principles a
feature's design satisfies or deviates from; deviations require justification
recorded in that feature's `plan.md` Complexity Tracking section.

**Version**: 1.1.0 | **Ratified**: 2026-07-02 | **Last Amended**: 2026-07-07
