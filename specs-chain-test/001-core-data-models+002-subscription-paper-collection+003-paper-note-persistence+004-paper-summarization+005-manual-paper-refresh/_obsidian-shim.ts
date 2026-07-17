// Support shim for this chain-test only (not itself a test). Aliased to 'obsidian' so
// src/collection/{arxivClient,semanticScholarClient}.ts can run under plain node. Its
// requestUrl is PROGRAMMABLE (deterministic crafted responses on globalThis.__api) so the
// 002 enrichment leg and the 005 refresh leg both run their REAL client + parser code
// without any live network call. Same mechanism as the 005 spec-test shim.
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
export interface EntrySpec {
	id: string;
	title?: string;
	summary?: string;
	published?: string;
	authors?: string[];
}
interface Api {
	arxiv: Map<string, EntrySpec | 'notfound' | 'throw'>;
	s2: Map<string, { citationCount: number; references?: unknown[] } | '404' | 'null'>;
	counts: { arxiv: number; s2single: number; s2batch: number };
}
function api(): Api {
	return (globalThis as unknown as { __api: Api }).__api;
}

export async function requestUrl(param: RequestUrlParam): Promise<RequestUrlResponse> {
	const a = api();
	const url = param.url;
	if (url.includes('export.arxiv.org')) {
		a.counts.arxiv += 1;
		const m = /id_list=([^&]+)/.exec(url);
		const raw = m ? decodeURIComponent(m[1]!) : '';
		// id_list is comma-separated for 005's batched bulk-refresh content lookup
		// (research.md Decision 4, corrected), or a single id for the single-paper path.
		const ids = raw.split(',');
		if (ids.some((id) => a.arxiv.get(id) === 'throw')) {
			throw new Error(`simulated arXiv failure for ${raw}`);
		}
		const entries = ids
			.map((id) => a.arxiv.get(id))
			.filter((e): e is EntrySpec => e !== undefined && e !== 'notfound');
		return { status: 200, text: JSON.stringify({ entries }), json: undefined };
	}
	if (url.includes('api.semanticscholar.org')) {
		if (url.includes('/batch')) {
			a.counts.s2batch += 1;
			const ids = (JSON.parse(param.body ?? '{"ids":[]}') as { ids: string[] }).ids;
			const arr = ids.map((full) => {
				const id = full.replace(/^ARXIV:/, '');
				const r = a.s2.get(id);
				return r === undefined || r === 'null' || r === '404' ? null : r;
			});
			return { status: 200, text: '', json: arr };
		}
		a.counts.s2single += 1;
		const m = /ARXIV:([^?]+)/.exec(url);
		const id = m ? m[1]! : '';
		const r = a.s2.get(id);
		if (r === undefined || r === '404' || r === 'null') return { status: 404, text: '', json: undefined };
		return { status: 200, text: '', json: r };
	}
	throw new Error(`unexpected URL in chain-test shim: ${url}`);
}
