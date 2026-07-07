import { requestUrl } from 'obsidian';

// arXiv Atom XML query + paged fetch. arXiv is this feature's SOLE discovery provider
// (FR-031). See contracts/collection-pipeline.md § arxivClient.ts and research.md
// Decisions 11, 18, 19, 25, 32.

const ARXIV_PAGE_SIZE = 100; // max_results per request (research.md Decision 11)
const ARXIV_MAX_PAGES = 10; // safety cap: 1,000 entries per subscription per check
const ARXIV_INTER_PAGE_DELAY_MS = 3_000; // arXiv's requested rate-limit spacing
const ARXIV_API_URL = 'http://export.arxiv.org/api/query';

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
		const doc = new DOMParser().parseFromString(response.text, 'application/xml');
		const pageEntries = Array.from(doc.getElementsByTagName('entry'));
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
