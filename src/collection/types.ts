// Shared in-memory intermediate types for the collection pipeline (002). None of these
// are persisted (FR-008) — they exist only long enough to turn a provider response into a
// 001 PaperCandidate/Paper. The provider-specific modules re-export the subset the
// contract (contracts/collection-pipeline.md) says they own, so there is a single source
// of truth for each shape and no drift between the two parsers' arXiv-ID handling.

import type { PaperSourceId } from '../models/paper';

// Strips a trailing `vN` arXiv version suffix (e.g. "2301.12345v2" -> "2301.12345").
// Defined once here and called by BOTH arxivParser.ts and semanticScholarParser.ts so a
// directly-collected paper's sourceId and any reference to that same paper arriving via
// Semantic Scholar enrichment always produce byte-identical `arxiv:`-scheme strings —
// what graph edge matching (006, exact sourceId equality) depends on (research.md
// Decision 9/13). Only a version suffix at the very end of the id is removed; an id with
// no such suffix is returned unchanged.
export function stripArxivVersion(rawId: string): string {
	return rawId.replace(/v\d+$/, '');
}

// Derived per run, never persisted. The FRONTIER window that drives lastCheckedAt.
export interface CollectionWindow {
	from: number; // epoch ms
	to: number; // epoch ms
}

// One per <entry> in an arXiv Atom feed (arxivParser.ts intermediate shape).
export interface ArxivEntry {
	arxivId: string; // VERSION-STRIPPED base id
	title: string;
	authors: string[];
	publishedYear: number | undefined; // undefined if <published> missing/unparseable
	abstract: string;
}

// One per Semantic Scholar paper object (semanticScholarParser.ts intermediate shape).
export interface SemanticScholarPaper {
	paperId: string;
	arxivId: string | undefined; // externalIds.ArXiv, VERSION-STRIPPED, when present
	citationCount: number;
	references: SemanticScholarReference[];
}

export interface SemanticScholarReference {
	arxivId: string | undefined; // VERSION-STRIPPED, same rule
	semanticScholarId: string;
}

// Result of enriching one candidate against Semantic Scholar.
export type EnrichmentOutcome =
	| { status: 'enriched'; citationCount: number; references: PaperSourceId[] }
	| { status: 'terminalAbsence' } // arXiv ID has no Semantic Scholar record
	| { status: 'transientFailure' }; // exhausted bounded retries this pass

// Injected 003/004 seams (pipeline.ts). Injected, not imported, so 002 can be built and
// verified before 003/004 exist.
export interface SummarizationInput {
	// Deliberately NOT the full Paper — only the four fields 004 needs (research.md
	// Decision 22), minimizing what leaves the vault to a summarization provider.
	title: string;
	abstract: string;
	citationCount: number;
	citationsKnown: boolean;
}

export interface SummaryResult {
	summary: string;
	futureDirections: string;
}

export interface PipelineHooks {
	summarize?: (input: SummarizationInput) => Promise<SummaryResult | undefined>;
	persist: (paper: import('../models/paper').Paper, summary?: SummaryResult) => Promise<void>;
	alreadyPersisted: (sourceId: PaperSourceId) => Promise<boolean>;
	// Called ONCE at the end of a pass in which the canonical embedding runtime failed,
	// with how many papers it affected. A pass that collects papers the graph cannot
	// place must say so — silently persisting them was how an exhausted runtime went
	// unnoticed for a whole corpus. Not per paper: the failure is one event with a
	// count, and a Notice per paper would be unusable.
	onEmbeddingFailed?: (failure: import('../models/paper').EmbeddingFailure, affected: number) => void;
}

// In-memory dedup state for a single collection run (never survives past one tick/pass).
export interface CollectionRunState {
	seen: Set<PaperSourceId>;
	alreadyPersisted: (id: PaperSourceId) => Promise<boolean>;
}
