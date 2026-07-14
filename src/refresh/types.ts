import type { PaperSourceId } from '../models/paper';
import type { SummarizationInput, SummaryResult } from '../collection/types';

// Transient result of one single-paper refresh (data-model.md § RefreshOutcome).
// 'notFound' = arXiv has no entry for the id, OR the sourceId is absent from the
// store entirely (checked before any provider call). 'error' = the arXiv content
// call failed/timed out — a Semantic Scholar-only failure does NOT produce this
// (FR-021); see refreshOne.ts.
export type RefreshOutcome =
	| { status: 'updated' }
	| { status: 'notFound' }
	| { status: 'alreadyInFlight' }
	| { status: 'error'; message: string };

export interface RefreshHooks {
	// The one narrow 004 contract, reused verbatim from 002 (FR-017, research.md
	// Decision 6) — never the full Paper. Absent when summarization is not wired.
	summarize?: (input: SummarizationInput) => Promise<SummaryResult | undefined>;
}

export interface BulkRefreshResult {
	// Count of matched papers actually processed (success + failure) before the run
	// ended — equal to the whole matched set on a normal run, fewer when cancelled
	// (FR-022, quickstart Scenario 7).
	matchedCount: number;
	failures: { sourceId: PaperSourceId; reason: string }[];
}

// Re-exported so refresh call sites depend on one import surface (contracts/refresh-api.md).
export type { EmbeddingConfig } from '../collection/embeddingUpgrade';
