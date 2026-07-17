// Support shim for this spec-test only (not itself a test). Provides a minimal
// 'obsidian' module so src/services/summarization/providers/openai.ts (imported
// transitively by embeddingHook.ts) resolves under plain node. Unlike 002's shim,
// this one THROWS: every scenario here drives createSummarizeHook/llmEmbeddingUpgrade
// against in-process fake providers, so requestUrl must never actually run — if it
// ever does, the test should fail loudly rather than make a real network call.

export interface RequestUrlParam {
	url: string;
	method?: string;
	contentType?: string;
	body?: string;
	headers?: Record<string, string>;
	throw?: boolean;
}

export interface RequestUrlResponse {
	status: number;
	text: string;
	json: unknown;
}

// One canned response, injected by the PARSE.* cases so openAiProvider.generate's
// pure marker-parsing logic can be exercised WITHOUT a network call. Every other case
// drives in-process fakes and never sets this, so requestUrl still throws if wrongly
// reached. esbuild resolves both `import 'obsidian'` (aliased here) and the test's
// relative `import './_obsidian-shim'` to this same module, so the queue is shared.
let queued: RequestUrlResponse | undefined;

export function __setNextResponse(response: RequestUrlResponse): void {
	queued = response;
}

export function requestUrl(): Promise<RequestUrlResponse> {
	if (queued !== undefined) {
		const response = queued;
		queued = undefined;
		return Promise.resolve(response);
	}
	throw new Error(
		'requestUrl must not be called in the 004 spec-test — every provider is an ' +
			'in-process fake; the real OpenAI provider is verified only by the manual ' +
			'in-vault smoke in quickstart.md',
	);
}
