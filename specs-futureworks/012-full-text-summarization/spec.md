# Feature Specification: Full-Text Paper Summarization

**Feature Branch**: `012-full-text-summarization`

**Created**: 2026-07-19

**Status**: Future Work (deferred — implement after the core plugin 001–008 is complete, and layered on 004)

**Input**: "Instead of summarizing only a paper's abstract, fetch the paper's full text and have the summarization API summarize the whole paper, placing that full-text summary in the same summary slot the abstract-based summary uses today. When the full text can't be obtained, fall back to the current abstract-based summary (004), and if that isn't available either, to the raw abstract."

> **Note (why this is future work):** Feature 004 (Paper Summarization) deliberately sends the provider **only each paper's title and abstract** (004 FR-013, `SummarizationInput` = `{ title, abstract, citationCount, citationsKnown }`) and writes the generated summary into the 003 managed region. That keeps the external data path minimal and the generation fast/cheap. This feature widens the input to the paper's **full text** — a materially larger external data path, a larger cost/latency/token budget, and a new full-text-acquisition step — so it is recorded here as a follow-on that builds on 004's provider/credential/managed-region machinery without disturbing 004's shipped behavior. It reuses 004's `SummarizationProvider` interface, its off-by-default opt-in, its fallback discipline, and its managed-region write target; it adds only *where the text to summarize comes from*.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Summarize the whole paper, not just the abstract (Priority: P1)

As a researcher, when a paper is collected, I want its note's summary to reflect the *entire* paper — methods, results, and conclusions — not only what the abstract chose to advertise, so that I can judge a paper's substance without opening the PDF.

**Why this priority**: This is the whole point of the feature. An abstract-only summary (004) often just paraphrases the abstract; a full-text summary is the value this feature adds. Everything else (acquisition fallbacks, cost bounds, disclosure) makes it safe and reliable.

**Independent Test**: With the feature on and valid (stubbed) credentials, persist a paper whose (stubbed) full text is available and differs from its abstract. Confirm the summary written into the note's managed region is derived from the full-text content (not the abstract) and lands in the same summary slot the abstract-based summary uses today.

**Acceptance Scenarios**:

1. **Given** the feature is on with valid credentials and a paper whose full text is retrievable, **When** the paper is persisted, **Then** the full text is sent to the configured provider and the returned summary is written into the paper's canonical JSON record and mirrored into the note's managed region — in the same summary field 004 uses.
2. **Given** the feature is on, **When** a full-text summary is produced, **Then** the paper's record records that the summary was derived from full text (provenance), distinct from an abstract-derived summary.
3. **Given** the feature is off, **When** a paper is persisted, **Then** behavior is identical to 004 (abstract-based summary if 004 is on, raw abstract otherwise) and no full text is fetched or sent anywhere.

---

### User Story 2 - Graceful fallback when full text is unavailable (Priority: P1)

As a user, I don't want papers to be skipped or notes left blank just because a paper is paywalled, has no open-access PDF, or its text can't be extracted — I want the best summary obtainable for each paper.

**Why this priority**: Full text is *not* available for every paper (paywalls, no open-access PDF, non-arXiv sources, extraction failure). Without a defined fallback chain the feature would be unusable on a real corpus. This bound is what makes it safe to turn on.

**Independent Test**: Persist three papers — one with retrievable full text, one whose full text cannot be obtained (with 004 on), and one whose full text cannot be obtained (with 004 off). Confirm the first gets a full-text summary, the second gets an abstract-based summary (004), and the third gets the raw abstract; none fails to persist.

**Acceptance Scenarios**:

1. **Given** a paper whose full text cannot be retrieved or extracted, **When** it is persisted with 004 (abstract summarization) enabled, **Then** it falls back to the abstract-based summary and the paper is still saved.
2. **Given** a paper whose full text cannot be retrieved and 004 is disabled, **When** it is persisted, **Then** the note is created with the raw abstract, exactly as if this feature were off.
3. **Given** full-text acquisition or the full-text generation call fails, times out, or returns empty/too-short text, **When** persistence proceeds, **Then** it degrades down the chain (full text → 004 abstract summary → raw abstract) and never blocks record/note creation.

---

### User Story 3 - Disclosure and opt-in for the widened data path (Priority: P1)

As a privacy-conscious user, before any full paper text leaves my vault, I want to be told explicitly that the *entire* paper (not just the abstract) will be sent to my configured provider, and I want the feature off until I turn it on.

**Why this priority**: Sending a full paper to a third-party API is a materially larger disclosure obligation than 004's title+abstract (constitution Principle IV). Getting consent and disclosure right is a shipping prerequisite, not a refinement.

**Independent Test**: Inspect the settings disclosure copy this feature contributes; confirm it states that full paper text is sent, that it is off by default, and that credentials are stored in plaintext. Confirm that with the feature never enabled, zero full-text fetches or provider calls occur.

**Acceptance Scenarios**:

1. **Given** the settings screen, **When** the user views this feature's section, **Then** it discloses that the full paper text is transmitted to the configured provider, distinct from 004's title+abstract disclosure.
2. **Given** the feature has never been enabled, **When** papers are collected, **Then** no full text is downloaded and no provider call is made by this feature.

---

### Edge Cases

- A paper has no open-access PDF / full-text source (paywalled, or a Semantic Scholar record without `openAccessPdf`) → no full text; degrade to 004's abstract summary, then to the raw abstract. Not an error.
- A full text is retrievable but text extraction yields little or no usable text (scanned-image PDF, extraction failure) → treated as "full text unavailable"; degrade down the chain.
- A full text is very large (exceeds the provider's context/token budget) → it is bounded before sending (truncated and/or chunked per the acquisition policy, OQ-3); the summary is produced from the bounded input, and the record notes that the summary was derived from a truncated full text if truncation occurred.
- The full-text fetch is slow → it is bounded by a timeout separate from (and typically larger than) 004's generation timeout, so a hung download can never stall collection (mirrors 004 FR-007 / 002 FR-013's non-freezing rule).
- The provider reports a rate limit / quota exhaustion (HTTP 429) on a full-text call → the same throttled, once-per-window notice as 004 FR-008a applies, and the paper degrades down the fallback chain; persistence is never blocked.
- The feature is turned off while a full-text fetch or generation is in flight → the in-flight work is discarded and the note is completed via the 004/abstract fallback; no other feature stops working.
- A paper is re-collected or manually refreshed (005) after having only an abstract-based summary, once full text has become available → whether the summary is upgraded to a full-text one is governed by the recomputation policy (OQ-5); by default text generated once is kept (mirrors 004 OQ-4).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The user MUST be able to turn full-text summarization on or off in settings; it MUST default to **off** (opt-in), independent of 004's own summarization toggle.
- **FR-002**: When the feature is on and a paper's full text is obtainable, the system MUST send the paper's full text (bounded per FR-009) to the configured summarization provider and write the returned summary into the same canonical summary field 004 uses — in the JSON record and mirrored into the 003 managed region — never into the user's free-form body.
- **FR-003**: The feature MUST reuse 004's `SummarizationProvider` abstraction and the user's configured provider/credentials rather than introduce a second provider surface; it changes *what text is summarized*, not *who summarizes it*.
- **FR-004**: When the full text cannot be obtained, extracted, or summarized (unavailable, extraction-empty, fetch/generation failure, timeout, empty/too-short result), the feature MUST fall back — in order — to (a) 004's abstract-based summary if 004 is enabled, then (b) the raw abstract — and MUST still complete record/note creation. It MUST NOT block persistence or skip the paper.
- **FR-005**: When the feature is off, behavior MUST be byte-for-byte identical to 004 alone (abstract summary if 004 on, raw abstract otherwise), and no full text may be fetched and no full-text provider call made.
- **FR-006**: A summary derived from full text MUST carry provenance in the canonical record distinguishing it from an abstract-derived summary (004) and from the raw abstract, so downstream features and the user can tell which source produced the visible summary.
- **FR-007**: Full-text acquisition MUST NOT freeze the interface and MUST be bounded by its own timeout, separate from 004's generation timeout; a slow or hung download MUST degrade to the fallback chain rather than stall collection (002 FR-013).
- **FR-008**: If the provider reports invalid credentials, the user MUST be informed (as 004 FR-008); if it reports a rate limit / quota exhaustion (HTTP 429), the user MUST be informed at most once per throttle window while every affected paper still degrades down the fallback chain (as 004 FR-008a).
- **FR-009**: Full text sent to the provider MUST be bounded to stay within the provider's context/cost budget (truncation and/or chunking); if the input was truncated, the record MUST note that the summary was derived from a truncated full text.
- **FR-010**: Before the user can enable this feature, the settings UI MUST disclose that the **entire paper text** (not merely title and abstract) is transmitted to the configured provider, that this is a larger data path than 004's, that the credential is stored in plaintext, and that the feature is off until explicitly enabled (constitution Principle IV). This disclosure is distinct from and additional to 004's title+abstract disclosure.
- **FR-011**: Turning the feature off MUST prevent any further full-text fetches and full-text provider calls, including discarding any in-flight acquisition or generation.
- **FR-012**: The feature MUST only fetch full text for a paper the pipeline is already collecting/persisting, from that paper's own advertised full-text source (e.g. arXiv PDF, Semantic Scholar `openAccessPdf`); it MUST NOT crawl, follow arbitrary links, or fetch any other paper's content.

### Key Entities

- **Full-Text Source**: A per-paper pointer to the paper's retrievable full text, derived from the paper's arXiv id (see *Full-Text Acquisition Method* below) or, where enrichment supplies it, a Semantic Scholar `openAccessPdf` URL. Present for some papers, absent for others; its absence is the primary trigger for the FR-004 fallback chain.
- **Extracted Full Text**: The plain text obtained from the full-text source, bounded per FR-009 before it is sent to the provider. Transient — used to produce the summary, not necessarily persisted (OQ-4).
- **Summary Provenance**: A marker on the canonical record recording which source produced the visible summary — full text (optionally truncated), 004 abstract summary, or raw abstract (FR-006).
- **Full-Text Summarization Settings**: This feature's own off-by-default toggle plus its acquisition bounds (fetch timeout, size/token cap), layered on 004's provider/credential surface. Surfaced in the summarization section of the settings screen (008).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With the feature on and full text available, 100% of such papers' visible summaries are derived from full text (not the abstract) and occupy the same summary slot 004 uses, with provenance recorded.
- **SC-002**: For every paper whose full text is unavailable or fails to process, the paper is still saved, with the best available fallback summary (004 abstract summary, else raw abstract) — zero papers fail to persist because of this feature.
- **SC-003**: With the feature off (or never enabled), the set of stored records/notes is byte-for-byte identical to 004 alone, and zero full-text fetches or full-text provider calls occur.
- **SC-004**: No full text for any paper other than the one being persisted, and no non-source URL, is ever fetched.
- **SC-005**: A large full text is bounded before sending and never causes collection to freeze or a provider call to exceed the configured budget.

## Assumptions

- The paper's canonical record (001/002) carries enough to derive a full-text source for open-access papers — chiefly the arXiv id (arXiv PDF URL) and, where enrichment supplies it, a Semantic Scholar `openAccessPdf` URL. Papers without either simply have no full-text source and use the fallback chain.
- This feature runs inside 002's existing per-paper pipeline at the same point 004's `summarize` hook runs (before 003 persistence), so it can hand its result to 003 as part of a single persist, exactly as 004 does.
- The plugin is desktop-only (`isDesktopOnly: true`), so downloading and extracting a PDF locally is acceptable within the platform constraints, unlike on mobile.
- 004's provider/credential configuration is the source of truth for *who* summarizes; this feature does not add a second provider or key, only its own toggle and acquisition bounds.

## Full-Text Acquisition Method (arXiv)

*Researched 2026-07-19. This section documents **how** a paper's full text is obtained, since it is the one genuinely new mechanism this feature introduces (the rest reuses 004).*

**The arXiv API does not return full text.** The query API (`http://export.arxiv.org/api/query`) that 002 already uses returns an **Atom XML feed of metadata only** — title, authors, abstract (`<summary>`), categories, and a set of `<link>` elements (including one `<link title="pdf" ...>` pointing at the PDF URL). There is no full-text field in the API response. The abstract this feature is trying to improve on is, in fact, the *most* the API itself gives. Full text must therefore be fetched from arXiv's **content endpoints** in a second, separate step, keyed by the paper's arXiv id (which 002 already stores, version-stripped, on the record).

Given an arXiv id `{id}` (and, where fidelity matters, a specific version `v{n}`), the retrievable full-text forms are:

- **Native HTML** — `https://arxiv.org/html/{id}v{n}`. arXiv has published experimental first-party **HTML renderings** of papers submitted as TeX/LaTeX since December 2023, and is converting the back-corpus (roughly 75% error-free as of early 2026). This is the **preferred source** when present: it is already text/markup, so it needs **no PDF binary parsing**, and structure (section headings, abstract, body) survives. Coverage is partial — papers with no LaTeX source (older scanned/PDF-only deposits) have no HTML. A community fallback renderer, **ar5iv** (`https://ar5iv.labs.arxiv.org/html/{id}`), covers many papers arXiv's own HTML does not.
- **PDF** — `https://arxiv.org/pdf/{id}` (content type `application/pdf`, delivered uncompressed). Universally available, but requires a local **PDF→plain-text extraction** step (a bundled extractor; see OQ-2), which is lossy on multi-column layouts, math, and figures, and yields nothing usable for scanned-image PDFs.
- **LaTeX source** — `https://arxiv.org/e-print/{id}` (a single file, or a gzipped tar of the `.tex` sources for multi-file submissions; `/src/{id}` always returns the tar form). Highest fidelity, but requires stripping/normalizing TeX markup, which is its own parsing problem.

**Preferred order for this feature:** native HTML (`/html/`) → ar5iv → PDF-with-extraction, with the whole chain feeding FR-004's degrade-to-abstract fallback if none yields usable text. HTML-first keeps the plugin free of a heavy PDF-parsing dependency for the common (recent-paper) case, which matters because 002's only discovery source is arXiv and this feature targets the recent papers arXiv is most likely to have HTML for.

**Operational constraints carried from arXiv's guidance:**

- **Use `export.arxiv.org` and rate-limit.** Programmatic/bulk retrieval must target the `export.arxiv.org` mirror set aside for it, and honor arXiv's request-rate guidance (roughly **no more than one request every ~3 seconds**, no aggressive bursts). This reuses/extends 002's existing arXiv-client throttle rather than opening a second unthrottled fetch path (FR-007, FR-012).
- **Licensing.** The default arXiv license grants arXiv the right to distribute a work but does **not** grant third parties an unrestricted right to redistribute full text. Sending the text transiently to the user's *own* configured provider to produce a summary is the user's action on their own behalf; **persisting/caching the extracted full text in the vault** (OQ-4) is the part that a redistribution-wary design should weigh, and is why caching is left an open question rather than assumed.
- **Not the bulk channel.** arXiv also offers whole-corpus bulk access (Amazon S3 requester-pays `s3://arxiv/`, plus OAI-PMH for metadata). That is for harvesting the entire corpus and is explicitly **out of scope** — this feature fetches only the single paper the pipeline is already persisting (FR-012).

## Open Questions

*Recorded for when this feature is picked up; none are settled.*

- **OQ-1 — Which acquisition sources to actually wire.** The *Full-Text Acquisition Method* section settles that the arXiv API is metadata-only and that HTML (`/html/` → ar5iv) → PDF → LaTeX source are the real options, HTML-first. Still open: do we ship only the HTML path first (no PDF dependency) and treat "no HTML" as full-text-unavailable, or also wire PDF extraction on day one? And do we additionally consult Semantic Scholar `openAccessPdf` for non-arXiv-hosted full text, or stay arXiv-only to match 002's discovery source?
- **OQ-2 — PDF text-extraction dependency (only if the PDF path is wired).** If PDF is a source (OQ-1), extraction needs a bundled library (e.g. a `pdf.js`-style extractor) or Electron/Node facilities. Which one, and how large is the bundle cost within the single-`main.js` model? Does it interact with the deferred local-transformer runtime (002 T039)? Choosing HTML-only in OQ-1 avoids this dependency entirely.
- **OQ-3 — Bounding policy (truncation vs chunking).** When a paper exceeds the provider's context budget, is it truncated (first N tokens / intro+conclusion heuristic) or chunked-and-reduced (map-reduce summarization)? Chunking multiplies provider calls and cost per paper — how does that share 004/002's rate-limit budget?
- **OQ-4 — Persist the extracted full text?** Is the extracted text cached on the record (faster re-summarize, larger vault, larger data-at-rest) or discarded after generating the summary (re-fetch on recompute)?
- **OQ-5 — Recomputation / upgrade path.** If a paper first got an abstract summary (no full text then) and full text later becomes available (re-collect / manual refresh 005), is the summary upgraded to a full-text one, or kept as first generated (mirroring 004 OQ-4)?
- **OQ-6 — Cost/latency guardrails.** Full-text summarization is much more expensive and slower than 004's abstract calls. Is there a per-run or per-paper budget, a longer generation timeout tier, or a user-visible cost warning, so a large backfill doesn't run up a surprise bill?
- **OQ-7 — Model choice.** Full text needs a larger-context (and often costlier) model than 004's pinned cheap defaults (`gpt-4o-mini`, etc.). Does this feature pin its own larger-context default per provider, or reuse 004's model (risking truncation)? Interacts with 004's deferred per-provider model selection.

## Out of Scope

- Collecting papers (002) and persisting the record/note pairing (003) are unchanged; this feature only changes the *text handed to the summarizer* and hands its result to 003 as managed content, exactly as 004 does.
- The abstract-based summarization path, provider interface, credential handling, and future-directions text remain owned by 004; this feature reuses them and adds full-text acquisition + a fallback into them.
- Citation status and future-directions gating (004 FR-004) are unchanged; if future-directions text is generated, whether it too is derived from full text follows the same FR-004 fallback and is otherwise 004's concern.
- Embeddings are unaffected — they come from the fixed on-device model (002 FR-045, constitution v1.3.0); this feature touches only summary text, never the vector used by the 006/007 layout.
- Refreshing citation data (005) is separate; this feature only reads a paper's full-text source to decide what to summarize.
- No new subscription type, no crawling beyond a paper's own advertised full-text source, and no bulk PDF archival in the vault are part of this feature.
