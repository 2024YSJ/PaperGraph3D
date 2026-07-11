// Support shim for this spec-test only (not itself a test). Provides a minimal 'obsidian'
// module so src/collection/{arxivClient,semanticScholarClient}.ts (which import
// `requestUrl`/`RequestUrlParam` from 'obsidian') can run under plain node.
//
// UNLIKE 002's spec-test (whose shim performs REAL live HTTP), this shim is
// PROGRAMMABLE: requestUrl dispatches on the request URL and returns crafted,
// deterministic responses stashed on globalThis.__api. This is required because 005's
// behavioral scenarios (a changed abstract, a citation-count flip, a provider failure)
// cannot be produced on demand by the live arXiv/Semantic Scholar APIs. The REAL
// src/collection client + parser code still runs end-to-end against these responses;
// only the network boundary is replaced. No live network call is made.
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

// EntrySpec is carried as JSON text through response.text; the test's DOMParser polyfill
// reconstructs fake <entry> Elements from it, so the real fetchArxivEntryById +
// parseArxivEntry run unmodified over them.
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
		// research.md Decision 4 (corrected): id_list is comma-separated for a batched
		// bulk-refresh content lookup, or a single id for the single-paper path — both
		// forms share this one branch. 'throw' on ANY requested id simulates the whole
		// HTTP call failing (a genuine per-id "arXiv succeeded but omitted this one"
		// failure is not representable within one real batched response — only
		// whole-call failure or per-id absence ('notfound') are).
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
		if (r === undefined || r === '404' || r === 'null') {
			return { status: 404, text: '', json: undefined };
		}
		return { status: 200, text: '', json: r };
	}

	throw new Error(`unexpected URL in spec-test shim: ${url}`);
}
