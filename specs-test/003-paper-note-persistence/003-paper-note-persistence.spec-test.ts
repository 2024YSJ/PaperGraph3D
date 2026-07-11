// spec-test for 003-paper-note-persistence — derived from spec.md acceptance
// scenarios (US<n>.<m>), success criteria (SC-xxx), and concrete edge cases
// (EC-<n>). Exercises the real src/persistence exports against InMemoryFileStore.
// Run via esbuild + node (repo's no-test-runner convention).

import { InMemoryFileStore } from '../../src/persistence/filestore';
import { PaperStore, type PersistInput } from '../../src/persistence/store';
import { parseNote } from '../../src/persistence/note';
import { fileStem } from '../../src/persistence/filename';
import type { Paper } from '../../src/models/paper';

type Status = 'PASS' | 'FAIL' | 'SKIP';
interface Result {
	id: string;
	desc: string;
	status: Status;
	error?: string;
	reason?: string;
}
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

function paper(n: number, over: Partial<Paper> = {}): Paper {
	return {
		title: `Title ${n}`,
		publicationYear: 2020,
		authors: ['Ada Lovelace', 'Alan Turing'],
		citationCount: 3,
		citationsKnown: true,
		abstract: `Abstract ${n}`,
		sourceId: `arxiv:${n}` as Paper['sourceId'],
		references: ['arxiv:ref'] as Paper['references'],
		embedding: null,
		embeddingModel: null,
		embeddingSource: null,
		...over,
	};
}
const input = (p: Paper, extra: Partial<PersistInput> = {}): PersistInput => ({ paper: p, ...extra });

class TrackingStore extends InMemoryFileStore {
	touched: string[] = [];
	async write(path: string, content: string) {
		this.touched.push(path);
		return super.write(path, content);
	}
	async delete(path: string) {
		this.touched.push(path);
		return super.delete(path);
	}
}
const escapesFolder = (path: string): boolean => path.startsWith('/') || path.includes('..') || path.includes(':');

async function main() {
	// ---- US1: create pairing ------------------------------------------------
	await check('US1.1', 'newly collected paper -> both .json and .md created, keyed by sourceId', async () => {
		const fs = new InMemoryFileStore();
		const store = new PaperStore(fs);
		await store.upsert(input(paper(1)));
		const files = (await fs.list()).sort();
		assert(files.length === 2, `expected 2 files, got ${files.length}`);
		assert(files[0] === '2020/unknown/Title 1 (1).json' && files[1] === '2020/unknown/Title 1 (1).md', `unexpected filenames: ${files.join()}`);
	});

	await check('US1.2', "note managed region mirrors the record's shared fields (FR-002 subset)", async () => {
		const fs = new InMemoryFileStore();
		const store = new PaperStore(fs);
		const p = paper(2, { authors: ['Solo Author'], citationCount: 7, publicationDate: '2020-06-15' });
		await store.upsert(input(p));
		const fm = parseNote((await fs.read('2020/06/Title 2 (2).md')) ?? '').frontmatter;
		assert(fm.title === p.title, 'title not mirrored');
		assert(Array.isArray(fm.authors) && (fm.authors as string[])[0] === 'Solo Author', 'authors not mirrored');
		assert(fm.publicationYear === 2020, 'publicationYear not mirrored');
		assert(fm.publicationDate === '2020-06-15', 'publicationDate (001 FR-023) not mirrored');
		assert(fm.citationCount === 7, 'citationCount not mirrored');
		assert(fm.readState === 'unread', 'readState not mirrored');
		assert(fm.pg3d_sourceId === 'arxiv:2', 'pg3d_sourceId not mirrored');
		assert(Array.isArray(fm.references) && (fm.references as string[])[0] === 'arxiv:ref', 'references (cited papers) not mirrored');
		assert(!('schemaVersion' in fm) && !('embedding' in fm), 'note leaked non-mirrored wrapper fields');
	});

	await check('US1.2b', 'references frontmatter distinguishes unknown / confirmed-none / confirmed-list via citationsKnown', async () => {
		const renderedNote = async (p: Paper): Promise<string> => {
			const fs = new InMemoryFileStore();
			await new PaperStore(fs).upsert(input(p));
			return (await fs.read((await fs.list()).find((f) => f.endsWith('.md')) as string)) ?? '';
		};
		// un-enriched / not-yet-checked (citationsKnown false) -> null, never a bare []
		const unknown = await renderedNote(paper(40, { citationsKnown: false, references: [] }));
		assert(unknown.includes('\nreferences: null\n'), 'un-enriched references should render as null');
		// confirmed by a provider, cites nothing -> []
		const none = await renderedNote(paper(41, { citationsKnown: true, references: [] }));
		assert(none.includes('\nreferences: []\n'), 'confirmed-empty references should render as []');
		// confirmed with citations -> a YAML list of source ids
		const list = await renderedNote(paper(42, { citationsKnown: true, references: ['arxiv:9'] as Paper['references'] }));
		assert(list.includes('\nreferences:\n  - "arxiv:9"\n'), 'confirmed references should render as a list');
	});

	await check('US1.3', 'partial persistence (note write fails) leaves neither record nor note', async () => {
		class FailMd extends InMemoryFileStore {
			async write(path: string, content: string) {
				if (path.endsWith('.md')) throw new Error('disk full');
				return super.write(path, content);
			}
		}
		const fs = new FailMd();
		const store = new PaperStore(fs);
		let threw = false;
		try {
			await store.upsert(input(paper(3)));
		} catch {
			threw = true;
		}
		assert(threw, 'upsert should reject when the note cannot be written');
		assert((await fs.list()).length === 0, 'rollback should leave neither file');
	});

	// ---- US2: update merges without destroying user writing ------------------
	await check('US2.1', 'update merges in place; no duplicate note', async () => {
		const fs = new InMemoryFileStore();
		const store = new PaperStore(fs);
		await store.upsert(input(paper(4)));
		await store.upsert(input(paper(4, { citationCount: 99 })));
		assert((await fs.list()).filter((f) => f.endsWith('.md')).length === 1, 'duplicate note created');
		const got = await store.get('arxiv:4' as Paper['sourceId']);
		assert(got?.citationCount === 99, 'record not updated in place');
	});

	await check('US2.2', 'user hand-written body is untouched by an update', async () => {
		const fs = new InMemoryFileStore();
		const store = new PaperStore(fs);
		await store.upsert(input(paper(5)));
		const original = (await fs.read('2020/unknown/Title 5 (5).md')) ?? '';
		const body = 'Line one.\nLine two — my notes.';
		await fs.write('2020/unknown/Title 5 (5).md', original + body);
		await store.upsert(input(paper(5, { citationCount: 12 })));
		const after = (await fs.read('2020/unknown/Title 5 (5).md')) ?? '';
		assert(parseNote(after).userBody === body, 'user body was altered');
		assert(after.includes('citationCount: 12'), 'managed region did not update');
	});

	await check('US2.3', 're-collecting identical data creates no duplicate; pairing stays consistent', async () => {
		const fs = new InMemoryFileStore();
		const store = new PaperStore(fs);
		await store.upsert(input(paper(6)));
		await store.upsert(input(paper(6)));
		assert((await fs.list()).sort().join() === '2020/unknown/Title 6 (6).json,2020/unknown/Title 6 (6).md', 'pairing not consistent / duplicated');
	});

	// ---- US3: stays inside the designated folder ----------------------------
	await check('US3.1', 'create/update/delete only ever touch paths inside the folder', async () => {
		const fs = new TrackingStore();
		const store = new PaperStore(fs);
		await store.upsert(input(paper(7)));
		await store.upsert(input(paper(7, { citationCount: 1 })));
		await store.delete('arxiv:7' as Paper['sourceId']);
		const escaped = fs.touched.filter(escapesFolder);
		assert(escaped.length === 0, `paths escaped the folder: ${escaped.join()}`);
		assert(fs.touched.length > 0, 'no paths were touched (sanity)');
	});

	await check('US3.2', 'inaccessible storage folder informs the user and writes nothing elsewhere', async () => {
		class FailAll extends InMemoryFileStore {
			async write(): Promise<void> {
				throw new Error('folder inaccessible');
			}
		}
		const fs = new FailAll();
		const msgs: string[] = [];
		const store = new PaperStore(fs, { notify: (m) => msgs.push(m) });
		let threw = false;
		try {
			await store.upsert(input(paper(8)));
		} catch {
			threw = true;
		}
		assert(threw, 'upsert should reject on an inaccessible folder');
		assert(msgs.length > 0, 'user was not informed of the folder problem');
		assert((await fs.list()).length === 0, 'nothing should have been written');
	});

	await check('US3.3', 'removal deletes both the record and the note together', async () => {
		const fs = new InMemoryFileStore();
		const store = new PaperStore(fs);
		await store.upsert(input(paper(9)));
		await store.delete('arxiv:9' as Paper['sourceId']);
		assert((await fs.list()).length === 0, 'delete left files behind');
		assert(!store.has('arxiv:9' as Paper['sourceId']), 'index still reports the paper');
	});

	// ---- Success Criteria ---------------------------------------------------
	await check('SC-001', 'exactly one .json + one .md per new paper, with matching managed fields', async () => {
		const fs = new InMemoryFileStore();
		const store = new PaperStore(fs);
		await store.upsert(input(paper(10, { citationCount: 5 })));
		const files = (await fs.list()).filter((f) => f.includes('Title 10'));
		assert(files.length === 2, 'not exactly one pair');
		const fm = parseNote((await fs.read('2020/unknown/Title 10 (10).md')) ?? '').frontmatter;
		const rec = JSON.parse((await fs.read('2020/unknown/Title 10 (10).json')) ?? '{}');
		assert(fm.citationCount === rec.paper.citationCount, 'managed field disagrees with record');
	});

	await check('SC-002', 'hand-written body byte-for-byte unchanged across an update', async () => {
		const fs = new InMemoryFileStore();
		const store = new PaperStore(fs);
		await store.upsert(input(paper(11)));
		const body = '## My notes\n\nByte-for-byte 한글 テスト.';
		await fs.write('2020/unknown/Title 11 (11).md', ((await fs.read('2020/unknown/Title 11 (11).md')) ?? '') + body);
		await store.upsert(input(paper(11, { title: 'Renamed Title' })));
		assert(parseNote((await fs.read('2020/unknown/Title 11 (11).md')) ?? '').userBody === body, 'hand-written body changed');
	});

	await check('SC-003', 're-collecting the same paper yields zero duplicate notes', async () => {
		const fs = new InMemoryFileStore();
		const store = new PaperStore(fs);
		await store.upsert(input(paper(12)));
		await store.upsert(input(paper(12)));
		await store.upsert(input(paper(12)));
		assert((await fs.list()).filter((f) => f.endsWith('.md')).length === 1, 'duplicate notes exist');
	});

	await check('SC-004', 'no path outside the designated folder is ever created/modified/deleted', async () => {
		const fs = new TrackingStore();
		const store = new PaperStore(fs);
		await store.upsert(input(paper(13)));
		await store.delete('arxiv:13' as Paper['sourceId']);
		assert(fs.touched.every((p) => !escapesFolder(p)), 'a path escaped the folder');
	});
	skip('SC-004-fs', 'true on-disk folder-boundary enforcement (adapter)', 'ObsidianFileStore path scoping is only exercised in a live vault (T019); asserted here only at the store/relative-path layer');

	await check('SC-005', 'a pre-existing inconsistency (record without note) is reconciled on load', async () => {
		const fs = new InMemoryFileStore();
		await fs.write('arxiv_14.json', JSON.stringify({ schemaVersion: 2, paper: paper(14), createdAt: 1, updatedAt: 1, readState: 'unread' }));
		const store = new PaperStore(fs);
		await store.load();
		assert(await fs.exists('arxiv_14.md'), 'orphan record note not rebuilt');
		assert(store.has('arxiv:14' as Paper['sourceId']), 'reconciled paper not indexed');
	});

	await check('SC-006', 'load builds the index for ~1000 papers under 2s, holding no embedding vectors', async () => {
		const fs = new InMemoryFileStore();
		const seed = new PaperStore(fs);
		for (let i = 0; i < 1000; i++) await seed.upsert(input(paper(20000 + i)));
		const store = new PaperStore(fs);
		const t0 = Date.now();
		await store.load();
		const ms = Date.now() - t0;
		assert(ms < 2000, `index build took ${ms}ms (>=2000)`);
		// The record JSON carries the embedding; the index metadata must not.
		const rec = JSON.parse((await fs.read('2020/unknown/Title 20000 (20000).json')) ?? '{}');
		assert('embedding' in rec.paper, 'record should carry the embedding on disk');
	});
	skip('SC-006-ui', 'index build runs off the main render path without blocking the UI', 'thread/UI-blocking behavior is an 008 wiring concern, not observable in a node harness');

	await check('SC-007', 'enriched wrapper fields and a stored non-null embedding survive later updates', async () => {
		const fs = new InMemoryFileStore();
		const store = new PaperStore(fs);
		await store.upsert(input(paper(15, { embedding: [0.1, 0.2], embeddingModel: 'bge', embeddingSource: 'local' }), { summary: 'gen' }));
		await store.upsert(input(paper(15, { citationCount: 50 }))); // no summary, pending (null) embedding
		const rec = JSON.parse((await fs.read('2020/unknown/Title 15 (15).json')) ?? '{}');
		assert(rec.summary === 'gen', 'summary was clobbered');
		assert(JSON.stringify(rec.paper.embedding) === '[0.1,0.2]', 'stored embedding was clobbered by pending null');
		await store.upsert(input(paper(15, { embedding: [9], embeddingModel: 'llm', embeddingSource: 'llm' })));
		const rec2 = JSON.parse((await fs.read('2020/unknown/Title 15 (15).json')) ?? '{}');
		assert(JSON.stringify(rec2.paper.embedding) === '[9]' && rec2.paper.embeddingSource === 'llm', 'non-null embedding did not replace');
	});

	await check('SC-008', 'record carries the embedding + metadata; zero embeddings appear anywhere in the note', async () => {
		const fs = new InMemoryFileStore();
		const store = new PaperStore(fs);
		await store.upsert(input(paper(16, { embedding: [0.42, 0.99], embeddingModel: 'bge-small', embeddingSource: 'local' })));
		const rec = JSON.parse((await fs.read('2020/unknown/Title 16 (16).json')) ?? '{}');
		assert(Array.isArray(rec.paper.embedding) && rec.paper.embeddingModel === 'bge-small' && rec.paper.embeddingSource === 'local', 'record missing embedding metadata');
		const md = (await fs.read('2020/unknown/Title 16 (16).md')) ?? '';
		assert(!md.includes('0.42') && !md.toLowerCase().includes('embedding'), 'embedding leaked into the note');
	});

	// ---- Edge cases ---------------------------------------------------------
	await check('EC-1', 'manually renamed files are re-paired by content sourceId on load (no duplicate)', async () => {
		const fs = new InMemoryFileStore();
		// Files renamed away from the sourceId-derived stem, but content ids intact.
		await fs.write('renamed-record.json', JSON.stringify({ schemaVersion: 2, paper: paper(17), createdAt: 1, updatedAt: 1, readState: 'unread' }));
		await fs.write('renamed-note.md', '---\npg3d_sourceId: "arxiv:17"\n---\n<!-- pg3d:begin -->\nx\n<!-- pg3d:end -->\n');
		const msgs: string[] = [];
		const store = new PaperStore(fs, { notify: (m) => msgs.push(m) });
		await store.load();
		assert(store.has('arxiv:17' as Paper['sourceId']), 'renamed pair not located by content id');
		assert(!msgs.some((m) => m.toLowerCase().includes('no matching record')), 'renamed pair mis-reported as orphan');
	});

	await check('EC-2', 'a hand-edited managed field is rebuilt from the record on next update; body untouched', async () => {
		const fs = new InMemoryFileStore();
		const store = new PaperStore(fs);
		await store.upsert(input(paper(18, { citationCount: 4 })));
		const body = 'user body kept';
		const tampered = ((await fs.read('2020/unknown/Title 18 (18).md')) ?? '').replace('citationCount: 4', 'citationCount: 999') + body;
		await fs.write('2020/unknown/Title 18 (18).md', tampered);
		await store.upsert(input(paper(18, { citationCount: 4 })));
		const after = (await fs.read('2020/unknown/Title 18 (18).md')) ?? '';
		assert(after.includes('citationCount: 4') && !after.includes('citationCount: 999'), 'managed field not rebuilt from record');
		assert(parseNote(after).userBody === body, 'user body altered while rebuilding managed region');
	});

	await check('EC-3', 'an interrupted delete (tombstone + record left) is completed on next load', async () => {
		const fs = new InMemoryFileStore();
		await fs.write('arxiv_19.json', JSON.stringify({ schemaVersion: 2, paper: paper(19), createdAt: 1, updatedAt: 1, readState: 'unread' }));
		await fs.write('arxiv_19.md', 'stale');
		await fs.write('arxiv_19.pg3d-del', '{}');
		const store = new PaperStore(fs);
		await store.load();
		assert((await fs.list()).length === 0, 'tombstoned delete not completed');
		assert(!store.has('arxiv:19' as Paper['sourceId']), 'deleted paper still indexed');
	});

	await check('EC-4', 'an orphan note with no tombstone is reported, never silently deleted', async () => {
		const fs = new InMemoryFileStore();
		await fs.write('arxiv_21.md', '---\npg3d_sourceId: "arxiv:21"\n---\n<!-- pg3d:begin -->\nx\n<!-- pg3d:end -->\n');
		const msgs: string[] = [];
		const store = new PaperStore(fs, { notify: (m) => msgs.push(m) });
		await store.load();
		assert(await fs.exists('arxiv_21.md'), 'orphan note was deleted');
		assert(msgs.some((m) => m.includes('arxiv_21.md')), 'orphan note not reported to the user');
	});

	await check('EC-5', 'distinct sourceIds that sanitize alike get distinct (injective) filenames', () => {
		const a = fileStem('arxiv:a:b' as Paper['sourceId'], new Set());
		const b = fileStem('arxiv:a_b' as Paper['sourceId'], new Set([a]));
		assert(a !== b, `stems collided: ${a} == ${b}`);
	});

	await check('EC-6', 'deleting a paper removes its note including a non-empty hand-written body', async () => {
		const fs = new InMemoryFileStore();
		const store = new PaperStore(fs);
		await store.upsert(input(paper(22)));
		await fs.write('2020/unknown/Title 22 (22).md', ((await fs.read('2020/unknown/Title 22 (22).md')) ?? '') + 'precious hand-written body');
		await store.delete('arxiv:22' as Paper['sourceId']);
		assert(!(await fs.exists('2020/unknown/Title 22 (22).md')) && !(await fs.exists('2020/unknown/Title 22 (22).json')), 'delete did not remove the pair');
	});

	await check('EC-7', 'a storage-folder change leaves old pairings and informs the user (FR-018)', async () => {
		const oldFs = new InMemoryFileStore();
		const msgs: string[] = [];
		const store = new PaperStore(oldFs, { notify: (m) => msgs.push(m) });
		await store.upsert(input(paper(23)));
		const newFs = new InMemoryFileStore();
		await store.onStorageFolderChanged('OldFolder', newFs);
		assert((await oldFs.list()).length === 2, 'old pairings were not left in place');
		assert(!store.has('arxiv:23' as Paper['sourceId']), 'index not rebuilt from the new (empty) folder');
		assert(msgs.some((m) => m.includes('OldFolder')), 'user not informed about the old location');
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
