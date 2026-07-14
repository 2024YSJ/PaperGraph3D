import { requestUrl } from 'obsidian';
import type { LlmEmbeddingProvider, SummarizationProvider } from '../types';
import {
	asRecord,
	buildSummarizationPrompt,
	credentialOrProviderError,
	firstElement,
	splitSummaryAndFutureDirections,
} from './shared';

// OpenAI reference provider (research.md §4). Calls Obsidian's requestUrl (never
// fetch, constitution Principle I / desktop-mobile parity, matching every 002
// provider client's precedent). The prompt and the summary / future-directions
// split live in ./shared so every provider adapter (openai / anthropic / gemini)
// stays byte-identical on that logic; this file owns only the OpenAI transport and
// response shape. This is the one provider that also supplies an embedding upgrade
// (openAiEmbeddingProvider) — Anthropic/Gemini adapters are summarization-only.

const CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';
const CHAT_MODEL = 'gpt-4o-mini';
const EMBEDDING_MODEL = 'text-embedding-3-small';

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
		const prompt = buildSummarizationPrompt(input);

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

		return splitSummaryAndFutureDirections(content);
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
