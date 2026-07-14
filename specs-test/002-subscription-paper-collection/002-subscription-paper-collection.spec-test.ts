// Spec-test for 002-subscription-paper-collection — derived from
// specs/002-subscription-paper-collection/spec.md against the real src/collection +
// src/models exports. Report-only, DETERMINISTIC: no live network. Scenarios that
// depend on the scheduler loop, live arXiv/Semantic Scholar calls, Obsidian lifecycle,
// or DOM (arXiv Atom parsing uses DOMParser) are recorded as SKIP with a reason.
// Run via esbuild + node with `--alias:obsidian=./_obsidian-shim.ts` and
// `--external:@huggingface/transformers`.

// Node has no `window`; the collection pipeline yields via window.setTimeout.
(globalThis as unknown as { window: typeof globalThis }).window = globalThis;

import {
	createSubscriptionStore,
	type SubscriptionStore,
} from '../../src/collection/subscriptionStore';
import type { Subscription } from '../../src/models/subscription';
import { DEFAULT_CHECK_INTERVAL_HOURS } from '../../src/models/subscription';
import {
	computeCollectionWindow,
	computeLagOverlapWindow,
	computeBackfillWindow,
} from '../../src/collection/scheduler';
import { promote } from '../../src/collection/promotion';
import {
	parseSemanticScholarPaper,
	toPaperSourceId,
} from '../../src/collection/semanticScholarParser';
import { runCollectionPass } from '../../src/collection/pipeline';
import type { PipelineHooks, EnrichmentOutcome } from '../../src/collection/types';
import { BASELINE_EMBEDDING_MODEL } from '../../src/collection/embedding';
import type { Paper, PaperCandidate, PaperSourceId } from '../../src/models/paper';

const DAY = 24 * 60 * 60 * 1000;

type Result = { id: string; desc: string; status: 'PASS' | 'FAIL' | 'SKIP'; note?: string };
const results: Result[] = [];
function assert(cond: unknown, msg: string): void { if (!cond) throw new Error(msg); }
async function check(id: string, desc: string, fn: () => void | Promise<void>): Promise<void> {
	try { await fn(); results.push({ id, desc, status: 'PASS' }); }
	catch (err) { results.push({ id, desc, status: 'FAIL', note: err instanceof Error ? err.message : String(err) }); }
}
function skip(id: string, desc: string, reason: string): void { results.push({ id, desc, status: 'SKIP', note: reason }); }

// ---- store harness (in-memory persistence, no Obsidian) ----
function makeStore(): { store: SubscriptionStore; saved: () => Subscription[]; registered: Subscription[] } {
	let backing: Subscription[] = [];
	const registered: Subscription[] = [];
	const store = createSubscriptionStore({
		load: async () => backing.map((s) => ({ ...s })),
		save: async (subs) => { backing = subs.map((s) => ({ ...s })); },
		onRegistered: (s) => registered.push(s),
	});
	return { store, saved: () => backing, registered };
}

// ---- candidate / hooks harness for runCollectionPass ----
function candidate(sourceId: string, over: Partial<PaperCandidate> = {}): PaperCandidate {
	return {
		title: 'T ' + sourceId, publicationYear: 2020, authors: ['A'], citationCount: undefined,
		abstract: 'abstract text for ' + sourceId, sourceId: sourceId as PaperSourceId, references: undefined,
		embedding: undefined, embeddingModel: undefined, embeddingSource: undefined, ...over,
	};
}
async function* gen(cands: PaperCandidate[]): AsyncIterable<PaperCandidate> { for (const c of cands) yield c; }
function makeHooks(): { hooks: PipelineHooks; persisted: { paper: Paper; summary?: { summary: string; futureDirections: string } }[] } {
	const persisted: { paper: Paper; summary?: { summary: string; futureDirections: string } }[] = [];
	const hooks: PipelineHooks = {
		persist: async (paper, summary) => { persisted.push({ paper, summary }); },
		alreadyPersisted: async () => false,
	};
	return { hooks, persisted };
}
const noEnrich = async (): Promise<Map<PaperSourceId, EnrichmentOutcome>> => new Map();

async function main() {
	// =================================================================
	// US1 — Register and manage subscriptions
	// =================================================================
	await check('US1.1', 'Register type+value → new sub with default interval, appears in list', async () => {
		const { store } = makeStore();
		const sub = await store.register({ type: 'keyword', value: 'ml' });
		assert(sub.checkIntervalHours === DEFAULT_CHECK_INTERVAL_HOURS, 'default interval 24');
		assert(sub.enabled === true, 'enabled by default');
		assert(sub.lastCheckedAt === null, 'lastCheckedAt null initially');
		assert(store.list().length === 1 && store.list()[0]!.value === 'ml', 'appears in list');
	});
	await check('US1.5', 'Register without a label → label defaults to value', async () => {
		const { store } = makeStore();
		const sub = await store.register({ type: 'author', value: 'Hinton' });
		assert(sub.label === 'Hinton', 'label defaults to value');
	});
	await check('US1.6/SC-009', 'Registering an existing (type,value) returns it unchanged, no duplicate', async () => {
		const { store } = makeStore();
		await store.register({ type: 'keyword', value: 'ml', checkIntervalHours: 12 });
		const again = await store.register({ type: 'keyword', value: 'ml', label: 'other', checkIntervalHours: 48 });
		assert(store.list().length === 1, 'no duplicate created');
		assert(again.checkIntervalHours === 12, 'new interval ignored on idempotent hit');
	});
	await check('US1.4', 'setCheckInterval accepts only the five allowed intervals; else keeps prior', async () => {
		const { store } = makeStore();
		const sub = await store.register({ type: 'keyword', value: 'x' });
		assert((await store.setCheckInterval(sub, 72)) === 72, 'allowed 72 applied');
		assert(store.list()[0]!.checkIntervalHours === 72, 'stored 72');
		assert((await store.setCheckInterval(sub, 999)) === 72, 'disallowed keeps prior 72');
		assert(store.list()[0]!.checkIntervalHours === 72, 'still 72 after bad interval');
	});
	await check('US1.2/US1.3', 'Disable flips enabled; delete removes from the list', async () => {
		const { store } = makeStore();
		const sub = await store.register({ type: 'keyword', value: 'x' });
		await store.setEnabled(sub, false);
		assert(store.list()[0]!.enabled === false, 'disabled flag persisted');
		await store.remove(sub);
		assert(store.list().length === 0, 'removed from list');
	});
	await check('SC-014-cb', 'onRegistered fires only on a genuinely-new registration, not an idempotent hit', async () => {
		const { store, registered } = makeStore();
		await store.register({ type: 'keyword', value: 'ml' });
		await store.register({ type: 'keyword', value: 'ml' }); // idempotent
		assert(registered.length === 1, 'onRegistered fired exactly once');
	});
	await check('FR-025/SC-011', 'Registering an empty/whitespace value is rejected; no subscription created', async () => {
		const { store } = makeStore();
		let threwEmpty = false, threwWs = false;
		try { await store.register({ type: 'keyword', value: '' }); } catch { threwEmpty = true; }
		try { await store.register({ type: 'keyword', value: '   ' }); } catch { threwWs = true; }
		assert(threwEmpty && threwWs, 'both empty and whitespace rejected');
		assert(store.list().length === 0, 'nothing created');
	});

	// =================================================================
	// US2/US3 — check completion + window logic (pure parts)
	// =================================================================
	await check('US2.2/US3.2', 'recordChecked advances lastCheckedAt and initializes coveredFrom once; never backward', async () => {
		const { store } = makeStore();
		const sub = await store.register({ type: 'keyword', value: 'x' });
		await store.recordChecked(sub, 1000, 500);
		let s = store.list()[0]!;
		assert(s.lastCheckedAt === 1000, 'lastCheckedAt advanced to 1000');
		assert(s.coveredFrom === 500, 'coveredFrom initialized to windowFrom');
		await store.recordChecked(sub, 800, 200); // earlier -> must not move backward
		s = store.list()[0]!;
		assert(s.lastCheckedAt === 1000, 'not moved backward (FR-006/FR-024)');
		assert(s.coveredFrom === 500, 'coveredFrom not re-initialized');
	});
	await check('US3.1-window/SC-018/FR-030', 'A first check (lastCheckedAt=null) yields a 24h look-back window', () => {
		const now = 10 * DAY;
		const w = computeCollectionWindow({ lastCheckedAt: null }, now);
		assert(w.to === now && w.from === now - DAY, 'first window is [now-24h, now]');
	});
	await check('EC-window-normal', 'A subsequent check window spans [lastCheckedAt, now]', () => {
		const now = 10 * DAY;
		const w = computeCollectionWindow({ lastCheckedAt: 5 * DAY }, now);
		assert(w.from === 5 * DAY && w.to === now, 'window is [lastCheckedAt, now]');
	});
	await check('FR-024', 'A clock-backward reading yields an empty window (from===to===now)', () => {
		const now = 5 * DAY;
		const w = computeCollectionWindow({ lastCheckedAt: 9 * DAY }, now);
		assert(w.from === now && w.to === now, 'empty window on clock backward');
	});
	await check('SC-020/FR-041', 'The lag re-scan is [frontier.from - 4d, frontier.from], clamped to coveredFrom, undefined on first/backward', () => {
		const now = 100 * DAY;
		const frontier = { from: 50 * DAY, to: now };
		const lag = computeLagOverlapWindow(frontier, { lastCheckedAt: 50 * DAY, coveredFrom: null }, now);
		assert(lag !== undefined && lag.to === 50 * DAY && lag.from === 50 * DAY - 4 * DAY, 'lag window spans 4 days behind frontier.from');
		const clamped = computeLagOverlapWindow(frontier, { lastCheckedAt: 50 * DAY, coveredFrom: 49 * DAY }, now);
		assert(clamped !== undefined && clamped.from === 49 * DAY, 'clamped to coveredFrom floor');
		assert(computeLagOverlapWindow(frontier, { lastCheckedAt: null, coveredFrom: null }, now) === undefined, 'undefined on first check');
		assert(computeLagOverlapWindow(frontier, { lastCheckedAt: 200 * DAY, coveredFrom: null }, now) === undefined, 'undefined on clock backward');
	});

	// Positional-misalignment guard (enrichment.ts): the Semantic Scholar batch endpoint
	// returns results index-aligned to the input ids, so an enriched record must echo the
	// arXiv id it was asked about. These two cases stub the batch response (via globalThis.fetch,
	// same seam SC-013 uses) so they are deterministic and never touch the network.
	const stubBatch = (records: unknown[]) =>
		(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(records) })) as unknown as typeof fetch;

	await check('EC-8', "Batch enrichment REJECTS a record whose echoed arXiv id doesn't match the queried candidate — transientFailure, never enriched with another paper's citation data", async () => {
		const originalFetch = globalThis.fetch;
		try {
			// Asked about arxiv:1706.03762 but the record echoes a different id → misaligned.
			globalThis.fetch = stubBatch([{ paperId: 'wrong', externalIds: { ArXiv: '9999.99999' }, citationCount: 42, references: [] }]);
			const outcomes = await enrichFromSemanticScholar(
				[{ title: 'a', publicationYear: 2020, authors: [], citationCount: undefined, abstract: '', sourceId: 'arxiv:1706.03762', references: undefined }],
				undefined,
			);
			const outcome = outcomes.get('arxiv:1706.03762');
			assert(outcome !== undefined && outcome.status === 'transientFailure', `expected transientFailure on arXiv-id mismatch, got ${outcome?.status}`);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	await check('EC-9', 'Batch enrichment ACCEPTS a record whose echoed arXiv id matches the queried candidate (control) — enriched with its citation data', async () => {
		const originalFetch = globalThis.fetch;
		try {
			globalThis.fetch = stubBatch([{ paperId: 'right', externalIds: { ArXiv: '1706.03762' }, citationCount: 42, references: [] }]);
			const outcomes = await enrichFromSemanticScholar(
				[{ title: 'a', publicationYear: 2020, authors: [], citationCount: undefined, abstract: '', sourceId: 'arxiv:1706.03762', references: undefined }],
				undefined,
			);
			const outcome = outcomes.get('arxiv:1706.03762');
			assert(
				outcome !== undefined && outcome.status === 'enriched' && outcome.citationCount === 42,
				`expected enriched(citationCount 42) on arXiv-id match, got ${JSON.stringify(outcome)}`,
			);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	await check('SC-014', 'A genuinely new subscription has its first check begin without waiting for the next tick, never processed concurrently with it', async () => {
		let saved: unknown[] = [];
		let scheduler: { checkNow: (s: Subscription) => Promise<void> } | undefined;
		const store = createSubscriptionStore({
			load: async () => [],
			save: async (s) => { saved = s; },
			onRegistered: (s) => { void scheduler?.checkNow(s); },
		});
		let checkNowCalls = 0;
		scheduler = await startScheduler({ registerInterval: (h: number) => h } as never, {
			getSubscriptions: () => store.list(),
			onSubscriptionChecked: async () => {},
			runCheck: async () => { checkNowCalls += 1; return { truncated: false, coveredThrough: now }; },
			now: () => now,
		});
		await store.register({ type: 'keyword', value: 'sc014' });
		await new Promise((r) => setTimeout(r, 10));
		assert(checkNowCalls === 1, `expected the immediate on-register check to fire exactly once, got ${checkNowCalls}`);
	await check('US2.3/SC-004', 'A paper found twice (same sourceId) is processed only once (dedup)', async () => {
		const { hooks, persisted } = makeHooks();
		await runCollectionPass(gen([candidate('arxiv:1'), candidate('arxiv:1'), candidate('arxiv:2')]), hooks, () => false, () => undefined, noEnrich);
		assert(persisted.length === 2, 'two distinct papers persisted, duplicate collapsed');
		const ids = persisted.map((p) => p.paper.sourceId).sort();
		assert(ids[0] === 'arxiv:1' && ids[1] === 'arxiv:2', 'both distinct ids present once');
	});

	// =================================================================
	// US4 — parsing & enrichment (JSON parse + promotion; XML parse is DOM -> SKIP)
	// =================================================================
	await check('US4.2', 'Semantic Scholar JSON parses into the citation shape (arXiv ids version-stripped)', () => {
		const parsed = parseSemanticScholarPaper({
			paperId: 'X', externalIds: { ArXiv: '2001.00001v3' }, citationCount: 7,
			references: [{ paperId: 'R1', externalIds: { ArXiv: '1901.00001v1' } }, { paperId: 'R2', externalIds: {} }],
		});
		assert(parsed.paperId === 'X', 'paperId read');
		assert(parsed.arxivId === '2001.00001', 'own arXiv id version-stripped');
		assert(parsed.citationCount === 7, 'citationCount read');
		assert(parsed.references.length === 2, 'two references kept');
		assert(parsed.references[0]!.arxivId === '1901.00001', 'reference arXiv id version-stripped');
		assert(toPaperSourceId(parsed.references[0]!) === 'arxiv:1901.00001', 'arXiv reference → arxiv: sourceId');
		assert(toPaperSourceId(parsed.references[1]!) === 'semanticScholar:R2', 'non-arXiv reference → semanticScholar: sourceId');
	});
	await check('US4.3', 'A candidate promoted without enrichment: citationCount 0, references [], citationsKnown false', () => {
		const p = promote(candidate('arxiv:9', { citationCount: undefined, references: undefined }));
		assert(p !== undefined, 'promoted');
		assert(p!.citationCount === 0 && p!.references.length === 0 && p!.citationsKnown === false, 'unconfirmed defaults');
	});
	await check('US4.4/SC-007', 'An enriched candidate is stored with citationsKnown true and the provider values', async () => {
		const { hooks, persisted } = makeHooks();
		const enrich = async (): Promise<Map<PaperSourceId, EnrichmentOutcome>> =>
			new Map<PaperSourceId, EnrichmentOutcome>([['arxiv:1' as PaperSourceId, { status: 'enriched', citationCount: 42, references: ['arxiv:2' as PaperSourceId] }]]);
		await runCollectionPass(gen([candidate('arxiv:1')]), hooks, () => false, () => undefined, enrich);
		const paper = persisted[0]!.paper;
		assert(paper.citationsKnown === true, 'citationsKnown true after enrichment');
		assert(paper.citationCount === 42, 'citationCount from provider');
		assert(paper.references.length === 1 && paper.references[0] === 'arxiv:2', 'references from provider');
	});

	// =================================================================
	// Edge cases + Success Criteria (pipeline-observable)
	// =================================================================
	await check('EC-yeargate/FR-011', 'A candidate with no publication year is skipped, not persisted', async () => {
		const { hooks, persisted } = makeHooks();
		await runCollectionPass(gen([candidate('arxiv:1', { publicationYear: undefined }), candidate('arxiv:2')]), hooks, () => false, () => undefined, noEnrich);
		assert(persisted.length === 1 && persisted[0]!.paper.sourceId === 'arxiv:2', 'yearless candidate skipped');
	});
	await check('SC-007b/SC-008', 'Enrichment failure still persists the paper immediately with citationsKnown false', async () => {
		const { hooks, persisted } = makeHooks();
		const enrich = async (): Promise<Map<PaperSourceId, EnrichmentOutcome>> =>
			new Map<PaperSourceId, EnrichmentOutcome>([
				['arxiv:1' as PaperSourceId, { status: 'transientFailure' }],
				['arxiv:2' as PaperSourceId, { status: 'terminalAbsence' }],
			]);
		await runCollectionPass(gen([candidate('arxiv:1'), candidate('arxiv:2')]), hooks, () => false, () => undefined, enrich);
		assert(persisted.length === 2, 'both persisted despite enrichment failure (no paper lost)');
		assert(persisted.every((p) => p.paper.citationsKnown === false), 'citationsKnown false on failure');
	});
	await check('SC-010', 'A summary generated then discarded (summarization toggled off mid-flight) is not persisted', async () => {
		const { hooks, persisted } = makeHooks();
		hooks.summarize = async () => ({ summary: 's', futureDirections: 'f' });
		// true on the gate check, false on the post-generation re-check → discard.
		let n = 0;
		const isSummEnabled = () => (n++ === 0);
		await runCollectionPass(gen([candidate('arxiv:1')]), hooks, isSummEnabled, () => undefined, noEnrich);
		assert(persisted.length === 1, 'paper still persisted');
		assert(persisted[0]!.summary === undefined, 'stale summary discarded (abstract fallback)');
	});
	await check('SC-021/FR-044', 'Every promoted paper is persisted carrying the bundled baseline embedding', async () => {
		const { hooks, persisted } = makeHooks();
		await runCollectionPass(gen([candidate('arxiv:1')]), hooks, () => false, () => undefined, noEnrich);
		const paper = persisted[0]!.paper;
		assert(Array.isArray(paper.embedding) && paper.embedding.length === 2048, 'baseline vector attached');
		assert(paper.embeddingModel === BASELINE_EMBEDDING_MODEL, 'baseline model id recorded');
		assert(paper.embeddingSource === 'local', 'embeddingSource local');
	});

	// =================================================================
	// US5 — backfill state (store-level; the runner is network/scheduler -> SKIP)
	// =================================================================
	await check('US5.4/SC-017', 'requestBackfill sets backfillState without ever touching lastCheckedAt', async () => {
		const { store } = makeStore();
		const sub = await store.register({ type: 'keyword', value: 'x' });
		await store.recordChecked(sub, 100 * DAY, 90 * DAY); // coveredFrom = 90d, lastCheckedAt = 100d
		await store.requestBackfill(sub, 60 * DAY); // older than coveredFrom
		const s = store.list()[0]!;
		assert(s.backfillState != null && s.backfillState.targetFrom === 60 * DAY && s.backfillState.cursor === 60 * DAY, 'backfillState set at targetFrom');
		assert(s.lastCheckedAt === 100 * DAY, 'lastCheckedAt unchanged by backfill');
	});
	await check('FR-038', 'requestBackfill is a no-op when targetFrom is not older than coveredFrom (or coveredFrom unset)', async () => {
		const { store } = makeStore();
		const sub = await store.register({ type: 'keyword', value: 'x' });
		await store.requestBackfill(sub, 60 * DAY); // coveredFrom unset -> no-op
		assert(store.list()[0]!.backfillState == null, 'no state when coveredFrom unset');
		await store.recordChecked(sub, 100 * DAY, 90 * DAY);
		await store.requestBackfill(sub, 95 * DAY); // newer than coveredFrom -> no-op
		assert(store.list()[0]!.backfillState == null, 'no state when targetFrom >= coveredFrom');
	});
	await check('FR-043', 'cancelBackfill clears backfillState but leaves coveredFrom untouched', async () => {
		const { store } = makeStore();
		const sub = await store.register({ type: 'keyword', value: 'x' });
		await store.recordChecked(sub, 100 * DAY, 90 * DAY);
		await store.requestBackfill(sub, 60 * DAY);
		await store.cancelBackfill(sub);
		const s = store.list()[0]!;
		assert(s.backfillState == null, 'backfillState cleared');
		assert(s.coveredFrom === 90 * DAY, 'coveredFrom NOT lowered to the cancelled cursor');
	});
	await check('FR-036-complete', 'recordBackfillProgress to completion lowers coveredFrom to targetFrom and clears state', async () => {
		const { store } = makeStore();
		const sub = await store.register({ type: 'keyword', value: 'x' });
		await store.recordChecked(sub, 100 * DAY, 90 * DAY);
		await store.requestBackfill(sub, 60 * DAY);
		await store.recordBackfillProgress(sub, 90 * DAY); // cursor reaches coveredFrom -> complete
		const s = store.list()[0]!;
		assert(s.coveredFrom === 60 * DAY, 'coveredFrom lowered to targetFrom on completion');
		assert(s.backfillState == null, 'backfillState cleared on completion');
	});
	await check('US5.1-window', 'computeBackfillWindow is [cursor, coveredFrom] when active, undefined otherwise', () => {
		assert(computeBackfillWindow({ coveredFrom: 90 * DAY, backfillState: { targetFrom: 60 * DAY, cursor: 70 * DAY } })?.from === 70 * DAY, 'from = cursor');
		assert(computeBackfillWindow({ coveredFrom: 90 * DAY, backfillState: { targetFrom: 60 * DAY, cursor: 70 * DAY } })?.to === 90 * DAY, 'to = coveredFrom');
		assert(computeBackfillWindow({ coveredFrom: 90 * DAY, backfillState: null }) === undefined, 'undefined without active backfill');
		assert(computeBackfillWindow({ coveredFrom: null, backfillState: { targetFrom: 1, cursor: 1 } }) === undefined, 'undefined without coveredFrom');
	});

	// =================================================================
	// SKIPs — scheduler loop / live network / Obsidian lifecycle / DOM parsing
	// =================================================================
	skip('US2.1', 'An enabled, due subscription auto-checks the provider while running', 'Scheduler tick loop + live arXiv call (startScheduler needs an Obsidian Plugin)');
	skip('US3.1-exec', 'The load-time catch-up pass actually runs one search per enabled sub', 'startScheduler load path + live network');
	skip('US3.3', 'No collection occurs while the plugin is off', 'Lifecycle/absence of a process — not observable in a unit context');
	skip('US3.4', 'A disabled subscription runs no catch-up on load', 'Scheduler load path (the disabled flag itself is covered by US1.2)');
	skip('US4.1', 'arXiv Atom XML parses into a candidate with unknown citations', 'arxivParser uses DOMParser (browser-only); unavailable under node');
	skip('US5.2/SC-016', 'An over-cap backfill window is covered across passes and resumes after restart', 'Backfill runner drives runSubscriptionCheck → live queryArxiv');
	skip('US5.5', 'Disable pauses backfill; re-enable resumes from the cursor', 'Backfill runner loop (scheduler); store-level state is covered above');
	skip('US6.1/US6.2/SC-019', 'On-demand "check now" for an existing subscription runs immediately, never concurrently', 'checkNow handle is produced by startScheduler (needs Obsidian Plugin)');
	skip('SC-001', 'An enabled subscription checks on schedule with zero manual action', 'Scheduler tick loop');
	skip('SC-002', 'Opening after an off period runs exactly one catch-up per enabled sub', 'Scheduler load path + live network (window math covered by US3.1-window)');
	skip('SC-003', 'Zero external calls occur while the plugin is off', 'Lifecycle-level guarantee');
	skip('SC-005', 'Disabling a subscription yields zero further collection, including on later loads', 'Scheduler behavior (disabled flag covered by US1.2)');
	skip('SC-006', '100% of collected papers are parsed from provider responses', 'Depends on live provider parsing (JSON parse covered by US4.2; XML is DOM-only)');
	skip('SC-012', 'No paper in an over-cap window is permanently lost across successive checks', 'queryArxiv paging + scheduler advance loop (live network)');
	skip('SC-013', 'Enriching N papers issues at most ⌈N/batchMax⌉ requests', 'Requires counting live Semantic Scholar batch requests');
	skip('SC-015', 'A bulk backfill collects from the chosen start date with zero duplicates', 'Backfill runner + live network (dedup mechanism covered by SC-004)');

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
