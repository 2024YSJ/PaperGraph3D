// specs-chain-test for the chain:
//   001-core-data-models -> 002-subscription-paper-collection -> 003-paper-note-persistence
//
// Verifies the three specs as ONE pipeline from both required angles: per-seam connection
// points (C<k>) and the whole-system flow threaded end-to-end (E<k>). Uses REAL exports on
// both sides of every seam — 001's toPaper/isValidPaper/isPaperSourceId/isValidSubscription,
// 002's promote()/parseSemanticScholarPaper/runCollectionPass/subscriptionStore, and 003's
// PaperStore over InMemoryFileStore — never a re-derived copy. Deterministic (no network).
// Report-only. Bundle with `--alias:obsidian=<002 shim>` + `--external:@huggingface/transformers`.

// Node has no `window`; 002's pipeline yields via window.setTimeout.
(globalThis as unknown as { window: typeof globalThis }).window = globalThis;

// ---- 001 (upstream: data models) ----
import { isValidPaper, isPaperSourceId, toPaper } from '../../src/models/paper';
import type { Paper, PaperCandidate, PaperSourceId } from '../../src/models/paper';
import { isValidSubscription, DEFAULT_CHECK_INTERVAL_HOURS } from '../../src/models/subscription';
import type { Subscription } from '../../src/models/subscription';
// ---- 002 (collection: produces canonical Paper) ----
import { promote } from '../../src/collection/promotion';
import { parseSemanticScholarPaper, toPaperSourceId } from '../../src/collection/semanticScholarParser';
import { runCollectionPass } from '../../src/collection/pipeline';
import { createSubscriptionStore } from '../../src/collection/subscriptionStore';
import { BASELINE_EMBEDDING_MODEL } from '../../src/collection/embedding';
import type { PipelineHooks, EnrichmentOutcome } from '../../src/collection/types';
// ---- 003 (persistence: wraps Paper into record + note) ----
import { PaperStore } from '../../src/persistence/store';
import { InMemoryFileStore } from '../../src/persistence/filestore';
import { parseNote } from '../../src/persistence/note';
import { classify, stemOf } from '../../src/persistence/reconcile';

type Result = { id: string; desc: string; status: 'PASS' | 'FAIL' | 'SKIP'; note?: string };
const results: Result[] = [];
function assert(cond: unknown, msg: string): void { if (!cond) throw new Error(msg); }
async function check(id: string, desc: string, fn: () => void | Promise<void>): Promise<void> {
	try { await fn(); results.push({ id, desc, status: 'PASS' }); }
	catch (err) { results.push({ id, desc, status: 'FAIL', note: err instanceof Error ? err.message : String(err) }); }
}
function skip(id: string, desc: string, reason: string): void { results.push({ id, desc, status: 'SKIP', note: reason }); }

function candidate(sourceId: string, over: Partial<PaperCandidate> = {}): PaperCandidate {
	return {
		title: 'Paper ' + sourceId, publicationYear: 2020, authors: ['Ada', 'Bo'], citationCount: undefined,
		abstract: 'Abstract of ' + sourceId, sourceId: sourceId as PaperSourceId, references: undefined,
		embedding: undefined, embeddingModel: undefined, embeddingSource: undefined, ...over,
	};
}
async function* gen(cs: PaperCandidate[]): AsyncIterable<PaperCandidate> { for (const c of cs) yield c; }
const noEnrich = async (): Promise<Map<PaperSourceId, EnrichmentOutcome>> => new Map();
// A PipelineHooks that captures the Paper 002 hands to 003 (in-memory, no persistence side).
function capturingHooks(): { hooks: PipelineHooks; captured: Paper[] } {
	const captured: Paper[] = [];
	return { hooks: { persist: async (p) => { captured.push(p); }, alreadyPersisted: async () => false }, captured };
}
// 003 shared (mirrored) frontmatter subset per 003 FR-002.
const MIRRORED = ['title', 'authors', 'publicationYear', 'citationCount', 'readState', 'pg3d_sourceId'];

async function main() {
	// =================================================================
	// SEAM 001 -> 002 (data models -> collection output)
	// =================================================================
	await check('C1', '[001→002] promote() honors 001 hold-back and yields a Paper 001 accepts', () => {
		// happy: a valid candidate promotes to a Paper that 001's own validator accepts.
		const p = promote(candidate('arxiv:1', { citationCount: 4 }));
		assert(p !== undefined && isValidPaper(p), 'promoted Paper passes 001 isValidPaper');
		assert(p!.citationsKnown === true, '001 citationsKnown derived from known count');
		// negative: values 001 holds back (missing/NaN year) never yield a Paper across the seam.
		assert(promote(candidate('arxiv:2', { publicationYear: undefined })) === undefined, 'no-year candidate held back by 002.promote (001 rule)');
		assert(promote(candidate('arxiv:3', { publicationYear: Number.NaN })) === undefined, 'NaN-year candidate held back');
	});
	await check('C2', "[001→002] enrichment references are valid 001 sourceIds; the enriched Paper passes 001 isValidPaper", async () => {
		// 002 builds references from Semantic Scholar JSON, then persists via the pipeline.
		const ss = parseSemanticScholarPaper({
			paperId: 'X', externalIds: { ArXiv: '2001.1v2' }, citationCount: 9,
			references: [{ paperId: 'R', externalIds: { ArXiv: '1901.1v1' } }, { paperId: 'S', externalIds: {} }],
		});
		const refs = ss.references.map(toPaperSourceId);
		assert(refs.every(isPaperSourceId), 'every enrichment reference is a valid 001 PaperSourceId');
		const { hooks, captured } = capturingHooks();
		const enrich = async (): Promise<Map<PaperSourceId, EnrichmentOutcome>> =>
			new Map<PaperSourceId, EnrichmentOutcome>([['arxiv:1' as PaperSourceId, { status: 'enriched', citationCount: ss.citationCount, references: refs }]]);
		await runCollectionPass(gen([candidate('arxiv:1')]), 'keyword:test', hooks, () => false, () => undefined, enrich);
		assert(captured.length === 1 && isValidPaper(captured[0]!), 'enriched Paper passes 001 isValidPaper');
		assert(captured[0]!.references.every(isPaperSourceId), 'stored references remain valid 001 sourceIds');
	});
	await check('C3', '[001→002] the subscription store emits records 001 isValidSubscription accepts', async () => {
		let backing: Subscription[] = [];
		const store = createSubscriptionStore({ load: async () => backing.map((s) => ({ ...s })), save: async (s) => { backing = s.map((x) => ({ ...x })); } });
		const sub = await store.register({ type: 'keyword', value: 'ml' });
		assert(isValidSubscription(sub), 'registered subscription is valid per 001');
		assert(sub.checkIntervalHours === DEFAULT_CHECK_INTERVAL_HOURS, '002 applied 001 default interval');
		await store.recordChecked(sub, 1000, 500);
		assert(isValidSubscription(store.list()[0]!), 'subscription stays 001-valid after recordChecked');
	});

	// =================================================================
	// SEAM 002 -> 003 (collection output -> persistence record/note)
	// =================================================================
	await check('C4', "[002→003] the Paper 002 produces round-trips through 003's record; note frontmatter mirrors the shared subset", async () => {
		const { hooks, captured } = capturingHooks();
		await runCollectionPass(gen([candidate('arxiv:1706.03762', { citationCount: 12, references: undefined })]), 'keyword:test', hooks, () => false, () => undefined,
			async () => new Map<PaperSourceId, EnrichmentOutcome>([['arxiv:1706.03762' as PaperSourceId, { status: 'enriched', citationCount: 12, references: ['arxiv:1' as PaperSourceId] }]]));
		const produced = captured[0]!;
		const fs = new InMemoryFileStore();
		const store = new PaperStore(fs, {});
		await store.upsert({ paper: produced });
		// record.paper equals the 002 Paper
		const readBack = await store.get(produced.sourceId);
		assert(readBack !== undefined && JSON.stringify(readBack) === JSON.stringify(produced), '003 read-back equals the 002-produced Paper');
		// note frontmatter mirrors the 003 FR-002 shared subset, each equal to the Paper's field
		const md = (await fs.list()).find((f) => classify(f) === 'md')!;
		const fm = parseNote((await fs.read(md))!).frontmatter;
		assert(fm['title'] === produced.title, 'title mirrored');
		assert(fm['publicationYear'] === produced.publicationYear, 'publicationYear mirrored');
		assert(fm['citationCount'] === produced.citationCount, 'citationCount mirrored');
		assert(fm['pg3d_sourceId'] === produced.sourceId, 'sourceId mirrored');
		assert(Array.isArray(fm['authors']) && (fm['authors'] as string[]).join(',') === produced.authors.join(','), 'authors mirrored');
	});
	await check('C5', "[002→003] non-mirrored fields (references/embedding/timestamps/schemaVersion) never leak into the note", async () => {
		const { hooks, captured } = capturingHooks();
		await runCollectionPass(gen([candidate('arxiv:9', { citationCount: 1 })]), 'keyword:test', hooks, () => false, () => undefined,
			async () => new Map<PaperSourceId, EnrichmentOutcome>([['arxiv:9' as PaperSourceId, { status: 'enriched', citationCount: 1, references: ['arxiv:12345' as PaperSourceId] }]]));
		const produced = captured[0]!;
		assert(Array.isArray(produced.embedding) && produced.embeddingModel === BASELINE_EMBEDDING_MODEL, 'produced Paper carries the 002 baseline embedding');
		const fs = new InMemoryFileStore();
		await new PaperStore(fs, {}).upsert({ paper: produced });
		const mdPath = (await fs.list()).find((f) => classify(f) === 'md')!;
		const mdText = (await fs.read(mdPath))!;
		const fm = parseNote(mdText).frontmatter;
		for (const key of Object.keys(fm)) assert(MIRRORED.includes(key), `frontmatter key ${key} is within the mirrored subset`);
		assert(!mdText.includes('arxiv:12345'), 'raw reference sourceId not leaked into the note');
		// Honest leak check: the distinctive embeddingModel id, the word "embedding", and a
		// non-zero vector value (a long decimal that would not appear coincidentally) are all absent.
		assert(!mdText.toLowerCase().includes('embedding'), 'no "embedding" text in the note');
		assert(!mdText.includes(BASELINE_EMBEDDING_MODEL), 'no embeddingModel id in the note');
		const nonZero = produced.embedding!.find((v) => v !== 0);
		if (nonZero !== undefined) assert(!mdText.includes(String(nonZero)), 'no embedding vector value leaked into the note');
		assert(!mdText.includes('schemaVersion') && !mdText.includes('createdAt'), 'schemaVersion/timestamps not leaked into the note');
		// but the record wrapper DOES carry the embedding (003 FR-016 / SC-008)
		const jsonPath = (await fs.list()).find((f) => classify(f) === 'json')!;
		const rec = JSON.parse((await fs.read(jsonPath))!) as { paper: Paper; schemaVersion: number };
		assert(Array.isArray(rec.paper.embedding) && typeof rec.schemaVersion === 'number', 'embedding + schemaVersion live in the record wrapper');
	});

	// =================================================================
	// WHOLE-SYSTEM end-to-end: 001 -> 002 -> 003 threaded through the real pipeline
	// =================================================================
	await check('E1', '[system] A batch built at 001 flows through 002 into 003; valid papers round-trip, held-back never appear, dup collapses', async () => {
		const fs = new InMemoryFileStore();
		const store = new PaperStore(fs, {});
		// The persist hook is 003's real PaperStore; alreadyPersisted is 003's real index (cross-spec dedup).
		const hooks: PipelineHooks = {
			persist: async (paper, summary) => { await store.upsert({ paper, summary: summary?.summary, futureDirections: summary?.futureDirections }); },
			alreadyPersisted: async (id) => store.has(id),
		};
		const batch = [
			candidate('arxiv:1', { citationCount: 3 }),
			candidate('arxiv:1', { citationCount: 3 }),                 // duplicate sourceId
			candidate('arxiv:2', { citationCount: 0 }),
			candidate('arxiv:3', { publicationYear: undefined }),        // 001 hold-back
		];
		await runCollectionPass(gen(batch), 'keyword:test', hooks, () => false, () => undefined, noEnrich);
		// exactly the two distinct, year-bearing papers are stored
		const jsons = (await fs.list()).filter((f) => classify(f) === 'json');
		assert(jsons.length === 2, 'exactly 2 distinct valid papers persisted (dup collapsed, yearless dropped)');
		assert(store.has('arxiv:1' as PaperSourceId) && store.has('arxiv:2' as PaperSourceId), 'both valid papers indexed');
		assert(store.has('arxiv:3' as PaperSourceId) === false, '001-held-back paper never produced any downstream artifact');
		// round-trip fidelity + downstream validity for each stored paper
		for (const id of ['arxiv:1', 'arxiv:2'] as PaperSourceId[]) {
			const p = await store.get(id);
			assert(p !== undefined && isValidPaper(p), `stored ${id} reads back as a valid 001 Paper`);
			assert(Array.isArray(p!.embedding) && p!.embeddingModel === BASELINE_EMBEDDING_MODEL, `stored ${id} carries the 002 baseline embedding end-to-end`);
			const md = (await fs.list()).find((f) => classify(f) === 'md' && stemOf(f) === stemOf(jsons.find((j) => j.includes(id.replace(':', '_')))!))!;
			assert(parseNote((await fs.read(md))!).frontmatter['pg3d_sourceId'] === id, `note for ${id} mirrors the sourceId`);
		}
	});
	await check('E2', '[system] Re-collecting the same batch is a no-op that preserves the user body (002 dedup + 003 keying)', async () => {
		const fs = new InMemoryFileStore();
		const store = new PaperStore(fs, {});
		const hooks: PipelineHooks = {
			persist: async (paper) => { await store.upsert({ paper }); },
			alreadyPersisted: async (id) => store.has(id),
		};
		await runCollectionPass(gen([candidate('arxiv:1')]), 'keyword:test', hooks, () => false, () => undefined, noEnrich);
		// user writes into the note body
		const mdPath = (await fs.list()).find((f) => classify(f) === 'md')!;
		const userLine = '\n## My reading notes\n\nRevisit the ablation table.\n';
		await fs.write(mdPath, (await fs.read(mdPath))! + userLine);
		const before = await fs.read(mdPath);
		// re-collect the same paper: 002's dedup (via 003's index) must make it a no-op
		await runCollectionPass(gen([candidate('arxiv:1', { citationCount: 999 })]), 'keyword:test', hooks, () => false, () => undefined, noEnrich);
		assert((await fs.list()).filter((f) => classify(f) === 'json').length === 1, 're-collection created no duplicate pairing');
		assert((await fs.read(mdPath)) === before, 'note (incl. user body) byte-for-byte unchanged — re-collection wrote nothing');
	});

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
