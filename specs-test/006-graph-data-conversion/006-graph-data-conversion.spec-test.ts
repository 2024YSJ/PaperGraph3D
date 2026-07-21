// Spec-test for 006-graph-data-conversion — derived from spec.md against the real
// src/graph exports. Report-only, DETERMINISTIC: fixtures are in-memory Paper records
// and fake store/cache seams, so no live network and no real Obsidian API is touched
// (the transitive `obsidian` import from the SPECTER2 constants is stubbed via
// _obsidian-shim.ts). Run via esbuild + node with `--alias:obsidian=./_obsidian-shim.ts`
// and `--external:@huggingface/transformers` — 006 imports only the SPECTER2 constants
// from localTransformer, whose lazy transformers import is never executed here (same
// external flag 002's spec-test uses).

import { convertToGraphData } from '../../src/graph/convert';
import { isUncited } from '../../src/models/uncited';
import { SPECTER2_EMBEDDING_DIM, SPECTER2_EMBEDDING_MODEL } from '../../src/collection/localTransformer';
import type { Paper, PaperSourceId } from '../../src/models/paper';
import type { BasisCache, GraphReadStore, ProjectionBasis } from '../../src/graph/types';
// Chain-test seam: the REAL 003 store over the offline in-memory FileStore, to verify
// conversion runs against an actual persisted corpus (not just the fake GraphReadStore).
import { PaperStore } from '../../src/persistence/store';
import { InMemoryFileStore } from '../../src/persistence/filestore';

type Result = { id: string; desc: string; status: 'PASS' | 'FAIL' | 'SKIP'; note?: string };
const results: Result[] = [];
function assert(cond: unknown, msg: string): void { if (!cond) throw new Error(msg); }
async function check(id: string, desc: string, fn: () => void | Promise<void>): Promise<void> {
	try { await fn(); results.push({ id, desc, status: 'PASS' }); }
	catch (err) { results.push({ id, desc, status: 'FAIL', note: err instanceof Error ? err.message : String(err) }); }
}
function skip(id: string, desc: string, reason: string): void { results.push({ id, desc, status: 'SKIP', note: reason }); }

// --- fixtures -----------------------------------------------------------------

function paper(over: Partial<Paper> & { sourceId: PaperSourceId }): Paper {
	return {
		title: 'T',
		publicationYear: 2024,
		publicationDate: undefined,
		authors: [],
		citationCount: 0,
		citationsKnown: false,
		abstract: 'A',
		references: [],
		embedding: null,
		embeddingModel: null,
		embeddingSource: null,
		...over,
	};
}

// A 768-dim canonical vector whose only non-zero entries are the first two, so PCA
// recovers a 2D structure we can reason about.
function vec2(a: number, b: number): number[] {
	const v = new Array<number>(SPECTER2_EMBEDDING_DIM).fill(0);
	v[0] = a;
	v[1] = b;
	return v;
}

function canonical(over: Partial<Paper> & { sourceId: PaperSourceId }, a: number, b: number): Paper {
	return paper({
		embedding: vec2(a, b),
		embeddingModel: SPECTER2_EMBEDDING_MODEL,
		embeddingSource: 'local',
		...over,
	});
}

function fakeStore(papers: Paper[]): GraphReadStore {
	const ids = new Set<PaperSourceId>(papers.map((p) => p.sourceId));
	return {
		async *all() { for (const p of papers) yield p; },
		has: (id) => ids.has(id),
	};
}

function fakeCache(): BasisCache & { saves: () => number } {
	let stored: ProjectionBasis | undefined;
	let saves = 0;
	return {
		load: async () => stored,
		save: async (b) => { stored = b; saves += 1; },
		saves: () => saves,
	};
}

const dist = (p: { x: number; y: number }, q: { x: number; y: number }): number =>
	Math.hypot(p.x - q.x, p.y - q.y);
const nodeById = (data: { nodes: { id: PaperSourceId }[] }, id: PaperSourceId) =>
	data.nodes.find((n) => n.id === id);

// Enough distinct canonical papers to fit a basis and cross the refit floor.
function canonicalBatch(prefix: string, count: number): Paper[] {
	const out: Paper[] = [];
	for (let i = 0; i < count; i += 1) {
		out.push(canonical({ sourceId: `arxiv:${prefix}${i}` as PaperSourceId }, Math.cos(i), Math.sin(i)));
	}
	return out;
}

async function main() {
	// =================================================================
	// US1 — nodes & connections
	// =================================================================
	await check('US1.nodes', 'One node per record with a year; fields read from the record', async () => {
		const store = fakeStore([
			paper({ sourceId: 'arxiv:1', title: 'One', publicationYear: 2020 }),
			paper({ sourceId: 'arxiv:2', title: 'Two', publicationYear: 2021 }),
		]);
		const data = await convertToGraphData(store, fakeCache());
		assert(data.nodes.length === 2, 'two nodes');
		const n = nodeById(data, 'arxiv:1');
		assert(n !== undefined && n.title === 'One' && n.publicationYear === 2020, 'fields from the record');
	});
	await check('US1.year-less', 'A record without a numeric publication year is excluded', async () => {
		const store = fakeStore([
			paper({ sourceId: 'arxiv:1', publicationYear: 2020 }),
			paper({ sourceId: 'arxiv:2', publicationYear: undefined as unknown as number }),
		]);
		const data = await convertToGraphData(store, fakeCache());
		assert(data.nodes.length === 1 && nodeById(data, 'arxiv:2') === undefined, 'year-less excluded');
	});
	await check('US1.malformed', 'A malformed record is skipped, the rest still convert, never throws', async () => {
		const store = fakeStore([
			{ sourceId: 'arxiv:bad', title: undefined as unknown as string } as Paper,
			paper({ sourceId: 'arxiv:ok', publicationYear: 2022 }),
		]);
		const data = await convertToGraphData(store, fakeCache());
		assert(data.nodes.length === 1 && nodeById(data, 'arxiv:ok') !== undefined, 'bad skipped, ok kept');
	});
	await check('US1.edge', 'A cites B → directional A→B, no reverse', async () => {
		const store = fakeStore([
			paper({ sourceId: 'arxiv:A', references: ['arxiv:B'] as PaperSourceId[] }),
			paper({ sourceId: 'arxiv:B' }),
		]);
		const data = await convertToGraphData(store, fakeCache());
		assert(data.connections.length === 1, 'one edge');
		assert(data.connections[0]?.from === 'arxiv:A' && data.connections[0]?.to === 'arxiv:B', 'A→B');
	});
	await check('US1.dangling', 'A reference to a non-stored paper is dropped, no fabricated node', async () => {
		const store = fakeStore([paper({ sourceId: 'arxiv:A', references: ['arxiv:GHOST'] as PaperSourceId[] })]);
		const data = await convertToGraphData(store, fakeCache());
		assert(data.connections.length === 0, 'no edge to a missing target');
		assert(data.nodes.length === 1 && nodeById(data, 'arxiv:GHOST') === undefined, 'no fabricated node');
	});
	await check('US1.self-loop', 'A reference to itself produces no self-loop', async () => {
		const store = fakeStore([paper({ sourceId: 'arxiv:A', references: ['arxiv:A'] as PaperSourceId[] })]);
		const data = await convertToGraphData(store, fakeCache());
		assert(data.connections.length === 0, 'no self-loop');
	});
	await check('US1.cycle', 'A↔B produces both directional edges, no loop/failure', async () => {
		const store = fakeStore([
			paper({ sourceId: 'arxiv:A', references: ['arxiv:B'] as PaperSourceId[] }),
			paper({ sourceId: 'arxiv:B', references: ['arxiv:A'] as PaperSourceId[] }),
		]);
		const data = await convertToGraphData(store, fakeCache());
		assert(data.connections.length === 2, 'both directions');
	});
	await check('US1.empty-refs', 'Empty references → no edges; the node still carries citationsKnown', async () => {
		const store = fakeStore([paper({ sourceId: 'arxiv:A', references: [], citationsKnown: true, citationCount: 3 })]);
		const data = await convertToGraphData(store, fakeCache());
		assert(data.connections.length === 0, 'no edges');
		assert(nodeById(data, 'arxiv:A')?.citationsKnown === true, 'citationsKnown carried');
	});
	await check('US1.uncited', 'uncited flag = shared isUncited rule, never inbound degree', async () => {
		const store = fakeStore([
			paper({ sourceId: 'arxiv:U', citationsKnown: true, citationCount: 0 }), // confirmed uncited
			paper({ sourceId: 'arxiv:N', citationsKnown: false, citationCount: 0 }), // un-enriched, NOT uncited
			paper({ sourceId: 'arxiv:C', citationsKnown: true, citationCount: 5, references: [] }),
		]);
		const data = await convertToGraphData(store, fakeCache());
		assert(nodeById(data, 'arxiv:U')?.uncited === true, 'confirmed 0 is uncited');
		assert(nodeById(data, 'arxiv:N')?.uncited === false, 'un-enriched 0 is not uncited');
		assert(nodeById(data, 'arxiv:C')?.uncited === false, 'cited is not uncited');
		// matches the shared helper for every node
		for (const n of data.nodes) {
			assert(n.uncited === isUncited({ citationsKnown: n.citationsKnown, citationCount: n.citationCount }), 'flag = shared rule');
		}
	});
	await check('US1.data-only', 'Output is exactly { nodes, connections, basisModel }; empty corpus is empty, not an error', async () => {
		const data = await convertToGraphData(fakeStore([]), fakeCache());
		assert(Object.keys(data).sort().join(',') === 'basisModel,connections,nodes', 'exact output shape');
		assert(data.nodes.length === 0 && data.connections.length === 0, 'empty corpus → empty graph');
		assert(data.basisModel === SPECTER2_EMBEDDING_MODEL, 'basisModel is the canonical space');
	});

	// =================================================================
	// US2 — content-similarity layout
	// =================================================================
	await check('US2.deterministic', 'Same corpus (fresh cache) → byte-identical positions across runs', async () => {
		const mk = () => fakeStore(canonicalBatch('D', 6));
		const a = await convertToGraphData(mk(), fakeCache());
		const b = await convertToGraphData(mk(), fakeCache());
		for (const na of a.nodes) {
			const nb = nodeById(b, na.id);
			assert(nb !== undefined && nb.position.x === na.position.x && nb.position.y === na.position.y, `identical position for ${na.id}`);
			assert(na.positionSource === 'projected', 'canonical nodes are projected');
		}
	});
	await check('US2.similarity', 'Content-similar embeddings land closer than dissimilar ones', async () => {
		const store = fakeStore([
			canonical({ sourceId: 'arxiv:P1' }, 1, 0),
			canonical({ sourceId: 'arxiv:P2' }, 0.98, 0.2), // near P1
			canonical({ sourceId: 'arxiv:P3' }, 0, 1), // far from P1
			canonical({ sourceId: 'arxiv:P4' }, -1, 0),
		]);
		const data = await convertToGraphData(store, fakeCache());
		const p1 = nodeById(data, 'arxiv:P1')!.position;
		const p2 = nodeById(data, 'arxiv:P2')!.position;
		const p3 = nodeById(data, 'arxiv:P3')!.position;
		assert(dist(p1, p2) < dist(p1, p3), 'similar pair is closer than the dissimilar pair');
	});
	await check('US2.out-of-sample', 'Adding a canonical paper below the refit threshold keeps existing positions and refits nothing', async () => {
		const cache = fakeCache();
		const base = canonicalBatch('O', 4);
		const first = await convertToGraphData(fakeStore(base), cache);
		const savesAfterFit = cache.saves();
		const grown = [...base, canonical({ sourceId: 'arxiv:Onew' as PaperSourceId }, 0.3, 0.7)];
		const second = await convertToGraphData(fakeStore(grown), cache);
		assert(cache.saves() === savesAfterFit, 'no basis re-save below the refit threshold');
		for (const nf of first.nodes) {
			const ns = nodeById(second, nf.id);
			assert(ns !== undefined && ns.position.x === nf.position.x && ns.position.y === nf.position.y, `existing node ${nf.id} unmoved`);
		}
		assert(nodeById(second, 'arxiv:Onew')?.positionSource === 'projected', 'new canonical node projected on the cached basis');
	});
	await check('US2.refit', 'Crossing the growth threshold refits (re-saves) the basis', async () => {
		const cache = fakeCache();
		await convertToGraphData(fakeStore(canonicalBatch('R', 3)), cache);
		const savesAfterFit = cache.saves();
		await convertToGraphData(fakeStore(canonicalBatch('R', 28)), cache); // +25 → refit
		assert(cache.saves() === savesAfterFit + 1, 'basis refit and re-saved once');
	});
	await check('US2.fallback', 'Pending/non-canonical node → deterministic fallback, not mixed into the fit', async () => {
		const withPending = fakeStore([
			...canonicalBatch('F', 4),
			paper({ sourceId: 'arxiv:pending' }), // embedding null → pending
			canonical({ sourceId: 'arxiv:baseline' as PaperSourceId, embeddingModel: 'local-hashtf-v1-d2048' }, 1, 1), // non-canonical model
		]);
		const a = await convertToGraphData(withPending, fakeCache());
		const b = await convertToGraphData(withPending, fakeCache());
		const pa = nodeById(a, 'arxiv:pending')!;
		assert(pa.positionSource === 'fallback', 'pending gets fallback');
		assert(nodeById(a, 'arxiv:baseline')!.positionSource === 'fallback', 'non-canonical model gets fallback');
		const pb = nodeById(b, 'arxiv:pending')!;
		assert(pa.position.x === pb.position.x && pa.position.y === pb.position.y, 'fallback is deterministic across runs');
		// removing the pending nodes must not change the canonical nodes' projected positions
		const withoutPending = await convertToGraphData(fakeStore(canonicalBatch('F', 4)), fakeCache());
		for (const n of withoutPending.nodes) {
			const same = nodeById(a, n.id);
			assert(same !== undefined && same.position.x === n.position.x && same.position.y === n.position.y, `${n.id} unaffected by pending nodes in the fit`);
		}
	});
	await check('US2.no-reembed', 'Conversion never re-embeds; a pending node projects only once its record becomes canonical', async () => {
		const pendingFirst = paper({ sourceId: 'arxiv:X' });
		const before = await convertToGraphData(fakeStore([...canonicalBatch('N', 4), pendingFirst]), fakeCache());
		assert(nodeById(before, 'arxiv:X')?.positionSource === 'fallback', 'stays fallback while pending');
		const nowCanonical = canonical({ sourceId: 'arxiv:X' as PaperSourceId }, 0.5, 0.5); // simulate 002 re-embed converging it
		const after = await convertToGraphData(fakeStore([...canonicalBatch('N', 4), nowCanonical]), fakeCache());
		assert(nodeById(after, 'arxiv:X')?.positionSource === 'projected', 'projected after its record becomes canonical');
	});

	// =================================================================
	// CHAIN — real 003 PaperStore (over the in-memory FileStore) → 006 convert.
	// Proves the structural GraphReadStore contract holds against the ACTUAL store:
	// upsert → JSON serialize → index → all() hydration feeds conversion, still with
	// no network and no real Obsidian API (InMemoryFileStore is Obsidian-free).
	// =================================================================
	// One persisted corpus reused by the chain checks: 4 distinct canonical papers
	// (C0 cites C1 and a dangling GHOST; C0 is confirmed-0 ⇒ uncited), a pending
	// (null-embedding) paper, and a year-less paper that must be excluded.
	const chainCorpus: Paper[] = [
		canonical({ sourceId: 'arxiv:CH0' as PaperSourceId, title: 'Chain Zero', publicationYear: 2020, citationsKnown: true, citationCount: 0, references: ['arxiv:CH1', 'arxiv:GHOST'] as PaperSourceId[] }, 1, 0),
		canonical({ sourceId: 'arxiv:CH1' as PaperSourceId, title: 'Chain One', publicationYear: 2021, citationsKnown: true, citationCount: 5 }, 0.9, 0.2),
		canonical({ sourceId: 'arxiv:CH2' as PaperSourceId, title: 'Chain Two', publicationYear: 2022 }, 0, 1),
		canonical({ sourceId: 'arxiv:CH3' as PaperSourceId, title: 'Chain Three', publicationYear: 2023 }, -1, 0.1),
		paper({ sourceId: 'arxiv:CHP' as PaperSourceId, title: 'Chain Pending', publicationYear: 2024 }), // embedding null ⇒ fallback
		paper({ sourceId: 'arxiv:CHY' as PaperSourceId, title: 'No Year', publicationYear: undefined as unknown as number }), // excluded
	];
	const persist = async (papers: Paper[]): Promise<PaperStore> => {
		const store = new PaperStore(new InMemoryFileStore());
		for (const p of papers) await store.upsert({ paper: p }); // sequential: stems disambiguate deterministically
		return store;
	};

	await check('chain.store-to-graph', 'Real PaperStore → convert: persisted corpus hydrates into nodes + edges + projection', async () => {
		const store = await persist(chainCorpus);
		const data = await convertToGraphData(store, fakeCache());
		// year-less excluded, the other five kept
		assert(data.nodes.length === 5, 'five nodes (year-less excluded)');
		assert(nodeById(data, 'arxiv:CHY') === undefined, 'year-less paper excluded');
		// edge resolution via the real index: C0→C1 kept, dangling GHOST dropped, no fabricated node
		assert(data.connections.length === 1, 'exactly one edge');
		assert(data.connections[0]?.from === 'arxiv:CH0' && data.connections[0]?.to === 'arxiv:CH1', 'directional C0→C1');
		assert(nodeById(data, 'arxiv:GHOST') === undefined, 'dangling reference fabricates no node');
		// embeddings survived the JSON serialize/parse round-trip → canonical nodes projected
		for (const id of ['arxiv:CH0', 'arxiv:CH1', 'arxiv:CH2', 'arxiv:CH3'] as PaperSourceId[]) {
			assert(nodeById(data, id)?.positionSource === 'projected', `${id} projected from its hydrated embedding`);
		}
		assert(nodeById(data, 'arxiv:CHP')?.positionSource === 'fallback', 'pending paper falls back');
		// the shared uncited rule survives persistence
		assert(nodeById(data, 'arxiv:CH0')?.uncited === true, 'confirmed-0 stays uncited through the store');
		assert(data.basisModel === SPECTER2_EMBEDDING_MODEL, 'basisModel is the canonical space');
	});
	await check('chain.deterministic', 'Same persisted corpus across independent stores → identical positions', async () => {
		const canonicalOnly = chainCorpus.slice(0, 4);
		const a = await convertToGraphData(await persist(canonicalOnly), fakeCache());
		const b = await convertToGraphData(await persist(canonicalOnly), fakeCache());
		for (const na of a.nodes) {
			const nb = nodeById(b, na.id);
			assert(nb !== undefined && nb.position.x === na.position.x && nb.position.y === na.position.y, `identical position for ${na.id} across stores`);
		}
	});

	// =================================================================
	// SKIPs — real-Obsidian / plugin-wiring integration
	// =================================================================
	skip('saveData-persist', 'The real basis cache persists through this.saveData/loadData', 'Plugin wiring is 007/008 scope; this suite uses the in-memory BasisCache fake (contracts/graph-conversion-api.md)');
	skip('render', 'Nodes/edges/positions are drawn on screen', 'Rendering is 007; 006 produces data only (FR-007)');

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
