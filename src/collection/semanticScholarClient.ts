import { requestUrl } from 'obsidian';
import type { RequestUrlParam } from 'obsidian';

// Semantic Scholar HTTP client. 002's collection path uses the batch endpoint (Decision
// 33); the single-paper GET is retained for 005's per-paper refresh. Identity is arXiv-ID
// only — no title/author search form (research.md Decision 12). See
// contracts/collection-pipeline.md § semanticScholarClient.ts.

const S2_BASE = 'https://api.semanticscholar.org/graph/v1/paper';
const S2_FIELDS = 'citationCount,references.paperId,references.externalIds';
const S2_BATCH_CHUNK_SIZE = 500;
const S2_MAX_ATTEMPTS = 3;
const S2_RETRY_DELAY_MS = 3_000;

export type BatchElement = { body: unknown } | null | { status: 429 } | { status: 'networkError' };
export type PaperResult =
	| { status: 200; body: unknown }
	| { status: 404 }
	| { status: 429 }
	| { status: 'networkError' };

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function withApiKey(param: RequestUrlParam, apiKey: string | undefined): RequestUrlParam {
	if (apiKey !== undefined && apiKey.length > 0) {
		return { ...param, headers: { ...param.headers, 'x-api-key': apiKey } };
	}
	return param;
}

function chunk<T>(items: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size));
	}
	return chunks;
}

// POST /paper/batch — one request per ≤500-id chunk, returning one element per input id,
// aligned by index. null = provider has no record for that id; a chunk-level 429/network
// failure (after bounded retry) becomes that status placeholder for every id in the chunk.
export async function fetchSemanticScholarBatch(
	arxivIds: string[],
	apiKey: string | undefined,
): Promise<BatchElement[]> {
	const results: BatchElement[] = [];

	for (const ids of chunk(arxivIds, S2_BATCH_CHUNK_SIZE)) {
		let placeholder: { status: 429 } | { status: 'networkError' } = { status: 'networkError' };
		let settled = false;

		for (let attempt = 0; attempt < S2_MAX_ATTEMPTS && !settled; attempt += 1) {
			if (attempt > 0) {
				await delay(S2_RETRY_DELAY_MS);
			}
			try {
				const response = await requestUrl(
					withApiKey(
						{
							url: `${S2_BASE}/batch?fields=${S2_FIELDS}`,
							method: 'POST',
							contentType: 'application/json',
							body: JSON.stringify({ ids: ids.map((id) => `ARXIV:${id}`) }),
							throw: false,
						},
						apiKey,
					),
				);
				if (response.status === 200) {
					const parsed: unknown = response.json;
					const array: unknown[] = Array.isArray(parsed) ? parsed : [];
					for (let index = 0; index < ids.length; index += 1) {
						const element = array[index];
						results.push(element === null || element === undefined ? null : { body: element });
					}
					settled = true;
				} else if (response.status === 429) {
					placeholder = { status: 429 };
				} else {
					placeholder = { status: 'networkError' };
				}
			} catch {
				placeholder = { status: 'networkError' };
			}
		}

		if (!settled) {
			for (let index = 0; index < ids.length; index += 1) {
				results.push(placeholder);
			}
		}
	}

	return results;
}

// GET /paper/ARXIV:<id> — retained for 005's per-paper manual refresh (one at a time).
export async function fetchSemanticScholarPaper(
	arxivId: string,
	apiKey: string | undefined,
): Promise<PaperResult> {
	let placeholder: PaperResult = { status: 'networkError' };

	for (let attempt = 0; attempt < S2_MAX_ATTEMPTS; attempt += 1) {
		if (attempt > 0) {
			await delay(S2_RETRY_DELAY_MS);
		}
		try {
			const response = await requestUrl(
				withApiKey(
					{
						url: `${S2_BASE}/ARXIV:${arxivId}?fields=${S2_FIELDS}`,
						method: 'GET',
						throw: false,
					},
					apiKey,
				),
			);
			if (response.status === 200) {
				return { status: 200, body: response.json };
			}
			if (response.status === 404) {
				return { status: 404 };
			}
			placeholder = response.status === 429 ? { status: 429 } : { status: 'networkError' };
		} catch {
			placeholder = { status: 'networkError' };
		}
	}

	return placeholder;
}
