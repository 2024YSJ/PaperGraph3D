import type { PaperCandidate, PaperSourceId } from '../models/paper';
import type { EnrichmentOutcome, PipelineHooks, SummaryResult } from './types';
import type { EmbeddingConfig } from './embeddingUpgrade';
import { computeBaselineEmbedding } from './embedding';
import { upgradeEmbedding } from './embeddingUpgrade';
import { enrichFromSemanticScholar } from './enrichment';
import { parseArxivEntry } from './arxivParser';
import { promote } from './promotion';
import { queryArxiv } from './arxivClient';
import { claim, createCollectionRunState } from './dedupe';

export type { PipelineHooks, SummarizationInput, SummaryResult } from './types';

// The candidate array is bounded by the arXiv paging cap (10 pages × 100).
const MAX_CANDIDATES = 1_000;

type EnrichFn = (
	candidates: PaperCandidate[],
	apiKey: string | undefined,
) => Promise<Map<PaperSourceId, EnrichmentOutcome>>;

function yieldToEventLoop(): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, 0));
}

// Two-phase per FR-009/FR-013/research.md Decision 33. Phase 1: drain + dedup + year-gate,
// then ONE batched enrichment call. Phase 2: sequential apply -> promote -> summarize ->
// persist, one paper at a time, yielding to the event loop so a large batch never freezes
// the UI. See contracts/collection-pipeline.md § pipeline.ts.
export async function runCollectionPass(
	candidates: AsyncIterable<PaperCandidate>,
	hooks: PipelineHooks,
	isSummarizationEnabled: () => boolean,
	getSemanticScholarApiKey: () => string | undefined,
	enrich: EnrichFn = enrichFromSemanticScholar,
	getEmbeddingConfig?: () => EmbeddingConfig,
): Promise<void> {
	const state = createCollectionRunState(hooks.alreadyPersisted);

	// Phase 1 — gather survivors.
	const survivors: PaperCandidate[] = [];
	for await (const candidate of candidates) {
		if (survivors.length >= MAX_CANDIDATES) {
			break;
		}
		// FR-011 year gate — a candidate with no promotable year is dropped, not held.
		if (!Number.isFinite(candidate.publicationYear ?? Number.NaN)) {
			continue;
		}
		// FR-009 dedup — already seen this run, or already persisted.
		if (!(await claim(state, candidate.sourceId))) {
			continue;
		}
		survivors.push(candidate);
	}

	if (survivors.length === 0) {
		return;
	}

	// Phase 1 — single batched enrichment call.
	const outcomes = await enrich(survivors, getSemanticScholarApiKey());

	// Phase 2 — sequential per-paper.
	for (const candidate of survivors) {
		const outcome = outcomes.get(candidate.sourceId);
		// Apply an 'enriched' outcome onto the candidate BEFORE promotion, so toPaper derives
		// citationsKnown = true (research.md Decision 33). Other outcomes leave it unchanged.
		const applied: PaperCandidate =
			outcome !== undefined && outcome.status === 'enriched'
				? { ...candidate, citationCount: outcome.citationCount, references: outcome.references }
				: candidate;

		const paper = promote(applied);
		if (paper === undefined) {
			continue;
		}

		// FR-044: attach the mandatory bundled baseline embedding at promotion,
		// before persistence, independent of summarization/LLM (004). It is offline,
		// deterministic, and never blocks — a failure leaves the embedding pending
		// (null) rather than holding the paper back (001 FR-021). When a non-bundled
		// canonical provider is selected the baseline is still stored (pending
		// upgrade) and re-embedded later; the local-transformer / LLM upgrade at this
		// seam is added by a later increment (002 FR-045/FR-046).
		try {
			const baseline = computeBaselineEmbedding(paper.title, paper.abstract);
			paper.embedding = baseline.embedding;
			paper.embeddingModel = baseline.embeddingModel;
			paper.embeddingSource = baseline.embeddingSource;
		} catch {
			// Leave the embedding pending (null); persistence still proceeds.
		}

		// FR-045: upgrade the baseline to the canonical SPECTER2 vector at this seam
		// (read live per paper, so a model downloaded mid-batch takes effect for the
		// rest of it). Returns undefined while the model is absent or on an inference
		// failure, and the baseline is kept as pending upgrade — embedding never blocks
		// persistence (001 FR-021 / 002 FR-046). reembedCorpus converges it later.
		const embeddingConfig = getEmbeddingConfig?.();
		if (embeddingConfig !== undefined) {
			const upgraded = await upgradeEmbedding(
				paper.title,
				paper.abstract,
				embeddingConfig,
			);
			if (upgraded !== undefined) {
				paper.embedding = upgraded.embedding;
				paper.embeddingModel = upgraded.embeddingModel;
				paper.embeddingSource = upgraded.embeddingSource;
			}
		}

		let summary: SummaryResult | undefined;
		if (isSummarizationEnabled() && hooks.summarize !== undefined) {
			try {
				summary = await hooks.summarize({
					title: paper.title,
					abstract: paper.abstract,
					citationCount: paper.citationCount,
					citationsKnown: paper.citationsKnown,
				});
			} catch {
				summary = undefined;
			}
			// Re-check live: if summarization was toggled off while in flight, discard the
			// result (004 FR-009's in-flight-discard, research.md Decision 26).
			if (!isSummarizationEnabled()) {
				summary = undefined;
			}
		}

		try {
			await hooks.persist(paper, summary);
		} catch {
			// One candidate's persist failure never aborts the batch (FR-012).
		}

		await yieldToEventLoop();
	}
}

// The composition point (research.md Decision 24): "a subscription and a window" ->
// candidates (queryArxiv's entries via parseArxivEntry) -> runCollectionPass, returning
// queryArxiv's {truncated, coveredThrough} so the scheduler can record lastCheckedAt at the
// covered boundary and surface truncation. This is startScheduler's runCheck dependency.
export async function runSubscriptionCheck(
	subscription: { type: 'keyword' | 'author' | 'arxivCategory'; value: string },
	window: { from: number; to: number },
	hooks: PipelineHooks,
	isSummarizationEnabled: () => boolean,
	getSemanticScholarApiKey: () => string | undefined,
	enrich?: EnrichFn,
	getEmbeddingConfig?: () => EmbeddingConfig,
): Promise<{ truncated: boolean; coveredThrough: number }> {
	const { entries, truncated, coveredThrough } = await queryArxiv(subscription, window);

	async function* toCandidates(): AsyncIterable<PaperCandidate> {
		for (const entry of entries) {
			const candidate = parseArxivEntry(entry);
			if (candidate !== undefined) {
				yield candidate;
			}
		}
	}

	await runCollectionPass(
		toCandidates(),
		hooks,
		isSummarizationEnabled,
		getSemanticScholarApiKey,
		enrich,
		getEmbeddingConfig,
	);

	return { truncated, coveredThrough };
}
