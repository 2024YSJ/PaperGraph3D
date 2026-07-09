// Support shim for this spec-test only (not itself a test). Provides a minimal 'obsidian'
// module so src/collection/*.ts (which import `requestUrl` from 'obsidian') can run under
// plain node. Unlike quickstart.md's stubs, requestUrl here performs a REAL HTTP call via
// node's global fetch, so live-network cases in the spec-test exercise the actual arXiv /
// Semantic Scholar APIs through the unmodified src/collection/ implementation.
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

export async function requestUrl(param: RequestUrlParam): Promise<RequestUrlResponse> {
	const response = await fetch(param.url, {
		method: param.method ?? 'GET',
		headers: {
			...(param.contentType !== undefined ? { 'Content-Type': param.contentType } : {}),
			...param.headers,
		},
		body: param.body,
	});
	const text = await response.text();
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		json = undefined;
	}
	if (!response.ok && param.throw !== false) {
		throw new Error(`requestUrl failed: ${response.status} ${param.url}`);
	}
	return { status: response.status, text, json };
}
