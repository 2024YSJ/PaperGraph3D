import { requestUrl } from 'obsidian';
import type { SummarizationProvider } from '../types';
import {
	asRecord,
	buildSummarizationPrompt,
	credentialOrProviderError,
	firstElement,
	splitSummaryAndFutureDirections,
} from './shared';

// Anthropic (Claude) Messages API adapter. Authentication is the `x-api-key`
// header plus the required `anthropic-version` header, and `max_tokens` is
// mandatory — otherwise the shape mirrors the OpenAI adapter. Calls requestUrl
// (never fetch), which issues the request outside the browser fetch stack, so the
// CORS restriction that normally blocks direct browser calls to this API never
// applies (no `anthropic-dangerous-direct-browser-access` header is needed).
//
// Claude has NO first-party embeddings endpoint, so this file exposes only a
// SummarizationProvider. The embedding-upgrade path (embeddingUpgrade.ts, 002-owned)
// is deliberately never widened to Claude — a paper's content vector still comes
// from the bundled baseline / local-transformer / OpenAI-or-Gemini embedding, so a
// Claude summarization user always still gets an x,y position (001 FR-021).

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const CHAT_MODEL = 'claude-3-5-haiku-latest';
// Bounds the reply; the summary + two future-directions sentences fit comfortably.
const MAX_TOKENS = 1024;

// content is an array of typed blocks; the first text block carries the reply.
function extractMessageText(body: unknown): unknown {
	const block = asRecord(firstElement(asRecord(body).content));
	return block.text;
}

export const anthropicProvider: SummarizationProvider = {
	id: 'anthropic',
	async generate(input, credential) {
		const prompt = buildSummarizationPrompt(input);

		const response = await requestUrl({
			url: MESSAGES_URL,
			method: 'POST',
			contentType: 'application/json',
			headers: {
				'x-api-key': credential,
				'anthropic-version': ANTHROPIC_VERSION,
			},
			body: JSON.stringify({
				model: CHAT_MODEL,
				max_tokens: MAX_TOKENS,
				messages: [{ role: 'user', content: prompt }],
			}),
			throw: false,
		});

		if (response.status < 200 || response.status >= 300) {
			throw credentialOrProviderError(response.status);
		}

		const content = extractMessageText(response.json);

		if (typeof content !== 'string') {
			throw new Error('provider-error (malformed response)');
		}

		return splitSummaryAndFutureDirections(content);
	},
};
