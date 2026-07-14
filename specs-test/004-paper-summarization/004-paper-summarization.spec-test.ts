// Spec-test for 004-paper-summarization — derived from
// specs/004-paper-summarization/spec.md against the real src/services/summarization
// exports. Report-only, DETERMINISTIC: every provider is an in-process fake, so no
// live network call is ever made. Scenarios owned by the 002 pipeline (enabled-flag
// gating, in-flight discard) or 003 note rendering, and reembed.ts's module-private
// isCanonical(), are recorded as SKIP with a reason — the pure logic this feature owns
// (hook gating, generation classification, uncited detection, embedding naming) is
// asserted directly. Run via esbuild + node with `--alias:obsidian=./_obsidian-shim.ts`.

// Node has no `window`; generate.ts's withTimeout() uses window.setTimeout/clearTimeout
// (the same convention used throughout src/collection/*.ts).
(globalThis as unknown as { window: typeof globalThis }).window = globalThis;

import { createSummarizeHook } from '../../src/services/summarization/hook';
import { openAiProvider } from '../../src/services/summarization/providers/openai';
import { anthropicProvider } from '../../src/services/summarization/providers/anthropic';
import { geminiProvider } from '../../src/services/summarization/providers/gemini';
import {
	resolveSummarizationProvider,
	SUMMARIZATION_PROVIDER_IDS,
} from '../../src/services/summarization/providers/registry';
import { __setNextResponse, type RequestUrlResponse } from './_obsidian-shim';
import {
	llmEmbeddingUpgrade,
	type EmbeddingHookConfig,
} from '../../src/services/summarization/embeddingHook';
import { isUncited } from '../../src/services/summarization/isUncited';
import {
	MIN_GENERATED_TEXT_LENGTH,
	SUMMARIZATION_DISCLOSURE_COPY,
	llmEmbeddingModelId,
} from '../../src/services/summarization/constants';
import type {
	LlmEmbeddingProvider,
	SummarizationProvider,
} from '../../src/services/summarization/types';
import type { SummarizationInput } from '../../src/collection/pipeline';

type Result = { id: string; desc: string; status: 'PASS' | 'FAIL' | 'SKIP'; note?: string };
const results: Result[] = [];
function assert(cond: unknown, msg: string): void { if (!cond) throw new Error(msg); }
async function check(id: string, desc: string, fn: () => void | Promise<void>): Promise<void> {
	try { await fn(); results.push({ id, desc, status: 'PASS' }); }
	catch (err) { results.push({ id, desc, status: 'FAIL', note: err instanceof Error ? err.message : String(err) }); }
}
function skip(id: string, desc: string, reason: string): void { results.push({ id, desc, status: 'SKIP', note: reason }); }

const LONG = 'x'.repeat(MIN_GENERATED_TEXT_LENGTH + 5); // comfortably over the too-short threshold
const SHORT = 'y'.repeat(MIN_GENERATED_TEXT_LENGTH - 5); // under the threshold

function citedInput(over: Partial<SummarizationInput> = {}): SummarizationInput {
	return { title: 'T', abstract: 'A', citationCount: 5, citationsKnown: true, ...over };
}
function uncitedInput(over: Partial<SummarizationInput> = {}): SummarizationInput {
	return { title: 'T', abstract: 'A', citationCount: 0, citationsKnown: true, ...over };
}

// A summarization fake whose generate() is fully controlled per scenario, tracking
// how many times it was called so "no call attempted" can be asserted directly.
function fakeSummarizer(
	id: string,
	generate: SummarizationProvider['generate'],
): { provider: SummarizationProvider; calls: () => number } {
	let count = 0;
	const provider: SummarizationProvider = {
		id,
		generate: (input, credential, signal) => { count += 1; return generate(input, credential, signal); },
	};
	return { provider, calls: () => count };
}

function fakeEmbedder(
	id: string,
	embed: LlmEmbeddingProvider['embed'],
): { config: EmbeddingHookConfig; calls: () => number } {
	let count = 0;
	const provider: LlmEmbeddingProvider = {
		id,
		embed: (title, abstract, credential, signal) => { count += 1; return embed(title, abstract, credential, signal); },
	};
	return { config: { getProvider: () => provider }, calls: () => count };
}

// Fires any window.setTimeout callback on the next tick regardless of its delay, so
// the real 20s generation timeout can be exercised without waiting 20s. Restores the
// original afterward. The fake provider under test never resolves, so the timeout
// branch is the only thing that can settle the race.
async function withImmediateTimers<T>(fn: () => Promise<T>): Promise<T> {
	const original = window.setTimeout;
	(window as unknown as { setTimeout: typeof setTimeout }).setTimeout =
		((cb: (...args: unknown[]) => void) => original(cb, 0)) as unknown as typeof setTimeout;
	try { return await fn(); }
	finally { (window as unknown as { setTimeout: typeof setTimeout }).setTimeout = original; }
}

async function main() {
	// =================================================================
	// US1 — opt in to summaries
	// =================================================================
	await check('US1.1/SC-001', 'Unconfigured provider → undefined, generate never called', async () => {
		const fake = fakeSummarizer('openai', () => Promise.resolve({ summary: LONG }));
		const hook = createSummarizeHook({
			getProvider: () => undefined, getCredential: () => 'k', notifyCredentialProblem: () => {},
		});
		const r = await hook(citedInput());
		assert(r === undefined, 'hook resolves undefined when no provider configured');
		assert(fake.calls() === 0, 'the fake generate was never invoked');
	});
	await check('US1.2', 'Missing/empty credential → undefined, generate never called', async () => {
		const fake = fakeSummarizer('openai', () => Promise.resolve({ summary: LONG }));
		const hook = createSummarizeHook({
			getProvider: () => fake.provider, getCredential: () => '   ', notifyCredentialProblem: () => {},
		});
		const r = await hook(citedInput());
		assert(r === undefined, 'whitespace-only credential is treated as not configured');
		assert(fake.calls() === 0, 'no generation attempted without a real credential');
	});
	await check('US1.3/SC-001', 'Configured + valid summary → { summary, futureDirections: "" } for a cited paper', async () => {
		const hook = createSummarizeHook({
			getProvider: () => fakeSummarizer('openai', () => Promise.resolve({ summary: LONG })).provider,
			getCredential: () => 'k', notifyCredentialProblem: () => {},
		});
		const r = await hook(citedInput());
		assert(r !== undefined && r.summary === LONG, 'summary returned');
		assert(r !== undefined && r.futureDirections === '', 'cited paper gets no future-directions text');
	});
	await check('US1.4', 'Empty/too-short summary → undefined (abstract fallback)', async () => {
		const hook = createSummarizeHook({
			getProvider: () => fakeSummarizer('openai', () => Promise.resolve({ summary: SHORT })).provider,
			getCredential: () => 'k', notifyCredentialProblem: () => {},
		});
		const r = await hook(citedInput());
		assert(r === undefined, 'a summary under the trimmed threshold falls back, never a partial summary');
	});
	await check('US1.5', 'Provider rejects (generic) → undefined, no unhandled rejection', async () => {
		const hook = createSummarizeHook({
			getProvider: () => fakeSummarizer('openai', () => Promise.reject(new Error('network down'))).provider,
			getCredential: () => 'k', notifyCredentialProblem: () => {},
		});
		const r = await hook(citedInput());
		assert(r === undefined, 'a generic provider rejection falls back to the abstract');
	});
	await check('US1.6', 'Timeout → undefined (never blocks note creation)', async () => {
		let notified = 0;
		const hook = createSummarizeHook({
			getProvider: () => fakeSummarizer('openai', () => new Promise(() => {})).provider, // never resolves
			getCredential: () => 'k', notifyCredentialProblem: () => { notified += 1; },
		});
		const r = await withImmediateTimers(() => hook(citedInput()));
		assert(r === undefined, 'a hung provider resolves undefined via the bounded timeout');
		assert(notified === 0, 'a timeout is a silent fallback, not a credential problem');
	});
	await check('US1.7/SC-004', 'Resolved value is always exactly undefined or { summary, futureDirections } — no body field', async () => {
		const okHook = createSummarizeHook({
			getProvider: () => fakeSummarizer('openai', () => Promise.resolve({ summary: LONG })).provider,
			getCredential: () => 'k', notifyCredentialProblem: () => {},
		});
		const ok = await okHook(citedInput());
		assert(ok !== undefined, 'success case is an object');
		assert(Object.keys(ok!).sort().join(',') === 'futureDirections,summary', 'exactly two managed fields, no free-form body field');
		const failHook = createSummarizeHook({
			getProvider: () => fakeSummarizer('openai', () => Promise.resolve({ summary: SHORT })).provider,
			getCredential: () => 'k', notifyCredentialProblem: () => {},
		});
		assert((await failHook(citedInput())) === undefined, 'a failure is always undefined, never a partial object');
	});

	// =================================================================
	// US2 — future directions for uncited papers
	// =================================================================
	await check('US2.1/SC-002', 'Uncited paper → summary AND future-directions text', async () => {
		const hook = createSummarizeHook({
			getProvider: () => fakeSummarizer('openai', () => Promise.resolve({ summary: LONG, futureDirections: LONG })).provider,
			getCredential: () => 'k', notifyCredentialProblem: () => {},
		});
		const r = await hook(uncitedInput());
		assert(r !== undefined && r.summary === LONG, 'summary present');
		assert(r !== undefined && r.futureDirections === LONG, 'uncited paper additionally gets future-directions text');
	});
	await check('US2.2/SC-002', 'Cited paper → summary only, provider future-directions discarded', async () => {
		const hook = createSummarizeHook({
			// provider volunteers future-directions even for a cited paper; the hook must drop it
			getProvider: () => fakeSummarizer('openai', () => Promise.resolve({ summary: LONG, futureDirections: LONG })).provider,
			getCredential: () => 'k', notifyCredentialProblem: () => {},
		});
		const r = await hook(citedInput());
		assert(r !== undefined && r.futureDirections === '', 'cited paper future-directions is gated to "" regardless of provider output');
	});
	await check('US2.3', 'Uncited, future-directions too-short → degrade to "", keep the summary', async () => {
		const hook = createSummarizeHook({
			getProvider: () => fakeSummarizer('openai', () => Promise.resolve({ summary: LONG, futureDirections: SHORT })).provider,
			getCredential: () => 'k', notifyCredentialProblem: () => {},
		});
		const r = await hook(uncitedInput());
		assert(r !== undefined && r.summary === LONG, 'a good summary is never discarded by a future-directions shortfall');
		assert(r !== undefined && r.futureDirections === '', 'a too-short future-directions degrades to ""');
	});
	await check('EC-uncited', 'isUncited: confirmed-zero only; unknown zero and positive are not uncited', () => {
		assert(isUncited({ citationsKnown: true, citationCount: 0 }) === true, 'confirmed 0 is uncited');
		assert(isUncited({ citationsKnown: false, citationCount: 0 }) === false, 'un-enriched 0 is unknown, NOT uncited');
		assert(isUncited({ citationsKnown: true, citationCount: 3 }) === false, 'a positive count is not uncited');
	});
	await check('EC-uncited-wired', 'The uncited gate flows through the hook (unknown-status paper gets no future-directions)', async () => {
		const hook = createSummarizeHook({
			getProvider: () => fakeSummarizer('openai', () => Promise.resolve({ summary: LONG, futureDirections: LONG })).provider,
			getCredential: () => 'k', notifyCredentialProblem: () => {},
		});
		const r = await hook(citedInput({ citationsKnown: false, citationCount: 0 }));
		assert(r !== undefined && r.futureDirections === '', 'citationsKnown:false, count:0 is treated as unknown → summary only');
	});

	// =================================================================
	// US3 — provider & credentials
	// =================================================================
	await check('US3.1', 'Invalid credentials → undefined AND notifyCredentialProblem called exactly once', async () => {
		let notified = 0;
		let message = '';
		const hook = createSummarizeHook({
			getProvider: () => fakeSummarizer('openai', () => Promise.reject(new Error('invalid-credentials (status 401)'))).provider,
			getCredential: () => 'bad-key',
			notifyCredentialProblem: (m) => { notified += 1; message = m; },
		});
		const r = await hook(citedInput());
		assert(r === undefined, 'invalid credential still falls back to the abstract (never blocks)');
		assert(notified === 1, 'the user is informed exactly once');
		assert(message.length > 0, 'a non-empty message is surfaced');
	});
	await check('US3.2', 'Provider is swappable — same hook factory, two different provider ids', async () => {
		const mk = (id: string) => createSummarizeHook({
			getProvider: () => fakeSummarizer(id, () => Promise.resolve({ summary: LONG })).provider,
			getCredential: () => 'k', notifyCredentialProblem: () => {},
		});
		const a = await mk('openai')(citedInput());
		const b = await mk('anthropic')(citedInput());
		assert(a !== undefined && b !== undefined && a.summary === b.summary, 'both providers drive identical hook behavior');
	});
	await check('FR-011', 'Summarization and embedding toggles are independent', async () => {
		// summary works with no embedding credential anywhere in scope
		const summary = await createSummarizeHook({
			getProvider: () => fakeSummarizer('openai', () => Promise.resolve({ summary: LONG })).provider,
			getCredential: () => 'k', notifyCredentialProblem: () => {},
		})(citedInput());
		assert(summary !== undefined && summary.summary === LONG, 'summary generated without any embedding config');
		// embedding upgrade works with no summarization provider/credential anywhere in scope
		const embed = fakeEmbedder('openai', () => Promise.resolve({ vector: [0.1, 0.2, 0.3], model: 'text-embedding-3-small' }));
		const up = await llmEmbeddingUpgrade('T', 'A', 'embed-key', embed.config);
		assert(up !== undefined && up.embeddingSource === 'llm', 'embedding upgraded without any summarization config');
	});

	// =================================================================
	// LLM embedding upgrade seam
	// =================================================================
	await check('EMB.1', 'Missing credential → undefined, embed never called', async () => {
		const embed = fakeEmbedder('openai', () => Promise.resolve({ vector: [0.1], model: 'm' }));
		const r = await llmEmbeddingUpgrade('T', 'A', undefined, embed.config);
		assert(r === undefined, 'no credential → no upgrade');
		assert(embed.calls() === 0, 'embed was never invoked');
	});
	await check('EMB.2', 'Success → embeddingModel is llm:<model>:d<dim>, embeddingSource is "llm"', async () => {
		const embed = fakeEmbedder('openai', () => Promise.resolve({ vector: [0.1, 0.2, 0.3], model: 'text-embedding-3-small' }));
		const r = await llmEmbeddingUpgrade('T', 'A', 'k', embed.config);
		assert(r !== undefined, 'a valid vector produces a result');
		assert(r!.embeddingModel === 'llm:text-embedding-3-small:d3', 'naming contract: llm:<model>:d<vector length>');
		assert(r!.embeddingModel === llmEmbeddingModelId('text-embedding-3-small', 3), 'matches the shared formatter');
		assert(r!.embeddingSource === 'llm', 'source marked llm');
		assert(r!.embeddingModel.startsWith('llm:'), 'satisfies reembed.ts isCanonical()\'s startsWith("llm:") check');
	});
	await check('EMB.3', 'Invalid vector (empty / non-finite) → undefined', async () => {
		const empty = fakeEmbedder('openai', () => Promise.resolve({ vector: [], model: 'm' }));
		assert((await llmEmbeddingUpgrade('T', 'A', 'k', empty.config)) === undefined, 'empty vector rejected');
		const nan = fakeEmbedder('openai', () => Promise.resolve({ vector: [1, NaN], model: 'm' }));
		assert((await llmEmbeddingUpgrade('T', 'A', 'k', nan.config)) === undefined, 'non-finite element rejected');
	});
	await check('EMB.4', 'Provider rejection / invalid-credentials → undefined, never throws', async () => {
		const rej = fakeEmbedder('openai', () => Promise.reject(new Error('invalid-credentials (status 401)')));
		assert((await llmEmbeddingUpgrade('T', 'A', 'k', rej.config)) === undefined, 'rejected credential falls back to baseline');
		const err = fakeEmbedder('openai', () => Promise.reject(new Error('boom')));
		assert((await llmEmbeddingUpgrade('T', 'A', 'k', err.config)) === undefined, 'generic error falls back to baseline');
	});
	await check('EMB.5', 'Timeout → undefined (never blocks persistence)', async () => {
		const hung = fakeEmbedder('openai', () => new Promise(() => {}));
		const r = await withImmediateTimers(() => llmEmbeddingUpgrade('T', 'A', 'k', hung.config));
		assert(r === undefined, 'a hung embedding call falls back to the retained baseline via the bounded timeout');
	});

	// =================================================================
	// openAiProvider marker parsing — deterministic via a canned requestUrl
	// response (no network). Exercises the tolerant "Future directions:" split.
	// =================================================================
	function cannedChat(content: string): RequestUrlResponse {
		return { status: 200, text: '', json: { choices: [{ message: { content } }] } };
	}
	const noSignal = new AbortController().signal;

	await check('PARSE.1', 'Exact "Future directions:" marker splits summary and future-directions', async () => {
		__setNextResponse(cannedChat('This is a solid summary of the paper.\nFuture directions: Extend the method to X.'));
		const r = await openAiProvider.generate(citedInput(), 'k', noSignal);
		assert(r.summary === 'This is a solid summary of the paper.', 'summary is the text before the marker');
		assert(r.futureDirections === 'Extend the method to X.', 'future-directions is the text after the marker');
	});
	await check('PARSE.2', 'Capitalized "Future Directions" with no colon still splits (tolerant match)', async () => {
		__setNextResponse(cannedChat('A concise summary sentence.\nFuture Directions\nExpected direction: try Y.'));
		const r = await openAiProvider.generate(uncitedInput(), 'k', noSignal);
		assert(r.summary === 'A concise summary sentence.', 'summary preserved despite non-exact marker casing');
		assert(r.futureDirections === 'Expected direction: try Y.', 'future-directions recovered despite capital D / no colon');
	});
	await check('PARSE.3', 'Bold "**Future directions:**" marker splits with a clean summary', async () => {
		__setNextResponse(cannedChat('The summary body.\n**Future directions:**\nExpected: extend to Z.'));
		const r = await openAiProvider.generate(uncitedInput(), 'k', noSignal);
		assert(r.summary === 'The summary body.', 'markdown emphasis around the marker does not leak into the summary');
		assert(r.futureDirections === 'Expected: extend to Z.', 'future-directions recovered from a bolded marker');
	});
	await check('PARSE.4', 'No marker → summary only, no future-directions field', async () => {
		__setNextResponse(cannedChat('Just a summary with no marker at all.'));
		const r = await openAiProvider.generate(citedInput(), 'k', noSignal);
		assert(r.summary === 'Just a summary with no marker at all.', 'whole content becomes the summary');
		assert(r.futureDirections === undefined, 'no future-directions emitted when the marker is absent');
	});

	// =================================================================
	// Multi-provider — Anthropic (Claude) and Gemini adapters share the same
	// prompt + future-directions split as OpenAI but differ in transport/response
	// shape and (Gemini) error classification. Deterministic via canned responses.
	// =================================================================
	function cannedMessage(text: string): RequestUrlResponse {
		// Anthropic Messages API shape: content is an array of typed text blocks.
		return { status: 200, text: '', json: { content: [{ type: 'text', text }] } };
	}
	function cannedGemini(text: string): RequestUrlResponse {
		// Gemini generateContent shape: candidates[].content.parts[].text.
		return { status: 200, text: '', json: { candidates: [{ content: { parts: [{ text }] } }] } };
	}

	await check('PROVIDER.registry', 'Registry resolves the three real ids and rejects unknown/undefined', () => {
		assert(resolveSummarizationProvider('openai') === openAiProvider, 'openai id resolves');
		assert(resolveSummarizationProvider('anthropic') === anthropicProvider, 'anthropic id resolves');
		assert(resolveSummarizationProvider('gemini') === geminiProvider, 'gemini id resolves');
		assert(resolveSummarizationProvider('nope') === undefined, 'unknown id → undefined (not configured)');
		assert(resolveSummarizationProvider(undefined) === undefined, 'absent id → undefined (not configured)');
		assert(SUMMARIZATION_PROVIDER_IDS.join(',') === 'openai,anthropic,gemini', 'stable selectable id list for the settings UI');
	});
	await check('ANTHROPIC.parse', 'Claude adapter extracts content[].text and applies the shared split', async () => {
		__setNextResponse(cannedMessage('A Claude summary body.\nFuture directions: connect method A to field B.'));
		const r = await anthropicProvider.generate(uncitedInput(), 'k', noSignal);
		assert(r.summary === 'A Claude summary body.', 'summary extracted from the first text block, before the marker');
		assert(r.futureDirections === 'connect method A to field B.', 'future-directions recovered via the shared marker split');
	});
	await check('ANTHROPIC.malformed', 'Claude adapter throws provider-error on a missing text block', async () => {
		__setNextResponse({ status: 200, text: '', json: { content: [] } });
		let threw = false;
		try { await anthropicProvider.generate(citedInput(), 'k', noSignal); } catch { threw = true; }
		assert(threw, 'a body with no text block is treated as a malformed provider response');
	});
	await check('GEMINI.parse', 'Gemini adapter extracts candidates[].content.parts[].text and splits', async () => {
		__setNextResponse(cannedGemini('A Gemini summary body.\nFuture Directions\nExpected direction: extend to C.'));
		const r = await geminiProvider.generate(uncitedInput(), 'k', noSignal);
		assert(r.summary === 'A Gemini summary body.', 'summary extracted from the first candidate part');
		assert(r.futureDirections === 'Expected direction: extend to C.', 'tolerant split works on the Gemini shape too');
	});
	await check('GEMINI.badkey', 'Gemini adapter maps an HTTP 400 API_KEY_INVALID body to invalid-credentials', async () => {
		__setNextResponse({ status: 400, text: '', json: { error: { status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.', details: [{ reason: 'API_KEY_INVALID' }] } } });
		let message = '';
		try { await geminiProvider.generate(citedInput(), 'k', noSignal); } catch (e) { message = (e as Error).message; }
		assert(/invalid-credentials/.test(message), 'a 400 whose body names an API-key problem is classified invalid-credentials (drives the FR-008 Notice)');
	});
	await check('GEMINI.servererror', 'Gemini adapter maps a generic 500 to provider-error, not invalid-credentials', async () => {
		__setNextResponse({ status: 500, text: '', json: { error: { message: 'internal' } } });
		let message = '';
		try { await geminiProvider.generate(citedInput(), 'k', noSignal); } catch (e) { message = (e as Error).message; }
		assert(/provider-error/.test(message) && !/invalid-credentials/.test(message), 'a non-key server error stays a generic provider-error (silent abstract fallback)');
	});

	// =================================================================
	// FR-013 — disclosure copy authored for 008 to place
	// =================================================================
	await check('FR-013', 'Disclosure copy names what is sent (title+abstract) and plaintext storage', () => {
		const c = SUMMARIZATION_DISCLOSURE_COPY;
		assert(/title/i.test(c.whatIsSent) && /abstract/i.test(c.whatIsSent), 'summarization disclosure names title+abstract');
		assert(/title/i.test(c.embeddingWhatIsSent) && /abstract/i.test(c.embeddingWhatIsSent), 'embedding disclosure names title+abstract');
		assert(/plaintext/i.test(c.credentialStorage), 'credential-storage disclosure names plaintext storage');
	});

	// =================================================================
	// SKIPs — pipeline/render integration and module-private internals
	// =================================================================
	skip('EC-inflight-discard', 'Toggling the feature off mid-generation discards the in-flight result (FR-009)', 'Enforced by src/collection/pipeline.ts re-checking isSummarizationEnabled() after the hook resolves (002-owned); createSummarizeHook has no enabled-flag knowledge');
	skip('SC-001-pipeline', 'With the feature off, zero summarization calls are made during a real collection pass', 'The enabled-flag gate lives in pipeline.ts (002); covered there. This suite asserts the hook-level unconfigured/undefined paths (US1.1/US1.2)');
	skip('SC-004-render', 'Generated text lands only in the note\'s managed region, never the user body', 'Placement is 003\'s wrap()/renderProse(); this suite asserts the return shape carries no body field (US1.7) but cannot exercise real note rendering here');
	skip('isCanonical-direct', 'reembed.ts isCanonical() returns true for an llm:-prefixed model', 'isCanonical() is module-private in reembed.ts; its exact startsWith("llm:") predicate is asserted via the naming contract in EMB.2');
	skip('smoke-openai', 'The real openAiProvider/openAiEmbeddingProvider round-trip against OpenAI', 'Network-touching requestUrl code; verified only by quickstart.md\'s manual in-vault smoke (a real API key)');

	// ---- report ----
	let p = 0, f = 0, s = 0;
	for (const r of results) {
		if (r.status === 'PASS') { p++; console.log(`[PASS] ${r.id} — ${r.desc}`); }
		else if (r.status === 'FAIL') { f++; console.log(`[FAIL] ${r.id} — ${r.desc}: ${r.note}`); }
		else { s++; console.log(`[SKIP] ${r.id} — ${r.desc} (${r.note})`); }
	}
	console.log(`\nSummary: ${p} passed, ${f} failed, ${s} skipped`);
	process.exitCode = f > 0 ? 1 : 0;
}

void main();
