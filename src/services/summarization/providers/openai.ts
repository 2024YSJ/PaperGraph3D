import { requestUrl } from 'obsidian';
import type { SummarizationProvider } from '../types';
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
// response shape.

const CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const CHAT_MODEL = 'gpt-4o-mini';

function extractChatContent(body: unknown): unknown {
	const choice = asRecord(firstElement(asRecord(body).choices));
	return asRecord(choice.message).content;
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
