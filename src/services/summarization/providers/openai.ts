import { requestUrl } from 'obsidian';
import type { LlmEmbeddingProvider, SummarizationProvider } from '../types';

// Reference provider implementations (research.md §4). Both call Obsidian's
// requestUrl (never fetch, constitution Principle I / desktop-mobile parity,
// matching every 002 provider client's precedent). Neither ever needs to inspect
// the isUncited gating itself — hook.ts (via generate.ts) decides whether a
// returned futureDirections value is kept or discarded; this provider always asks
// for both in one call and lets the caller decide what to keep, which keeps the
// provider itself simple and swappable (constitution Principle VI).

const CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';
const CHAT_MODEL = 'gpt-4o-mini';
const EMBEDDING_MODEL = 'text-embedding-3-small';

// A non-2xx response with a 401/403 status is classified invalid-credentials by
// generate.ts's classifyRejection (matched on this exact message substring); any
// other non-2xx is a generic provider-error.
function credentialOrProviderError(status: number): Error {
	if (status === 401 || status === 403) {
		return new Error(`invalid-credentials (status ${status})`);
	}
	return new Error(`provider-error (status ${status})`);
}

// Narrows an untyped JSON body via Record<string, unknown> at each step (never
// `any`), matching the existing pattern in
// src/collection/semanticScholarParser.ts's parseSemanticScholarPaper.
function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function firstElement(value: unknown): unknown {
	return Array.isArray(value) ? value[0] : undefined;
}

function extractChatContent(body: unknown): unknown {
	const choice = asRecord(firstElement(asRecord(body).choices));
	return asRecord(choice.message).content;
}

function extractEmbeddingVector(body: unknown): unknown {
	const entry = asRecord(firstElement(asRecord(body).data));
	return entry.embedding;
}

export const openAiProvider: SummarizationProvider = {
	id: 'openai',
	async generate(input, credential) {
		// Sends only { title, abstract } — never citationCount/citationsKnown, which
		// are this feature's own gating logic, not provider input
		// (contracts/summarization-api.md § providers/openai.ts).
		//
		// The future-directions instruction is deliberately anti-generic: with only
		// title+abstract as input (data-minimization, constitution Principle IV) and
		// no citation graph or corpus comparison, an LLM's default completion for
		// "future directions" tends toward boilerplate that fits almost any paper
		// ("scale to larger datasets", "generalize to other domains", "improve
		// efficiency"). Explicitly forbidding that class of answer and requiring the
		// direction to be grounded in something this specific abstract actually
		// states or implies (a named limitation, open question, or untested case)
		// pushes the model toward abstract-specific text within the same input
		// constraint — it does not, and cannot, fix the ceiling imposed by having no
		// signal beyond the abstract itself.
		//
		// Beyond anti-genericity, the prompt asks for two labeled sub-parts within the
		// single futureDirections string: an "Expected direction" (the obvious
		// same-subfield extension, kept so the reader still gets an overall sense of
		// where this line of work is headed) and an "Alternative direction" (a
		// less-obvious angle reached by connecting the abstract's stated limitation to
		// a different field or technique). This is a prompting device, not a
		// verified-novelty claim: the model cannot check what other researchers have
		// already tried (no citation graph/corpus access here), so "less obvious" only
		// means "less likely to be the model's own first, most statistically probable
		// completion" — surfacing a second, contrasting candidate is a cheap way to
		// steer away from that default without a second API call. Both sub-parts must
		// still ground back to something the abstract itself states or implies, and
		// hype adjectives are banned so any perceived novelty comes from the
		// specificity of the connection, not from tone.
		const prompt =
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
			'directions:" line and its two labeled sentences.';

		const response = await requestUrl({
			url: CHAT_COMPLETIONS_URL,
			method: 'POST',
			contentType: 'application/json',
			headers: { Authorization: `Bearer ${credential}` },
			body: JSON.stringify({
				model: CHAT_MODEL,
				messages: [{ role: 'user', content: prompt }],
			}),
			throw: false,
		});

		if (response.status < 200 || response.status >= 300) {
			throw credentialOrProviderError(response.status);
		}

		const content = extractChatContent(response.json);

		if (typeof content !== 'string') {
			throw new Error('provider-error (malformed response)');
		}

		// Tolerant marker match: case-insensitive, anchored to a line start, and
		// allowing optional surrounding markdown emphasis/heading markers and a
		// colon. The model is instructed to emit "Future directions:" on its own
		// line but doesn't always reproduce that casing/formatting exactly (e.g.
		// "Future Directions", "**Future directions:**", "## Future directions") —
		// an exact-substring match would silently drop the whole future-directions
		// section for an uncited paper. Line-anchoring also avoids splitting on an
		// incidental "future directions" mention inside the summary prose.
		const markerMatch = /(?:^|\n)[#*_ \t]*future\s+directions[#*_ \t]*:?[#*_ \t]*/i.exec(
			content,
		);
		if (markerMatch === null) {
			return { summary: content.trim() };
		}
		return {
			summary: content.slice(0, markerMatch.index).trim(),
			futureDirections: content.slice(markerMatch.index + markerMatch[0].length).trim(),
		};
	},
};

export const openAiEmbeddingProvider: LlmEmbeddingProvider = {
	id: 'openai',
	async embed(title, abstract, credential) {
		// Sends only { title, abstract } via the Embeddings endpoint. `model` in the
		// resolved value is the raw OpenAI model id — embeddingHook.ts, not this
		// provider, applies the llm:<model>:d<dim> formatting (research.md §4).
		const input = abstract.length > 0 ? `${title}\n\n${abstract}` : title;

		const response = await requestUrl({
			url: EMBEDDINGS_URL,
			method: 'POST',
			contentType: 'application/json',
			headers: { Authorization: `Bearer ${credential}` },
			body: JSON.stringify({ model: EMBEDDING_MODEL, input }),
			throw: false,
		});

		if (response.status < 200 || response.status >= 300) {
			throw credentialOrProviderError(response.status);
		}

		const vector = extractEmbeddingVector(response.json);

		if (!Array.isArray(vector)) {
			throw new Error('provider-error (malformed response)');
		}

		return { vector: vector as number[], model: EMBEDDING_MODEL };
	},
};
