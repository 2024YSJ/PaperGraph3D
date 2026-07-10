// Spec-test for 003-paper-note-persistence — derived from
// specs/003-paper-note-persistence/spec.md against the real src/persistence exports.
// Report-only, DETERMINISTIC: the whole persistence core runs offline over
// InMemoryFileStore (no Obsidian). Only scale/UI-thread and real-Vault-boundary
// guarantees are SKIP. Run via esbuild + node (repo's no-test-runner convention).

import { InMemoryFileStore, type FileStore } from '../../src/persistence/filestore';
import { PaperStore, type PersistInput } from '../../src/persistence/store';
import { parseNote } from '../../src/persistence/note';
import { fileStem, sanitizeStem } from '../../src/persistence/filename';
import { classify, stemOf, tombstoneName } from '../../src/persistence/reconcile';
import type { Paper, PaperSourceId } from '../../src/models/paper';

type Result = { id: string; desc: string; status: 'PASS' | 'FAIL' | 'SKIP'; note?: string };
const results: Result[] = [];
function assert(cond: unknown, msg: string): void { if (!cond) throw new Error(msg); }
async function check(id: string, desc: string, fn: () => void | Promise<void>): Promise<void> {
	try { await fn(); results.push({ id, desc, status: 'PASS' }); }
	catch (err) { results.push({ id, desc, status: 'FAIL', note: err instanceof Error ? err.message : String(err) }); }
}
function skip(id: string, desc: string, reason: string): void { results.push({ id, desc, status: 'SKIP', note: reason }); }

function paper(sourceId: string, over: Partial<Paper> = {}): Paper {
	return {
		title: 'Title ' + sourceId, publicationYear: 2020, authors: ['Ada', 'Bo'], citationCount: 3,
		citationsKnown: true, abstract: 'Abstract for ' + sourceId, sourceId: sourceId as PaperSourceId,
		references: [], embedding: null, embeddingModel: null, embeddingSource: null, ...over,
	};
}
function newStore(fs: FileStore, msgs: string[]): PaperStore {
	return new PaperStore(fs, { notify: (m) => msgs.push(m) });
}
// The paths PaperStore writes for a given sourceId (relative stems only).
async function pairFiles(fs: FileStore): Promise<{ json: string[]; md: string[]; tomb: string[] }> {
	const files = await fs.list();
	return {
		json: files.filter((f) => classify(f) === 'json'),
		md: files.filter((f) => classify(f) === 'md'),
		tomb: files.filter((f) => classify(f) === 'tombstone'),
	};
}

async function main() {
	// =================================================================
	// US1 — a note (and record) is created for every new paper
	// =================================================================
	await check('US1.1/SC-001', 'Persist creates a .json + .md together, keyed by sourceId', async () => {
		const fs = new InMemoryFileStore();
		const msgs: string[] = [];
		const store = newStore(fs, msgs);
		await store.upsert({ paper: paper('arxiv:1706.03762') });
		const { json, md } = await pairFiles(fs);
		assert(json.length === 1 && md.length === 1, 'exactly one .json and one .md');
		assert(stemOf(json[0]!) === stemOf(md[0]!), 'json and md share a stem');
		const note = parseNote((await fs.read(md[0]!))!);
		assert(note.frontmatter['pg3d_sourceId'] === 'arxiv:1706.03762', 'note keyed by sourceId');
	});
	await check('US1.2', "Note frontmatter mirrors the record's shared fields", async () => {
		const fs = new InMemoryFileStore();
		const store = newStore(fs, []);
		await store.upsert({ paper: paper('arxiv:1', { title: 'X', publicationYear: 2019, citationCount: 7, authors: ['Q'] }) });
		const md = (await pairFiles(fs)).md[0]!;
		const fm = parseNote((await fs.read(md))!).frontmatter;
		assert(fm['title'] === 'X', 'title mirrored');
		assert(fm['publicationYear'] === 2019, 'publicationYear mirrored');
		assert(fm['citationCount'] === 7, 'citationCount mirrored');
		assert(fm['readState'] === 'unread', 'readState defaults unread');
		assert(Array.isArray(fm['authors']) && (fm['authors'] as string[])[0] === 'Q', 'authors mirrored');
	});
	await check('US1.3', 'A partial failure (note write fails) leaves neither a record nor a note', async () => {
		const inner = new InMemoryFileStore();
		const failing: FileStore = {
			read: (p) => inner.read(p), delete: (p) => inner.delete(p), exists: (p) => inner.exists(p), list: () => inner.list(),
			write: async (p, c) => { if (p.endsWith('.md')) throw new Error('md write failed'); return inner.write(p, c); },
		};
		const store = newStore(failing, []);
		let threw = false;
		try { await store.upsert({ paper: paper('arxiv:1') }); } catch { threw = true; }
		assert(threw, 'upsert surfaced the failure');
		const { json, md } = await pairFiles(inner);
		assert(json.length === 0 && md.length === 0, 'record rolled back — no half-created pairing');
	});

	// =================================================================
	// US2 — updates merge without destroying user writing
	// =================================================================
	await check('US2.1/SC-003', 'Re-persisting an existing paper updates in place — no duplicate note', async () => {
		const fs = new InMemoryFileStore();
		const store = newStore(fs, []);
		await store.upsert({ paper: paper('arxiv:1', { citationCount: 1 }) });
		await store.upsert({ paper: paper('arxiv:1', { citationCount: 99 }) });
		const { json, md } = await pairFiles(fs);
		assert(json.length === 1 && md.length === 1, 'still exactly one pairing');
		const fm = parseNote((await fs.read(md[0]!))!).frontmatter;
		assert(fm['citationCount'] === 99, 'managed region reflects the update');
	});
	await check('US2.2/SC-002', "An update leaves the user's hand-written body byte-for-byte unchanged", async () => {
		const fs = new InMemoryFileStore();
		const store = newStore(fs, []);
		await store.upsert({ paper: paper('arxiv:1', { citationCount: 1 }) });
		const mdPath = (await pairFiles(fs)).md[0]!;
		const userBody = '\n## My notes\n\nThis paper is *great* — TODO: reread §3.\n';
		await fs.write(mdPath, (await fs.read(mdPath))! + userBody);
		await store.upsert({ paper: paper('arxiv:1', { citationCount: 42 }) });
		const parsed = parseNote((await fs.read(mdPath))!);
		assert(parsed.userBody.includes('This paper is *great* — TODO: reread §3.'), 'user body preserved byte-for-byte');
		assert(parsed.frontmatter['citationCount'] === 42, 'managed region still updated');
	});
	await check('EC-managed-edit', 'A user-edited managed field is rebuilt from the authoritative record on next update', async () => {
		const fs = new InMemoryFileStore();
		const store = newStore(fs, []);
		await store.upsert({ paper: paper('arxiv:1', { title: 'Correct' }) });
		const mdPath = (await pairFiles(fs)).md[0]!;
		// User tampers with the managed frontmatter title.
		await fs.write(mdPath, (await fs.read(mdPath))!.replace('title: "Correct"', 'title: "Tampered"'));
		await store.upsert({ paper: paper('arxiv:1', { title: 'Correct v2' }) });
		const fm = parseNote((await fs.read(mdPath))!).frontmatter;
		assert(fm['title'] === 'Correct v2', 'managed region rebuilt from the record, not the tampered value');
	});

	// =================================================================
	// US3 — the plugin stays inside its designated folder
	// =================================================================
	await check('US3.1/SC-004', 'Every file written is a plain in-folder stem name (no path traversal)', async () => {
		const fs = new InMemoryFileStore();
		const store = newStore(fs, []);
		await store.upsert({ paper: paper('arxiv:1') });
		await store.upsert({ paper: paper('arxiv:1', { citationCount: 5 }) });
		await store.delete('arxiv:1' as PaperSourceId);
		await store.upsert({ paper: paper('semanticScholar:abc') });
		for (const f of await fs.list()) {
			assert(!f.includes('..') && !f.startsWith('/') && !f.includes(':'), `path ${f} stays inside the folder`);
		}
	});
	await check('US3.2', 'An inaccessible storage folder is reported and nothing is written elsewhere', async () => {
		const msgs: string[] = [];
		const broken: FileStore = {
			read: async () => null, write: async () => { throw new Error('EACCES'); },
			delete: async () => undefined, exists: async () => false, list: async () => { throw new Error('EACCES'); },
		};
		const store = newStore(broken, msgs);
		await store.load(); // list() throws -> notify, return
		assert(msgs.some((m) => /could not be read/i.test(m)), 'user informed of folder access failure');
	});
	await check('US3.3', 'Removing a paper deletes both its .json and .md together', async () => {
		const fs = new InMemoryFileStore();
		const store = newStore(fs, []);
		await store.upsert({ paper: paper('arxiv:1') });
		await store.delete('arxiv:1' as PaperSourceId);
		const { json, md, tomb } = await pairFiles(fs);
		assert(json.length === 0 && md.length === 0 && tomb.length === 0, 'both files (and the tombstone) gone');
		assert(store.has('arxiv:1' as PaperSourceId) === false, 'index no longer has the paper');
	});

	// =================================================================
	// Edge cases (reconciliation, rename, collision, tombstone)
	// =================================================================
	await check('EC-rename', 'After a manual note rename, the paper is still found by sourceId (no orphan report)', async () => {
		const fs = new InMemoryFileStore();
		await newStore(fs, []).upsert({ paper: paper('arxiv:1') });
		const mdPath = (await pairFiles(fs)).md[0]!;
		const content = (await fs.read(mdPath))!;
		await fs.delete(mdPath);
		await fs.write('Renamed By User.md', content); // user rename, content (incl. pg3d_sourceId) intact
		const msgs: string[] = [];
		const store2 = newStore(fs, msgs);
		await store2.load();
		assert(store2.has('arxiv:1' as PaperSourceId), 'paper still paired by content sourceId after rename');
		assert(!msgs.some((m) => /no matching record/i.test(m)), 'not reported as an orphan note');
	});
	await check('EC-orphan-note', 'A note with no record is reported to the user, never silently deleted', async () => {
		const fs = new InMemoryFileStore();
		await fs.write('lonely.md', '---\npg3d_sourceId: "arxiv:999"\n---\n<!-- pg3d:begin -->\nx\n<!-- pg3d:end -->\n');
		const msgs: string[] = [];
		await newStore(fs, msgs).load();
		assert(msgs.some((m) => /no matching record/i.test(m)), 'orphan note reported');
		assert(await fs.exists('lonely.md'), 'orphan note NOT deleted');
	});
	await check('EC-orphan-record', 'A record with no note has its note rebuilt on load', async () => {
		const fs = new InMemoryFileStore();
		const store = newStore(fs, []);
		await store.upsert({ paper: paper('arxiv:1') });
		const mdPath = (await pairFiles(fs)).md[0]!;
		await fs.delete(mdPath); // note goes missing
		const store2 = newStore(fs, []);
		await store2.load();
		const md = (await pairFiles(fs)).md;
		assert(md.length === 1, 'note rebuilt from the authoritative record');
		assert(parseNote((await fs.read(md[0]!))!).frontmatter['pg3d_sourceId'] === 'arxiv:1', 'rebuilt note keyed correctly');
	});
	await check('EC-collision', 'Filename derivation is injective and strips illegal characters', () => {
		const a = sanitizeStem('arxiv:2401.12345');
		assert(!a.includes(':'), 'colon (illegal on Windows) is removed');
		const taken = new Set<string>([fileStem('arxiv:1' as PaperSourceId, new Set())]);
		const s1 = fileStem('arxiv:1' as PaperSourceId, taken); // its natural stem is taken -> disambiguate
		const s2 = fileStem('arxiv:2' as PaperSourceId, new Set());
		assert(s1 !== [...taken][0], 'a colliding stem is disambiguated');
		assert(fileStem('arxiv:1' as PaperSourceId, new Set()) !== s2, 'different sourceIds map to different stems');
	});
	await check('EC-interrupted-delete', 'An interrupted delete (tombstone present) is resumed and completed on load', async () => {
		const fs = new InMemoryFileStore();
		const store = newStore(fs, []);
		await store.upsert({ paper: paper('arxiv:1') });
		const stem = stemOf((await pairFiles(fs)).json[0]!);
		await fs.write(tombstoneName(stem), JSON.stringify({ stem, at: Date.now() })); // simulate interrupted delete
		const store2 = newStore(fs, []);
		await store2.load();
		const { json, md, tomb } = await pairFiles(fs);
		assert(json.length === 0 && md.length === 0 && tomb.length === 0, 'delete resumed: record, note, tombstone all gone');
		assert(store2.has('arxiv:1' as PaperSourceId) === false, 'not indexed after resumed delete');
	});

	// =================================================================
	// Success Criteria (structural / merge)
	// =================================================================
	await check('SC-005', 'After add/update/delete, zero record-without-note or note-without-record remain', async () => {
		const fs = new InMemoryFileStore();
		const store = newStore(fs, []);
		const consistent = async (): Promise<boolean> => {
			const files = await fs.list();
			const jsonStems = new Set(files.filter((f) => classify(f) === 'json').map(stemOf));
			const mdStems = new Set(files.filter((f) => classify(f) === 'md').map(stemOf));
			if (jsonStems.size !== mdStems.size) return false;
			for (const s of jsonStems) if (!mdStems.has(s)) return false;
			return true;
		};
		await store.upsert({ paper: paper('arxiv:1') });
		assert(await consistent(), 'consistent after create');
		await store.upsert({ paper: paper('arxiv:1', { citationCount: 9 }) });
		assert(await consistent(), 'consistent after update');
		await store.upsert({ paper: paper('arxiv:2') });
		await store.delete('arxiv:1' as PaperSourceId);
		assert(await consistent(), 'consistent after delete');
	});
	await check('SC-006-inmem', 'Load-time index build handles ~1,000 papers well under the 2s budget (in-memory)', async () => {
		const fs = new InMemoryFileStore();
		const seed = newStore(fs, []);
		for (let i = 0; i < 1000; i++) await seed.upsert({ paper: paper('arxiv:' + i) });
		const store = newStore(fs, []);
		const t0 = Date.now();
		await store.load();
		const ms = Date.now() - t0;
		assert(ms < 2000, `load took ${ms}ms (budget 2000ms)`);
		assert(store.has('arxiv:500' as PaperSourceId), 'all papers indexed');
	});
	await check('SC-007', 'Field-scoped merge preserves enriched wrapper fields and a non-null embedding on a pending update', async () => {
		const fs = new InMemoryFileStore();
		const store = newStore(fs, []);
		await store.upsert({ paper: paper('arxiv:1', { embedding: [0.1, 0.2], embeddingModel: 'm', embeddingSource: 'local' }), summary: 'S', futureDirections: 'F' });
		// A later citation-only update carries a pending (null) embedding and no summary.
		await store.upsert({ paper: paper('arxiv:1', { citationCount: 55, embedding: null, embeddingModel: null, embeddingSource: null }) });
		const jsonPath = (await pairFiles(fs)).json[0]!;
		const record = JSON.parse((await fs.read(jsonPath))!) as { summary?: string; futureDirections?: string; paper: Paper };
		assert(record.summary === 'S', 'summary preserved');
		assert(record.futureDirections === 'F', 'futureDirections preserved');
		assert(Array.isArray(record.paper.embedding) && record.paper.embedding[0] === 0.1, 'non-null embedding preserved against pending update');
		assert(record.paper.citationCount === 55, 'carried field (citationCount) still updated');
	});
	await check('SC-008', 'The record wrapper carries the embedding; the note carries none of it', async () => {
		const fs = new InMemoryFileStore();
		const store = newStore(fs, []);
		await store.upsert({ paper: paper('arxiv:1', { embedding: [0.123456, 0.654321], embeddingModel: 'local-hashtf-v1-d2048', embeddingSource: 'local' }) });
		const jsonPath = (await pairFiles(fs)).json[0]!;
		const record = JSON.parse((await fs.read(jsonPath))!) as { paper: Paper };
		assert(Array.isArray(record.paper.embedding) && record.paper.embeddingModel === 'local-hashtf-v1-d2048', 'embedding + model in record wrapper');
		const mdText = (await fs.read((await pairFiles(fs)).md[0]!))!;
		assert(!mdText.includes('0.123456') && !mdText.includes('embedding'), 'no embedding leaks into the note');
	});

	// =================================================================
	// SKIPs — real-Vault boundary and UI-thread/scale guarantees
	// =================================================================
	skip('US3.1-vault', 'The real Obsidian Vault adapter never touches a file outside the base folder', 'filestore-obsidian.ts enforces the boundary against a live Vault (needs Obsidian)');
	skip('SC-006-disk', 'The load scan meets the ≤2s / off-main-thread budget on a real vault of ~1,000 papers', 'Real disk I/O + Obsidian render-thread behavior (in-memory timing is covered by SC-006-inmem)');
	skip('OQ11-folder-change', 'Changing the storage folder leaves old pairings in place and notifies', 'onStorageFolderChanged needs a second real Vault FileStore + settings trigger (008)');

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
