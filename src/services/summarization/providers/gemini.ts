import { requestUrl } from 'obsidian';
import type { SummarizationProvider } from '../types';
import {
	asRecord,
	buildSummarizationPrompt,
	firstElement,
	splitSummaryAndFutureDirections,
} from './shared';

// Google Gemini generateContent API adapter. Two things differ from the
// OpenAI/Anthropic adapters, so this file does NOT reuse shared.credentialOrProviderError:
//   1. Auth is the `x-goog-api-key` header (the key is never placed in the URL, so
//      it can't leak into request logs).
//   2. A bad/expired key is reported as HTTP 400 (or 403) whose body names an
//      API-key problem, not a bare 401/403 — so credential failures are detected
//      from the response body, not the status alone.
// Calls requestUrl (never fetch). Gemini has an embeddings API, but wiring an
// LlmEmbeddingProvider for it touches the 002-owned embeddingUpgrade seam, so this
// file is summarization-only for now (embedding multi-provider is surfaced
// separately).

const MODEL = 'gemini-2.0-flash';
const GENERATE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// candidates[0].content.parts[0].text carries the reply.
function extractCandidateText(body: unknown): unknown {
	const candidate = asRecord(firstElement(asRecord(body).candidates));
	const part = asRecord(firstElement(asRecord(candidate.content).parts));
	return part.text;
}

// The message substring 'invalid-credentials' is what generate.ts's
// classifyRejection matches to surface the FR-008 credential Notice. Gemini uses
// HTTP 400 with an API_KEY_INVALID reason (or 401/403) for a bad key; every other
// non-2xx is a generic provider-error.
function classifyGeminiError(status: number, body: unknown): Error {
	const bodyText = JSON.stringify(body ?? {});
	const looksLikeKeyProblem =
		status === 401 ||
		status === 403 ||
		/API_KEY_INVALID|API key not valid|API key expired/i.test(bodyText);
	if (looksLikeKeyProblem) {
		return new Error(`invalid-credentials (status ${status})`);
	}
	return new Error(`provider-error (status ${status})`);
}

export const geminiProvider: SummarizationProvider = {
	id: 'gemini',
	async generate(input, credential) {
		const prompt = buildSummarizationPrompt(input);

		const response = await requestUrl({
			url: GENERATE_URL,
			method: 'POST',
			contentType: 'application/json',
			headers: { 'x-goog-api-key': credential },
			body: JSON.stringify({
				contents: [{ parts: [{ text: prompt }] }],
			}),
			throw: false,
		});

		if (response.status < 200 || response.status >= 300) {
			throw classifyGeminiError(response.status, response.json);
		}

		const content = extractCandidateText(response.json);

		if (typeof content !== 'string') {
			throw new Error('provider-error (malformed response)');
		}

		return splitSummaryAndFutureDirections(content);
	},
};
