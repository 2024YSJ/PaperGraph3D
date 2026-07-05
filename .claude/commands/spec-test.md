---
description: Verify the current implementation against a spec under specs/ by generating and running assert-style tests, writing results under specs-test/<spec>/.
argument-hint: "[spec-name]  (e.g. 001-core-data-models; omit to infer from the current branch)"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

You are running the `/spec-test` command. Its job is to check whether the **currently implemented** code satisfies a feature spec under `specs/`, by deriving tests from that spec, running them, and recording the result under `specs-test/<spec-name>/`. Follow these steps exactly.

## 0. Resolve the target spec

- If `$ARGUMENTS` is non-empty, treat the first token as `<spec-name>`.
- Otherwise infer it from the current git branch: run `git rev-parse --abbrev-ref HEAD` and extract the first `NNN-name` segment (regex `[0-9]{3}-[a-z0-9-]+`). Example: `develop-feature/001-core-data-models` → `001-core-data-models`.
- Verify `specs/<spec-name>/spec.md` exists. If it does not, stop and report the error, listing the available specs (`ls specs/`). Do not guess a different spec.

## 1. Read the spec and the implementation

- Read `specs/<spec-name>/spec.md` in full. Also read `specs/<spec-name>/data-model.md` and `specs/<spec-name>/contracts/*.md` if present (they carry exact API signatures).
- Read the implementation the spec maps to under `src/` (for `001-core-data-models`, that is `src/models/*.ts`). Use the **actual exported names and signatures** in the code — never invent APIs. If the spec references behavior that has no corresponding code yet, that item is a SKIP (see step 3).

## 2. Derive test cases

Build one test case per:
- each **Acceptance Scenario** (Given/When/Then) under every User Story,
- each **Success Criteria** item (`SC-xxx`), and
- each **Edge Case** bullet that describes a concrete input → outcome (skip vague ones).

Do **not** create tests from Functional Requirements (`FR-xxx`) directly — they are covered indirectly by the scenarios/SCs. Give each test a stable id: the scenario as `US<n>.<m>`, success criteria as their `SC-xxx` id, and edge cases as `EC-<n>`.

## 3. Classify testable vs SKIP

A test case is **SKIP/PENDING** (not FAIL) when it cannot be verified against the code that exists today — e.g. it depends on an unimplemented feature, file I/O, network, or UI that this spec's implementation does not yet provide. Record a one-line reason for every SKIP. Everything that *can* be exercised against the current exports must be a real assertion (PASS/FAIL). The goal is: "the implemented part passes" is unmistakable, separate from "not yet implemented".

When a Success Criterion is only **partly** verifiable at this layer, split it: keep the verifiable structural part as a real assertion (`SC-xxx`) and add a sibling SKIP (`SC-xxx-<part>`) for the part owned by another feature. Do not mark a case PASS if it only checks a fraction of what the SC claims — decompose instead of over-claiming.

## 4. Create the output folder (overwrite)

- Target folder: `specs-test/<spec-name>/`. If it already exists, regenerate in place (overwrite the test file and report). Do not create timestamped subfolders.

## 5. Write the test file

Write `specs-test/<spec-name>/<spec-name>.spec-test.ts` using the repo's established no-test-runner convention (esbuild + node, as in `specs/001-core-data-models/quickstart.md`). It must:
- Import the real symbols from `src/` via a relative path (from `specs-test/<spec-name>/` that is `../../src/...`).
- Define tiny helpers, e.g. `check(id, desc, fn)` that runs `fn()` (throwing = FAIL) and records `{id, desc, status: 'PASS'|'FAIL', error?}`, and `skip(id, desc, reason)`.
- Contain one `check(...)` per testable case and one `skip(...)` per pending case, each labelled with its id and the scenario/SC text.
- At the end, print one line per case as `[PASS] <id> — <desc>`, `[FAIL] <id> — <desc>: <error>`, or `[SKIP] <id> — <desc> (<reason>)`, then a summary line `Summary: <p> passed, <f> failed, <s> skipped`, and set `process.exitCode = f > 0 ? 1 : 0`.

Keep the assertions honest — assert real observable behavior of the exported functions/types; do not write tautologies (e.g. `key in obj` on a literal). Prefer asserting via the exported validators/functions over re-deriving the implementation's own checks.

**Depth of negative testing.** For any "missing / invalid attribute" scenario, do not stop at deleting the field. For each field also test at least one **present-but-wrong-type** value (so the test proves the validator type-checks rather than merely presence-checks), and for **array/collection** fields test both a non-array value and an array containing an invalid element (to exercise `.every(...)`-style branches). Where the spec says a value may be "unknown / empty", probe the realistic boundary forms (`undefined`, `null`, empty string, non-numeric) — asserting the spec's true guarantee (e.g. "never becomes valid data") through the combined gate, not just one function in isolation.

## 6. Run project type-check

Run `npx tsc --noEmit` to confirm the implementation under `src/` still type-checks (this is the structural gate; `specs-test/` is outside `tsconfig`'s `include`, so it is not part of this check). Record the result (pass/fail + any output).

## 7. Build and run the test

Bundle and execute the test with esbuild + node, sending the bundle to a temporary file **outside** `specs-test/` and deleting it afterward (only the `.ts` and `report.md` are kept):

```bash
TMP="${TMPDIR:-/tmp}/spec-test-<spec-name>.js"
npx esbuild "specs-test/<spec-name>/<spec-name>.spec-test.ts" --bundle --platform=node --outfile="$TMP" && node "$TMP"; rm -f "$TMP"
```

Capture the full stdout/stderr and the exit code.

## 8. Write the report

Write `specs-test/<spec-name>/report.md` containing:
- A header: spec name, source branch (`git rev-parse --abbrev-ref HEAD`), date, `tsc --noEmit` result, and the counts `passed / failed / skipped`.
- A table with columns `id | scenario/SC | status | note` for every case.
- A **Known residual limitations** section: edge behaviors you noticed the implementation does not guard (e.g. a validator that accepts `NaN`, or an unspecified leniency) but which are outside this suite's asserted scope. List them as notes, not failures — unless they clearly violate a spec requirement, in which case they are a real FAIL.
- A fenced block with the raw test run output appended at the end.

## 9. Do not fix code

This command is **report-only**. If tests fail, do not modify anything under `src/`. Clearly report which cases failed and why, and leave remediation to the user.

## 10. Auto-commit (no push)

Stage only the generated artifacts and commit on the current branch — do **not** push:

```bash
git add "specs-test/<spec-name>"
git commit -m "spec-test <spec-name>: <p> passed, <f> failed, <s> skipped"
```

End with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` on its own line in the commit message. Then print a short summary to the user: the counts, the path to `report.md`, and (if any) the failing case ids.
