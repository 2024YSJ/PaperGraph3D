// specs-chain-test for 001-core-data-models -> 003-paper-note-persistence.
// Verifies how the two specs INTEGRATE: 001 produces a canonical `Paper`; 003
// wraps/persists/reads it. Per-seam scenarios (C<k>) prove each connection point;
// whole-system scenarios (E<k>) thread one artifact through the entire chain.
// Drives the REAL exported API on both sides — never re-derives a spec's checks.

import { toPaper, isValidPaper, isPaperSourceId, type Paper, type PaperCandidate } from '../../src/models/paper';
import { InMemoryFileStore } from '../../src/persistence/filestore';
import { PaperStore } from '../../src/persistence/store';
import { wrap, unwrap, migrate } from '../../src/persistence/record';
import { renderNote, parseNote } from '../../src/persistence/note';

type Status = 'PASS' | 'FAIL' | 'SKIP';
interface Result { id: string; desc: string; status: Status; error?: string; reason?: string }
const results: Result[] = [];

async function check(id: string, desc: string, fn: () => Promise<void> | void): Promise<void> {
	try {
		await fn();
		results.push({ id, desc, status: 'PASS' });
	} catch (e) {
		results.push({ id, desc, status: 'FAIL', error: e instanceof Error ? e.message : String(e) });
	}
}
function skip(id: string, desc: string, reason: string): void {
	results.push({ id, desc, status: 'SKIP', reason });
}
function assert(cond: unknown, msg: string): asserts cond {
	if (!cond) throw new Error(msg);
}
function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	const ka = Object.keys(a as object);
	const kb = Object.keys(b as object);
	if (ka.length !== kb.length) return false;
	return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

// Build 001's PaperCandidate (the pre-validation shape) so seams genuinely start
// from 001's producer, not a hand-forged Paper.
function candidate(n: number, over: Partial<PaperCandidate> = {}): PaperCandidate {
	return {
		title: `Title ${n}`,
		publicationYear: 2020,
		authors: ['Ada Lovelace', 'Alan Turing'],
		citationCount: 3,
		abstract: `Abstract ${n}`,
		sourceId: `arxiv:${n}` as PaperSourceIdLike,
		references: ['arxiv:ref'] as PaperCandidate['references'],
		embedding: undefined,
		embeddingModel: undefined,
		embeddingSource: undefined,
		...over,
	};
}
type PaperSourceIdLike = Paper['sourceId'];

// Produce a validated 001 Paper via the real gate. Throws if 001 would hold it back.
function make001Paper(n: number, over: Partial<PaperCandidate> = {}): Paper {
	const p = toPaper(candidate(n, over));
	assert(p !== undefined, `001 toPaper unexpectedly held back paper ${n}`);
	assert(isValidPaper(p), `001 isValidPaper rejected its own toPaper output for ${n}`);
	return p;
}

async function main() {
	// ===== Per-seam scenarios (connection points) ===========================

	// Seam: 003 FR-016 — record wraps a serialized 001 Paper under `paper`.
	await check('C1', '[001->003] a valid 001 Paper wraps into a 003 record and unwraps identically', () => {
		const paper = make001Paper(1, { embedding: [0.1, 0.2], embeddingModel: 'bge', embeddingSource: 'local' });
		const record = wrap({ paper });
		assert(deepEqual(unwrap(record), paper), 'unwrap(record) is not the 001 Paper that went in');
		assert(record.schemaVersion >= 1 && typeof record.createdAt === 'number', '003 wrapper metadata not attached');
	});

	// Seam: 003 FR-002 — note frontmatter mirrors 001's shared field subset.
	await check('C2', '[001->003] every shared frontmatter field equals the nested 001 Paper', () => {
		const paper = make001Paper(2, { authors: ['Grace Hopper'], citationCount: 11 });
		const fm = parseNote(renderNote(wrap({ paper }), '')).frontmatter;
		assert(fm.title === paper.title, 'title mismatch across seam');
		assert(deepEqual(fm.authors, paper.authors), 'authors mismatch across seam');
		assert(fm.publicationYear === paper.publicationYear, 'publicationYear mismatch');
		assert(fm.citationCount === paper.citationCount, 'citationCount mismatch');
		assert(fm.pg3d_sourceId === paper.sourceId, 'pg3d_sourceId must equal 001 sourceId');
		assert(fm.readState === 'unread', 'readState default not surfaced');
	});

	// Seam negative: 003 FR-002 — fields OUTSIDE the shared subset must not leak.
	await check('C3', '[001->003] non-mirrored 001 fields (references/abstract/embedding) do not leak into the note', () => {
		const paper = make001Paper(3, { embedding: [0.9], embeddingModel: 'm', embeddingSource: 'local' });
		const note = renderNote(wrap({ paper }), '');
		const fm = parseNote(note).frontmatter;
		assert(!('references' in fm), 'raw references leaked into frontmatter');
		assert(!('abstract' in fm), 'abstract leaked into frontmatter');
		assert(!('embedding' in fm) && !('schemaVersion' in fm) && !('citationsKnown' in fm), 'non-subset field leaked into frontmatter');
		assert(!note.includes('arxiv:ref'), 'a reference sourceId leaked into the note text');
	});

	// Seam: 001 FR-019/022 embedding — persists in the record, never in the note.
	await check('C4', '[001->003] the 001 embedding is carried in the record but absent from every note region', () => {
		const paper = make001Paper(4, { embedding: [0.42, 0.99], embeddingModel: 'bge-small', embeddingSource: 'local' });
		const record = wrap({ paper });
		assert(deepEqual(unwrap(record).embedding, [0.42, 0.99]), 'embedding not persisted in the record');
		const note = renderNote(record, '');
		assert(!note.includes('0.42') && !note.toLowerCase().includes('embedding'), 'embedding leaked into the note');
	});

	// Seam: 001 sourceId is 003's pairing/dedup key.
	await check('C5', '[001->003] 003 keys the pairing by the exact 001 sourceId and reads it back', async () => {
		const paper = make001Paper(5);
		assert(isPaperSourceId(paper.sourceId), '001 sourceId is not a valid PaperSourceId');
		const store = new PaperStore(new InMemoryFileStore());
		await store.upsert({ paper });
		assert(store.has(paper.sourceId), '003 did not key the pairing by the 001 sourceId');
		const back = await store.get(paper.sourceId);
		assert(back?.sourceId === paper.sourceId, 'read-back sourceId does not match');
	});

	// Seam negative: a Paper 001 holds back can never become a valid 003 record.
	await check('C6', '[001->003] a paper 001 rejects (missing / NaN year) never produces a downstream artifact', async () => {
		assert(toPaper(candidate(6, { publicationYear: undefined })) === undefined, '001 promoted a year-less candidate');
		assert(toPaper(candidate(6, { publicationYear: Number.NaN })) === undefined, '001 promoted a NaN-year candidate');
		// The pre-validation shape is also not a valid Paper, so nothing valid can be handed to 003.
		const preValidation = { ...candidate(6, { publicationYear: undefined }) } as unknown;
		assert(!isValidPaper(preValidation), '001 validator accepted a year-less shape');
	});

	// Seam: 001 promotion semantics (citationsKnown + defaults) survive 003.
	await check('C7', '[001->003] 001 promotion defaults (citationsKnown=false, count 0) round-trip through the record', () => {
		const paper = make001Paper(7, { citationCount: undefined, references: undefined });
		assert(paper.citationsKnown === false && paper.citationCount === 0 && deepEqual(paper.references, []), '001 promotion defaults wrong (pre-seam sanity)');
		assert(deepEqual(unwrap(wrap({ paper })), paper), '003 record did not preserve 001 promotion semantics');
	});

	// ===== Whole-system end-to-end scenarios ================================

	// E1: one artifact threaded 001 -> 003 wrap -> record+note pair -> read back.
	await check('E1', '[system] a 001 Paper round-trips through 003 persist+read unchanged, user body preserved', async () => {
		const paper = make001Paper(100, { embedding: [0.1, 0.2], embeddingModel: 'bge', embeddingSource: 'local' });
		const fs = new InMemoryFileStore();
		const store = new PaperStore(fs);
		await store.upsert({ paper });
		const back = await store.get(paper.sourceId);
		assert(deepEqual(back, paper), 'full-chain round-trip changed the 001 Paper');

		// Thread a downstream update: append a user body, re-persist an updated 001 Paper.
		const body = 'My cross-spec notes — 한글/テスト.';
		await fs.write('arxiv_100.md', ((await fs.read('arxiv_100.md')) ?? '') + body);
		const updated = make001Paper(100, { citationCount: 77, embedding: [0.1, 0.2], embeddingModel: 'bge', embeddingSource: 'local' });
		await store.upsert({ paper: updated });
		assert(parseNote((await fs.read('arxiv_100.md')) ?? '').userBody === body, 'user body clobbered across the chain');
		const back2 = await store.get(paper.sourceId);
		assert(back2?.citationCount === 77 && deepEqual(back2?.embedding, [0.1, 0.2]), 'update did not thread through / embedding lost');
	});

	// E2: emergent negative — an upstream reject yields no valid artifact anywhere downstream.
	await check('E2', '[system] a 001-held-back paper produces nothing persistable across the whole chain', async () => {
		const held = toPaper(candidate(101, { publicationYear: Number.NaN }));
		assert(held === undefined, '001 did not hold back the invalid candidate');
		// With no valid Paper, the pipeline has nothing to hand 003 — assert the store stays empty.
		const store = new PaperStore(new InMemoryFileStore());
		assert(!store.has('arxiv:101' as Paper['sourceId']), 'a held-back paper somehow appears downstream');
		let all = 0;
		for await (const _ of store.all()) all++;
		assert(all === 0, 'downstream enumerated an artifact for a rejected upstream paper');
	});

	// E3: emergent idempotency/ordering across specs — re-threading the same artifact is stable.
	await check('E3', '[system] re-persisting the same 001 Paper is idempotent and preserves the 001 shape', async () => {
		const paper = make001Paper(102);
		const fs = new InMemoryFileStore();
		const store = new PaperStore(fs);
		await store.upsert({ paper });
		await store.upsert({ paper });
		assert((await fs.list()).filter((f) => f.endsWith('.md')).length === 1, 'idempotency broken: duplicate note across the chain');
		assert(deepEqual(await store.get(paper.sourceId), paper), '001 shape drifted after repeated persistence');
	});

	// ---- Report -------------------------------------------------------------
	for (const r of results) {
		if (r.status === 'PASS') console.log(`[PASS] ${r.id} — ${r.desc}`);
		else if (r.status === 'FAIL') console.log(`[FAIL] ${r.id} — ${r.desc}: ${r.error}`);
		else console.log(`[SKIP] ${r.id} — ${r.desc} (${r.reason})`);
	}
	const p = results.filter((r) => r.status === 'PASS').length;
	const f = results.filter((r) => r.status === 'FAIL').length;
	const s = results.filter((r) => r.status === 'SKIP').length;
	console.log(`Summary: ${p} passed, ${f} failed, ${s} skipped`);
	process.exitCode = f > 0 ? 1 : 0;
}

main().catch((e) => {
	console.error(e);
	process.exitCode = 1;
});
