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

const MODEL = 'gemini-3-flash-preview';
const GENERATE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// gemini-3 flash is a "thinking" model: by default it spends a large hidden
// reasoning budget before answering, which for this summarization prompt runs
// ~10s+ per call and, on a throttled free tier or a long abstract, routinely
// breaches generate.ts's GENERATION_TIMEOUT_MS (20s) — every such call then aborts
// and falls back to the raw abstract (FR-007). A summary of a title+abstract needs
// no extended chain-of-thought, so we disable it (thinkingBudget: 0), which cuts
// latency to ~2s and keeps calls well inside the timeout without changing the
// output contract. This lives in the request body (a Gemini-only knob) rather than
// in the shared timeout, so the OpenAI/Anthropic adapters are untouched.
const THINKING_DISABLED = { thinkingConfig: { thinkingBudget: 0 } };

// candidates[0].content.parts[0].text carries the reply.
function extractCandidateText(body: unknown): unknown {
	const candidate = asRecord(firstElement(asRecord(body).candidates));
	const part = asRecord(firstElement(asRecord(candidate.content).parts));
	return part.text;
}

// The message substring 'invalid-credentials' is what generate.ts's
// classifyRejection matches to surface the FR-008 credential Notice and the
// rate-limit Notice. Gemini uses HTTP 400 with an API_KEY_INVALID reason (or
// 401/403) for a bad key, and HTTP 429 with a RESOURCE_EXHAUSTED status for a
// rate/quota limit; every other non-2xx is a generic provider-error.
function classifyGeminiError(status: number, body: unknown): Error {
	const bodyText = JSON.stringify(body ?? {});
	const looksLikeKeyProblem =
		status === 401 ||
		status === 403 ||
		/API_KEY_INVALID|API key not valid|API key expired/i.test(bodyText);
	if (looksLikeKeyProblem) {
		return new Error(`invalid-credentials (status ${status})`);
	}
	const looksRateLimited =
		status === 429 || /RESOURCE_EXHAUSTED|rate limit|quota/i.test(bodyText);
	if (looksRateLimited) {
		return new Error(`rate-limited (status ${status})`);
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
				generationConfig: THINKING_DISABLED,
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
