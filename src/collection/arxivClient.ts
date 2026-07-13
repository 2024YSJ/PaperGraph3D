import { requestUrl } from 'obsidian';

// arXiv Atom XML query + paged fetch. arXiv is this feature's SOLE discovery provider
// (FR-031). See contracts/collection-pipeline.md § arxivClient.ts and research.md
// Decisions 11, 18, 19, 25, 32.

const ARXIV_PAGE_SIZE = 100; // max_results per request (research.md Decision 11)
const ARXIV_MAX_PAGES = 10; // safety cap: 1,000 entries per subscription per check
const ARXIV_INTER_PAGE_DELAY_MS = 3_000; // arXiv's requested rate-limit spacing
// HTTPS: arXiv 301-redirects the plain-http endpoint, and requestUrl does not reliably follow
// that redirect — using https directly avoids an empty/failed response.
const ARXIV_API_URL = 'https://export.arxiv.org/api/query';

type SubscriptionQuery = {
	type: 'keyword' | 'author' | 'arxivCategory';
	value: string;
};

function twoDigits(value: number): string {
	return String(value).padStart(2, '0');
}

// arXiv's submittedDate syntax is GMT in YYYYMMDDHHMM form — UTC accessors ONLY, never
// local-timezone ones (research.md Decision 19).
function formatArxivDate(epochMs: number): string {
	const date = new Date(epochMs);
	return (
		`${date.getUTCFullYear()}` +
		`${twoDigits(date.getUTCMonth() + 1)}` +
		`${twoDigits(date.getUTCDate())}` +
		`${twoDigits(date.getUTCHours())}` +
		`${twoDigits(date.getUTCMinutes())}`
	);
}

function searchClause(subscription: SubscriptionQuery): string {
	// Strip literal quotes so an embedded quote can't end arXiv's phrase delimiter early
	// (research.md Decision 18).
	const value = subscription.value.replace(/"/g, '');
	switch (subscription.type) {
		case 'author':
			return `au:"${value}"`;
		case 'arxivCategory':
			return `cat:${value}`;
		case 'keyword':
		default:
			return `all:"${value}"`;
	}
}

// Pure, network-free — exported so query construction is verifiable without a live call.
export function buildArxivSearchUrl(
	subscription: SubscriptionQuery,
	window: { from: number; to: number },
	page: { start: number; maxResults: number },
): string {
	const query =
		`${searchClause(subscription)} AND ` +
		`submittedDate:[${formatArxivDate(window.from)} TO ${formatArxivDate(window.to)}]`;
	return (
		`${ARXIV_API_URL}?search_query=${encodeURIComponent(query)}` +
		`&start=${page.start}&max_results=${page.maxResults}` +
		`&sortBy=submittedDate&sortOrder=ascending`
	);
}

function publishedEpochMs(entry: Element): number | undefined {
	const text = entry.getElementsByTagName('published')[0]?.textContent?.trim();
	if (text === undefined || text.length === 0) {
		return undefined;
	}
	const ms = new Date(text).getTime();
	return Number.isFinite(ms) ? ms : undefined;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// Shared Atom-parse guard: a throttled/malformed arXiv response (empty body, an HTML
// error page, a truncated feed) must never be silently read as "0 results" — that
// would be indistinguishable from a genuine empty result and would wrongly advance a
// collection cursor (queryArxiv) or report a paper as no-longer-found (fetch* below).
// A real Atom `<feed>` root is required; anything else throws so callers treat it as a
// failed call (retry-worthy), not a completed empty one.
function parseArxivEntries(xmlText: string): Element[] {
	const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
	if (doc.getElementsByTagName('parsererror').length > 0) {
		throw new Error('arXiv response was not well-formed XML (likely throttled or unavailable)');
	}
	return Array.from(doc.getElementsByTagName('entry'));
}

// The arXiv id a returned `<entry>` corresponds to, extracted from its `<id>` tag
// (e.g. 'http://arxiv.org/abs/2607.08459v1' -> '2607.08459'). Used to match batch
// results back to requested ids, since a missing id is simply omitted from the feed.
function entryBaseId(entry: Element): string | undefined {
	const raw = entry.getElementsByTagName('id')[0]?.textContent?.trim();
	if (raw === undefined) {
		return undefined;
	}
	const m = /abs\/([^v]+)v?\d*$/.exec(raw);
	return m?.[1];
}

export async function queryArxiv(
	subscription: SubscriptionQuery,
	window: { from: number; to: number },
): Promise<{ entries: Element[]; truncated: boolean; coveredThrough: number }> {
	// Empty/inverted window (e.g. clock-backward, FR-024): nothing to search, issue no call.
	if (window.from >= window.to) {
		return { entries: [], truncated: false, coveredThrough: window.to };
	}

	const entries: Element[] = [];
	let truncated = false;

	for (let page = 0; page < ARXIV_MAX_PAGES; page += 1) {
		if (page > 0) {
			await delay(ARXIV_INTER_PAGE_DELAY_MS);
		}
		const url = buildArxivSearchUrl(subscription, window, {
			start: page * ARXIV_PAGE_SIZE,
			maxResults: ARXIV_PAGE_SIZE,
		});
		const response = await requestUrl({ url });
		const pageEntries = parseArxivEntries(response.text);
		for (const entry of pageEntries) {
			entries.push(entry);
		}

		if (pageEntries.length < ARXIV_PAGE_SIZE) {
			// A short page means the window is fully covered.
			break;
		}
		if (page === ARXIV_MAX_PAGES - 1) {
			// Hit the safety cap with a full final page — more results remain uncovered.
			truncated = true;
		}
	}

	let coveredThrough: number;
	if (!truncated) {
		coveredThrough = window.to;
	} else {
		// Entries are submittedDate-ascending, so scan newest -> oldest for the first with a
		// parseable <published>. Fall back to window.from (no progress) — NEVER NaN/thrown,
		// since this feeds the persisted lastCheckedAt (FR-026, research.md Decision 32).
		coveredThrough = window.from;
		for (let index = entries.length - 1; index >= 0; index -= 1) {
			const published = publishedEpochMs(entries[index]!);
			if (published !== undefined) {
				coveredThrough = published;
				break;
			}
		}
	}

	return { entries, truncated, coveredThrough };
}

// NEW for 005. Single-ID direct lookup via arXiv's documented `id_list=` form — no
// window, no paging (a single-ID lookup returns 0 or 1 entries by construction).
// Returns the one matching Atom <entry>, or undefined when arXiv has none (FR-005's
// "no longer found"). Reuses the same DOMParser Atom-parsing pattern queryArxiv uses.
// research.md Decision 1. Callers map the returned <entry> through parseArxivEntry.
export async function fetchArxivEntryById(baseArxivId: string): Promise<Element | undefined> {
	const url = `${ARXIV_API_URL}?id_list=${encodeURIComponent(baseArxivId)}`;
	const response = await requestUrl({ url });
	return parseArxivEntries(response.text)[0];
}

// NEW: bulk-refresh content re-fetch (research.md Decision 4, corrected). arXiv's
// `id_list=` accepts a comma-separated list and returns one <entry> per id it still
// has (verified live: `id_list=A,B` yields totalResults=2, both entries) — the same
// mechanism 002's queryArxiv already relies on for paged discovery, just keyed by
// explicit ids instead of a date window. A bulk refresh therefore batches its arXiv
// content re-fetch exactly as it already batches its Semantic Scholar citation lookup
// (FR-018), rather than issuing one HTTP call per paper. Chunked to ARXIV_PAGE_SIZE ids
// per request (arXiv's own per-request result cap) and paced at
// ARXIV_INTER_PAGE_DELAY_MS between chunks — the same conservative rate 002 uses for
// its own paged search, since this is structurally the same "page through one query"
// pattern, not N independent lookups.
// Returns a map from base arXiv id -> its <entry>, omitting ids arXiv has no record for
// (caller reads a missing key as "not found", same as the single-id function above).
// A chunk whose call throws (throttled/malformed) is NOT retried or silently dropped —
// the whole chunk's ids are surfaced to the caller via the returned `failedIds` set, so
// bulkRefresh can report those specific papers as failures instead of misreporting them
// as "arXiv no longer has this paper."
export async function fetchArxivEntriesByIds(
	baseArxivIds: string[],
): Promise<{ found: Map<string, Element>; failedIds: Set<string> }> {
	const found = new Map<string, Element>();
	const failedIds = new Set<string>();

	for (let start = 0; start < baseArxivIds.length; start += ARXIV_PAGE_SIZE) {
		if (start > 0) {
			await delay(ARXIV_INTER_PAGE_DELAY_MS);
		}
		const chunk = baseArxivIds.slice(start, start + ARXIV_PAGE_SIZE);
		const url = `${ARXIV_API_URL}?id_list=${encodeURIComponent(chunk.join(','))}&max_results=${chunk.length}`;
		try {
			const response = await requestUrl({ url });
			for (const entry of parseArxivEntries(response.text)) {
				const id = entryBaseId(entry);
				if (id !== undefined) {
					found.set(id, entry);
				}
			}
		} catch {
			for (const id of chunk) {
				failedIds.add(id);
			}
		}
	}

	return { found, failedIds };
}
