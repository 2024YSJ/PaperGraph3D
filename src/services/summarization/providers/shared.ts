import type { SummarizationInput } from '../../../collection/pipeline';

// Shared across every summarization provider adapter (openai / anthropic / gemini):
// the data-minimized prompt and the tolerant summary / future-directions split.
// Authoring these once here — not per provider — keeps each adapter a thin
// transport shim (constitution Principle VI) and guarantees the anti-generic
// future-directions design and the marker-parsing contract stay identical no
// matter which provider is selected.

// Builds the single user prompt sent to whichever provider is configured. Sends
// only { title, abstract } — never citationCount/citationsKnown, which are this
// feature's own gating logic, not provider input
// (contracts/summarization-api.md § providers).
//
// The future-directions instruction is deliberately anti-generic: with only
// title+abstract as input (data-minimization, constitution Principle IV) and no
// citation graph or corpus comparison, a model's default completion for "future
// directions" tends toward boilerplate that fits almost any paper ("scale to
// larger datasets", "generalize to other domains", "improve efficiency").
// Explicitly forbidding that class of answer and requiring the direction to be
// grounded in something this specific abstract actually states or implies (a named
// limitation, open question, or untested case) pushes the model toward
// abstract-specific text within the same input constraint — it does not, and
// cannot, fix the ceiling imposed by having no signal beyond the abstract itself.
//
// Beyond anti-genericity, the prompt asks for two labeled sub-parts within the
// single futureDirections string: an "Expected direction" (the obvious
// same-subfield extension, kept so the reader still gets an overall sense of where
// this line of work is headed) and an "Alternative direction" (a less-obvious
// angle reached by connecting the abstract's stated limitation to a different field
// or technique). This is a prompting device, not a verified-novelty claim: the
// model cannot check what other researchers have already tried (no citation
// graph/corpus access here), so "less obvious" only means "less likely to be the
// model's own first, most statistically probable completion" — surfacing a second,
// contrasting candidate is a cheap way to steer away from that default without a
// second API call. Both sub-parts must still ground back to something the abstract
// itself states or implies, and hype adjectives are banned so any perceived novelty
// comes from the specificity of the connection, not from tone.
export function buildSummarizationPrompt(input: SummarizationInput): string {
	return (
		`Title: ${input.title}\n\nAbstract: ${input.abstract}\n\n` +
		'Write a concise summary of this paper (2-4 sentences), then on a new line ' +
		'starting with "Future directions:", identify ONE concrete limitation, open ' +
		'question, assumption, or untested case that this abstract itself states or ' +
		'implies. Using that same limitation, write exactly two labeled sentences:\n' +
		'"Expected direction:" — the one-sentence extension a follow-up paper in this ' +
		'exact subfield would most likely try first.\n' +
		'"Alternative direction:" — one sentence proposing a different angle on the ' +
		'same limitation by connecting it to a technique, framing, or method not ' +
		'typically used in this exact subfield — something a researcher narrowly ' +
		'focused on this subfield would be less likely to reach for first.\n' +
		'Both sentences must stay grounded in the limitation identified above — do ' +
		'not introduce a new, unrelated limitation for the second sentence. Do not ' +
		'give a generic suggestion that could apply to nearly any paper in the field ' +
		'(e.g. "test on larger datasets", "generalize to other domains", "improve ' +
		'efficiency", "validate on real-world data") unless the abstract ' +
		'specifically flags that exact gap. Do not use hype words like "novel", ' +
		'"groundbreaking", "revolutionary", or "unprecedented" — express any novelty ' +
		'through the specific technique or connection named, not through adjectives. ' +
		'Respond in plain text only, with the summary followed by the "Future ' +
		'directions:" line and its two labeled sentences.'
	);
}

// Tolerant marker match: case-insensitive, anchored to a line start, and allowing
// optional surrounding markdown emphasis/heading markers and a colon. Every model
// is instructed to emit "Future directions:" on its own line but doesn't always
// reproduce that casing/formatting exactly (e.g. "Future Directions",
// "**Future directions:**", "## Future directions") — an exact-substring match
// would silently drop the whole future-directions section for an uncited paper.
// Line-anchoring also avoids splitting on an incidental "future directions" mention
// inside the summary prose.
const FUTURE_DIRECTIONS_MARKER = /(?:^|\n)[#*_ \t]*future\s+directions[#*_ \t]*:?[#*_ \t]*/i;

// Splits a plain-text completion into the summary and (when present) the
// future-directions text. Whether a returned futureDirections value is kept or
// discarded is decided upstream by hook.ts/generate.ts (the isUncited gate), never
// here — the provider always splits and lets the caller decide.
export function splitSummaryAndFutureDirections(content: string): {
	summary: string;
	futureDirections?: string;
} {
	const markerMatch = FUTURE_DIRECTIONS_MARKER.exec(content);
	if (markerMatch === null) {
		return { summary: content.trim() };
	}
	return {
		summary: content.slice(0, markerMatch.index).trim(),
		futureDirections: content.slice(markerMatch.index + markerMatch[0].length).trim(),
	};
}

// Narrows an untyped JSON body via Record<string, unknown> at each step (never
// `any`), matching the existing pattern in
// src/collection/semanticScholarParser.ts's parseSemanticScholarPaper.
export function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

export function firstElement(value: unknown): unknown {
	return Array.isArray(value) ? value[0] : undefined;
}

// A non-2xx response with a 401/403 status is classified invalid-credentials by
// generate.ts's classifyRejection (matched on this exact message substring); any
// other non-2xx is a generic provider-error. Shared by the OpenAI and Anthropic
// adapters, both of which use HTTP 401/403 for authentication failures. (Gemini
// reports a bad key differently and classifies its own errors.)
export function credentialOrProviderError(status: number): Error {
	if (status === 401 || status === 403) {
		return new Error(`invalid-credentials (status ${status})`);
	}
	return new Error(`provider-error (status ${status})`);
}
