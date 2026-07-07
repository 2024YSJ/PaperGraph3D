---
description: Verify how two or more specs under specs/ integrate by generating and running assert-style tests over the seams where one spec's output feeds the next, writing results under specs-chain-test/<chain-id>/.
argument-hint: "[spec-name ...]  (ordered, e.g. 001-core-data-models 003-paper-note-persistence; omit to auto-derive the chain)"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

You are running the `/specs-chain-test` command. Where `/spec-test` checks **one** spec against its own implementation, this command checks how **two or more specs integrate** — the *seams* where one spec's produced artifact flows into the next spec's consumption of it (e.g. a `Paper` from `001` nested inside `003`'s JSON record). It derives cross-spec scenarios, runs them against the **currently implemented** code, and records the result under `specs-chain-test/<chain-id>/`. Follow these steps exactly.

## 0. Resolve the target chain

The chain is an **ordered** list of two or more spec names.

- If `$ARGUMENTS` is non-empty, treat every whitespace-separated token as a `<spec-name>`, **in the given order** — that order is the intended data-flow direction (upstream → downstream). Require at least two; if only one is given, stop and report that a chain needs ≥2 specs (suggest `/spec-test` for a single spec).
- If `$ARGUMENTS` is empty, **auto-derive** the chain:
  1. List `specs/` and keep every entry that has a `spec.md`, sorted by its leading `NNN` number ascending. This ascending numeric order is the default upstream → downstream direction.
  2. Confirm the specs actually couple: read each `spec.md` and keep only specs that are connected by a cross-reference (a later spec's text names an earlier one — e.g. `(001)`, "owned by 002", "defined in 001", a shared entity name). Drop any spec that neither references nor is referenced by another kept spec.
  3. If fewer than two specs remain, stop and report that no cross-spec seam was found; list the available specs (`ls specs/`) and ask the user to pass an explicit chain.
- Verify `specs/<spec-name>/spec.md` exists for every spec in the resolved chain. If any is missing, stop and report the error, listing the available specs (`ls specs/`). Do not guess a different spec.
- Compute `<chain-id>` = the chain's spec names joined with `+`, in chain order — e.g. `001-core-data-models+003-paper-note-persistence`. Print the resolved chain and its direction before continuing.

## 1. Read every spec and its implementation

- Read each chain spec's `spec.md` in full. Also read that spec's `data-model.md` and `contracts/*.md` if present (they carry exact API signatures).
- Read the implementation each spec maps to under `src/`. Use the **actual exported names and signatures** in the code — never invent APIs. Note which specs have real code and which do not: a spec with no implementation yet contributes only SKIP links (see step 3).

## 2. Identify the seams and derive chain scenarios

A **seam** is a concrete coupling point between an upstream spec A and a downstream spec B: a place where B's spec references A's entity/field/function by name and consumes, wraps, or extends it. Find them from B's `Input`, `Assumptions`, `Key Entities`, and `FR-xxx` text (e.g. `003` FR-016: "a serialized `Paper` (001) nested under a `paper` field"; the shared-field subset in `003` FR-002 that mirrors `001`'s `Paper`).

For each adjacent pair (A → B) in the chain, build one **chain scenario** per seam. A chain scenario is a *sequence*, not a single-spec assertion:

1. Construct A's output using A's **real exported API** (e.g. build and validate a `Paper` with `001`'s exported validator/constructor).
2. Feed that output into B's **real exported API** at the seam (e.g. wrap the `Paper` into `003`'s record, then derive the note frontmatter).
3. Assert the **integration invariant the downstream spec states over that seam** — the property that only holds if both sides agree (e.g. every shared field in the note frontmatter equals the same field in the nested `Paper`; a `Paper` that `001` rejects can never become a valid `003` record).

Give each scenario a stable id `C<k>` (k = 1, 2, …) and label it with the pair and seam, e.g. `C1 [001→003] shared frontmatter fields mirror the nested Paper`. Prefer scenarios that genuinely cross a seam over ones that only re-test a single spec — single-spec behavior belongs in `/spec-test`, not here. For a chain of three or more specs, also include at least one **end-to-end** scenario that threads a single artifact through every implemented seam in order.

## 3. Classify testable vs SKIP

A chain scenario is **SKIP/PENDING** (not FAIL) when its seam cannot be exercised against the code that exists today — most commonly because the **downstream** side is not implemented yet (e.g. `003` has no `src/` code, so anything that wraps a `Paper` into a record is SKIP). Record a one-line reason naming which side is missing.

When only part of a seam is exercisable, **split it**: keep the implemented upstream half as a real assertion (e.g. `C2a` asserts `001` produces the exact shape the seam requires) and add a sibling SKIP (`C2b`) for the downstream half that consumes it. Do **not** mark a scenario PASS if it only checks the upstream side — that proves the producer, not the integration. Everything that *can* be exercised end-to-end against the current exports must be a real assertion (PASS/FAIL). The goal: "the implemented seams pass" is unmistakable, separate from "this seam's downstream isn't built yet".

## 4. Create the output folder (overwrite)

- Target folder: `specs-chain-test/<chain-id>/`. If it already exists, regenerate in place (overwrite the test file and report). Do not create timestamped subfolders.

## 5. Write the test file

Write `specs-chain-test/<chain-id>/<chain-id>.chain-test.ts` using the repo's established no-test-runner convention (esbuild + node, as in `specs/001-core-data-models/quickstart.md`). It must:
- Import the real symbols from `src/` via a relative path (from `specs-chain-test/<chain-id>/` that is `../../src/...`). Import from **every** implemented spec in the chain — the point is to use real code from both sides of each seam.
- Define tiny helpers, e.g. `check(id, desc, fn)` that runs `fn()` (throwing = FAIL) and records `{id, desc, status: 'PASS'|'FAIL', error?}`, and `skip(id, desc, reason)`.
- Contain one `check(...)` per testable chain scenario and one `skip(...)` per pending seam, each labelled with its `C<k>` id and the pair/seam text.
- At the end, print one line per case as `[PASS] <id> — <desc>`, `[FAIL] <id> — <desc>: <error>`, or `[SKIP] <id> — <desc> (<reason>)`, then a summary line `Summary: <p> passed, <f> failed, <s> skipped`, and set `process.exitCode = f > 0 ? 1 : 0`.

Keep the assertions honest — a chain assertion must actually thread data across the seam (build with A's API, consume with B's API, assert B's invariant on the result). Do not write tautologies, and do not re-derive a spec's own internal check — drive the real exported functions on both sides. Where the downstream side is missing, the honest form is a SKIP, not a green test that quietly only touches the upstream side.

**Depth of seam testing.** For each exercisable seam, don't stop at the happy path. Also assert at least one **negative** cross-spec property: an upstream value the upstream spec rejects must not be able to produce a valid downstream artifact (e.g. a `Paper` held back by `001` for a missing/NaN year must never yield a valid `003` record), and where the seam mirrors a **subset** of fields, assert that a field *outside* the shared subset does **not** leak across (per `003` FR-002, raw `references`/`schemaVersion`/timestamps stay out of the note frontmatter). These are exactly the properties a single-spec test cannot catch.

## 6. Run project type-check

Run `npx tsc --noEmit` to confirm the implementation under `src/` still type-checks (this is the structural gate; `specs-chain-test/` is outside `tsconfig`'s `include`, so it is not part of this check). Record the result (pass/fail + any output).

## 7. Build and run the test

Bundle and execute the test with esbuild + node, sending the bundle to a temporary file **outside** `specs-chain-test/` and deleting it afterward (only the `.ts` and `report.md` are kept):

```bash
TMP="${TMPDIR:-/tmp}/chain-test-<chain-id>.js"
npx esbuild "specs-chain-test/<chain-id>/<chain-id>.chain-test.ts" --bundle --platform=node --outfile="$TMP" && node "$TMP"; rm -f "$TMP"
```

Capture the full stdout/stderr and the exit code.

## 8. Write the report

Write `specs-chain-test/<chain-id>/report.md` containing:
- A header: the chain (`<spec> → <spec> → …` in order), source branch (`git rev-parse --abbrev-ref HEAD`), date, `tsc --noEmit` result, and the counts `passed / failed / skipped`.
- A **Seam map** section: one line per adjacent pair listing its seams and, for each, whether it is exercised (both sides implemented) or SKIP (which side is missing).
- A table with columns `id | pair/seam | status | note` for every scenario.
- A **Known residual limitations** section: cross-spec behaviors you noticed the current code does not guard (e.g. a downstream that would accept a field the shared subset excludes) but which are outside this suite's asserted scope. List them as notes, not failures — unless they clearly violate a spec's stated integration invariant, in which case they are a real FAIL.
- A fenced block with the raw test run output appended at the end.

## 9. Do not fix code

This command is **report-only**. If scenarios fail, do not modify anything under `src/`. Clearly report which chain scenarios failed and why, and leave remediation to the user.

## 10. Auto-commit (no push)

Stage only the generated artifacts and commit on the current branch — do **not** push:

```bash
git add "specs-chain-test/<chain-id>"
git commit -m "specs-chain-test <chain-id>: <p> passed, <f> failed, <s> skipped"
```

End with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` on its own line in the commit message. Then print a short summary to the user: the resolved chain, the counts, the path to `report.md`, and (if any) the failing scenario ids.
