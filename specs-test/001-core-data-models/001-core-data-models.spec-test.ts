// Spec-test for 001-core-data-models — derived from specs/001-core-data-models/spec.md
// (acceptance scenarios, success criteria, edge cases) against the real exports in
// src/models/*. Report-only: no src/ changes. Convention: esbuild + node, no runner.

import {
	isValidSubscription,
	assignCheckInterval,
	ALLOWED_CHECK_INTERVALS_HOURS,
	DEFAULT_CHECK_INTERVAL_HOURS,
} from '../../src/models/subscription';
import {
	isValidPaper,
	toPaper,
	isPaperSourceId,
	type Paper,
	type PaperCandidate,
} from '../../src/models/paper';
import {
	isValidPluginSettings,
	DEFAULT_PLUGIN_SETTINGS,
} from '../../src/models/settings';

type Result = { id: string; desc: string; status: 'PASS' | 'FAIL' | 'SKIP'; note?: string };
const results: Result[] = [];

function assert(cond: unknown, msg: string): void {
	if (!cond) throw new Error(msg);
}
function check(id: string, desc: string, fn: () => void): void {
	try {
		fn();
		results.push({ id, desc, status: 'PASS' });
	} catch (err) {
		results.push({ id, desc, status: 'FAIL', note: err instanceof Error ? err.message : String(err) });
	}
}
function skip(id: string, desc: string, reason: string): void {
	results.push({ id, desc, status: 'SKIP', note: reason });
}

// ---- fixtures ----
const validSub = () => ({
	type: 'keyword' as const,
	value: 'machine learning',
	label: 'ML',
	checkIntervalHours: 24 as const,
	lastCheckedAt: null,
	enabled: true,
});
const validPaper = (): Paper => ({
	title: 'Attention is all you need',
	publicationYear: 2017,
	authors: ['Vaswani'],
	citationCount: 0,
	citationsKnown: true,
	abstract: 'A transformer architecture.',
	sourceId: 'arxiv:1706.03762',
	references: [],
	embedding: null,
	embeddingModel: null,
	embeddingSource: null,
});
const validCandidate = (): PaperCandidate => ({
	title: 'A paper',
	publicationYear: 2020,
	authors: ['A'],
	citationCount: 5,
	abstract: 'abstract',
	sourceId: 'arxiv:2001.00001',
	references: ['arxiv:1901.00001'],
	embedding: undefined,
	embeddingModel: undefined,
	embeddingSource: undefined,
});

// =====================================================================
// User Story 1 — subscription data shape
// =====================================================================
check('US1.1', 'A subscription with all 6 attrs + an allowed interval is valid (each type)', () => {
	for (const type of ['keyword', 'author', 'arxivCategory'] as const) {
		assert(isValidSubscription({ ...validSub(), type }), `type ${type} should be valid`);
	}
	for (const h of ALLOWED_CHECK_INTERVALS_HOURS) {
		assert(isValidSubscription({ ...validSub(), checkIntervalHours: h }), `interval ${h} should be valid`);
	}
	assert(isValidSubscription({ ...validSub(), lastCheckedAt: 1_700_000_000_000 }), 'numeric lastCheckedAt valid');
});
check('US1.2', 'A check interval outside {6,12,24,48,72} is rejected and the prior value kept', () => {
	assert(assignCheckInterval(24, 999) === 24, 'disallowed 999 keeps prior 24');
	assert(assignCheckInterval(24, 7) === 24, 'disallowed 7 keeps prior 24');
	assert(assignCheckInterval(24, 0) === 24, 'disallowed 0 keeps prior 24');
	assert(assignCheckInterval(48, 12) === 12, 'allowed 12 is applied');
	assert(assignCheckInterval(24, Number.NaN) === 24, 'NaN interval rejected');
	assert(!isValidSubscription({ ...validSub(), checkIntervalHours: 999 as unknown as 24 }), 'bad interval fails validator');
});
check('US1.3', 'A subscription missing (or wrong-typed on) any required attribute is invalid', () => {
	const fields = ['type', 'value', 'label', 'checkIntervalHours', 'lastCheckedAt', 'enabled'] as const;
	for (const f of fields) {
		const missing = { ...validSub() } as Record<string, unknown>;
		delete missing[f];
		assert(!isValidSubscription(missing), `missing ${f} should be invalid`);
	}
	assert(!isValidSubscription({ ...validSub(), type: 5 as unknown as 'keyword' }), 'numeric type invalid');
	assert(!isValidSubscription({ ...validSub(), type: 'podcast' as unknown as 'keyword' }), 'unknown type value invalid');
	assert(!isValidSubscription({ ...validSub(), value: 3 as unknown as string }), 'numeric value invalid');
	assert(!isValidSubscription({ ...validSub(), label: 3 as unknown as string }), 'numeric label invalid');
	assert(!isValidSubscription({ ...validSub(), checkIntervalHours: '24' as unknown as 24 }), 'string interval invalid');
	assert(!isValidSubscription({ ...validSub(), lastCheckedAt: 'now' as unknown as number }), 'string lastCheckedAt invalid');
	assert(!isValidSubscription({ ...validSub(), enabled: 'true' as unknown as boolean }), 'string enabled invalid');
});

// =====================================================================
// User Story 2 — paper data shape
// =====================================================================
check('US2.1', 'A paper with all required attributes + a known year is valid', () => {
	assert(isValidPaper(validPaper()), 'base valid paper should validate');
	assert(isValidPaper({ ...validPaper(), embedding: [0.1, 0.2], embeddingModel: 'm', embeddingSource: 'local' }), 'paper w/ real embedding valid');
});
check('US2.2', 'A paper with unknown/empty publication year is held back (not valid)', () => {
	const c = validCandidate();
	assert(toPaper({ ...c, publicationYear: undefined }) === undefined, 'undefined year held back');
	assert(!isValidPaper({ ...validPaper(), publicationYear: undefined as unknown as number }), 'undefined year invalid');
	assert(!isValidPaper({ ...validPaper(), publicationYear: null as unknown as number }), 'null year invalid');
	assert(!isValidPaper({ ...validPaper(), publicationYear: '' as unknown as number }), 'empty-string year invalid');
	assert(!isValidPaper({ ...validPaper(), publicationYear: 'abcd' as unknown as number }), 'non-numeric year invalid');
});
check('US2.3', 'A paper missing (or wrong-typed on) a required attribute is invalid', () => {
	const fields = ['title', 'publicationYear', 'authors', 'citationCount', 'abstract', 'sourceId', 'citationsKnown', 'references'] as const;
	for (const f of fields) {
		const missing = { ...validPaper() } as Record<string, unknown>;
		delete missing[f];
		assert(!isValidPaper(missing), `missing ${f} should be invalid`);
	}
	assert(!isValidPaper({ ...validPaper(), title: 1 as unknown as string }), 'numeric title invalid');
	assert(!isValidPaper({ ...validPaper(), abstract: 1 as unknown as string }), 'numeric abstract invalid');
	assert(!isValidPaper({ ...validPaper(), citationsKnown: 'yes' as unknown as boolean }), 'string citationsKnown invalid');
	assert(!isValidPaper({ ...validPaper(), authors: 'A' as unknown as string[] }), 'non-array authors invalid');
	assert(!isValidPaper({ ...validPaper(), authors: [1] as unknown as string[] }), 'authors with non-string element invalid');
	assert(!isValidPaper({ ...validPaper(), references: 'x' as unknown as Paper['references'] }), 'non-array references invalid');
	assert(!isValidPaper({ ...validPaper(), references: ['not-a-source-id'] as unknown as Paper['references'] }), 'references with invalid sourceId invalid');
	assert(!isValidPaper({ ...validPaper(), sourceId: 'nope' as unknown as Paper['sourceId'] }), 'bare sourceId invalid');
});

// =====================================================================
// User Story 3 — settings data shape
// =====================================================================
check('US3.1', 'Default settings carry all three groups and validate', () => {
	assert(isValidPluginSettings(DEFAULT_PLUGIN_SETTINGS), 'DEFAULT_PLUGIN_SETTINGS should validate');
	assert(typeof DEFAULT_PLUGIN_SETTINGS.storageLocation === 'string' && DEFAULT_PLUGIN_SETTINGS.storageLocation.length > 0, 'storageLocation present');
	assert(typeof DEFAULT_PLUGIN_SETTINGS.summarizationEnabled === 'boolean', 'summarizationEnabled present');
	assert(DEFAULT_PLUGIN_SETTINGS.graphDisplayOptions !== undefined, 'graphDisplayOptions present');
});
check('US3.2', 'Settings missing (or wrong-typed on) one of the three groups is invalid', () => {
	for (const f of ['storageLocation', 'summarizationEnabled', 'graphDisplayOptions'] as const) {
		const missing = { ...DEFAULT_PLUGIN_SETTINGS } as Record<string, unknown>;
		delete missing[f];
		assert(!isValidPluginSettings(missing), `missing ${f} invalid`);
	}
	assert(!isValidPluginSettings({ ...DEFAULT_PLUGIN_SETTINGS, storageLocation: '' }), 'empty storageLocation invalid');
	assert(!isValidPluginSettings({ ...DEFAULT_PLUGIN_SETTINGS, storageLocation: 5 as unknown as string }), 'numeric storageLocation invalid');
	assert(!isValidPluginSettings({ ...DEFAULT_PLUGIN_SETTINGS, summarizationEnabled: 'no' as unknown as boolean }), 'string summarizationEnabled invalid');
	assert(!isValidPluginSettings({ ...DEFAULT_PLUGIN_SETTINGS, graphDisplayOptions: { layout: 1 } as unknown as { layout: string; colorScheme: string } }), 'malformed graphDisplayOptions invalid');
});

// =====================================================================
// Edge cases
// =====================================================================
check('EC-1', 'Successful response with no year: candidate held back, not discarded (still usable)', () => {
	const c = { ...validCandidate(), publicationYear: undefined };
	assert(toPaper(c) === undefined, 'no year -> not promoted');
	assert(typeof c.title === 'string', 'candidate object is preserved for a later pass');
});
skip('EC-1-repass', 'Re-evaluation of a held-back candidate on the next scheduled check', 'Re-fetch/re-validate loop is owned by collection (002), not this layer');
check('EC-2', 'A non-finite year (NaN/Infinity) is treated like unknown — held back', () => {
	assert(toPaper({ ...validCandidate(), publicationYear: Number.NaN }) === undefined, 'NaN year held back');
	assert(toPaper({ ...validCandidate(), publicationYear: Number.POSITIVE_INFINITY }) === undefined, 'Infinity year held back');
	assert(!isValidPaper({ ...validPaper(), publicationYear: Number.NaN }), 'NaN year fails validator');
});
check('EC-3', 'A valid year with unconfirmed citations is still promoted (0 / [] / citationsKnown=false)', () => {
	const promoted = toPaper({ ...validCandidate(), citationCount: undefined, references: undefined });
	assert(promoted !== undefined, 'promoted despite unknown citations');
	assert(promoted!.citationCount === 0, 'citationCount defaults to 0');
	assert(Array.isArray(promoted!.references) && promoted!.references.length === 0, 'references default to []');
	assert(promoted!.citationsKnown === false, 'citationsKnown is false for unconfirmed');
});
check('EC-4', 'A check interval outside the list is rejected, previous value kept', () => {
	assert(assignCheckInterval(72, 100) === 72, 'disallowed keeps prior');
});
check('EC-5', 'A subscription type other than the three allowed is rejected', () => {
	assert(!isValidSubscription({ ...validSub(), type: 'video' as unknown as 'keyword' }), 'unknown type rejected');
});
check('EC-6', 'A default check interval (24h) exists and is itself an allowed interval', () => {
	assert(DEFAULT_CHECK_INTERVAL_HOURS === 24, 'default is 24');
	assert((ALLOWED_CHECK_INTERVALS_HOURS as readonly number[]).includes(DEFAULT_CHECK_INTERVAL_HOURS), 'default is an allowed value');
});
skip('EC-6-apply', 'A newly created subscription with no interval receives the default', 'Applying the default at registration is owned by the store (002 register)');
check('EC-7', 'First-run (unsaved) settings fall back to a full, valid default set', () => {
	assert(isValidPluginSettings(DEFAULT_PLUGIN_SETTINGS), 'defaults are a complete valid set');
});
skip('EC-7-load', 'On first run the plugin actually loads/uses these defaults', 'loadData/first-run wiring is owned by assembly (008)');

// =====================================================================
// Success Criteria
// =====================================================================
skip('SC-001', 'Every later feature can define its data needs by referencing only this spec', 'Cross-feature/process claim, not code-verifiable at this layer');
check('SC-002', '100% of subscriptions missing an attribute or using a bad interval are invalid', () => {
	for (const f of ['type', 'value', 'label', 'checkIntervalHours', 'lastCheckedAt', 'enabled'] as const) {
		const m = { ...validSub() } as Record<string, unknown>;
		delete m[f];
		assert(!isValidSubscription(m), `missing ${f} invalid`);
	}
	for (const bad of [5, 7, 0, 36, 96, -6, Number.NaN]) {
		assert(!isValidSubscription({ ...validSub(), checkIntervalHours: bad as unknown as 24 }), `interval ${String(bad)} invalid`);
	}
});
check('SC-003', '100% of malformed papers (no/non-finite year, bad citation, bad citationsKnown, missing attr) are invalid', () => {
	assert(!isValidPaper({ ...validPaper(), publicationYear: undefined as unknown as number }), 'no year invalid');
	assert(!isValidPaper({ ...validPaper(), publicationYear: Number.NaN }), 'NaN year invalid');
	assert(!isValidPaper({ ...validPaper(), publicationYear: Number.POSITIVE_INFINITY }), 'Infinity year invalid');
	assert(!isValidPaper({ ...validPaper(), citationCount: -1 }), 'negative citationCount invalid');
	assert(!isValidPaper({ ...validPaper(), citationCount: Number.NaN }), 'NaN citationCount invalid');
	assert(!isValidPaper({ ...validPaper(), citationCount: Number.POSITIVE_INFINITY }), 'Infinity citationCount invalid');
	assert(!isValidPaper({ ...validPaper(), citationsKnown: undefined as unknown as boolean }), 'missing citationsKnown invalid');
	assert(!isValidPaper({ ...validPaper(), citationsKnown: 1 as unknown as boolean }), 'non-boolean citationsKnown invalid');
	for (const f of ['title', 'authors', 'abstract', 'sourceId', 'references'] as const) {
		const m = { ...validPaper() } as Record<string, unknown>;
		delete m[f];
		assert(!isValidPaper(m), `missing ${f} invalid`);
	}
});
check('SC-004', '100% of newly loaded settings resolve to a complete default set (no missing group)', () => {
	assert(isValidPluginSettings(DEFAULT_PLUGIN_SETTINGS), 'defaults validate');
	assert('storageLocation' in DEFAULT_PLUGIN_SETTINGS && 'summarizationEnabled' in DEFAULT_PLUGIN_SETTINGS && 'graphDisplayOptions' in DEFAULT_PLUGIN_SETTINGS, 'all three groups present');
});
check('SC-005', 'A sourceId structurally encodes its provider so two providers can never collide', () => {
	assert(isPaperSourceId('arxiv:1706.03762'), 'arxiv id recognized');
	assert(isPaperSourceId('semanticScholar:abc'), 'semanticScholar id recognized');
	assert(!isPaperSourceId('1706.03762'), 'no-provider id rejected');
	assert(!isPaperSourceId('arxiv:'), 'empty local part rejected');
	assert(!isPaperSourceId(':x'), 'empty provider rejected');
	assert(!isPaperSourceId('unknown:1'), 'unrecognized provider rejected');
	assert(('arxiv:1' as string) !== ('semanticScholar:1' as string), 'provider prefix makes ids distinct');
});
skip('SC-005-dedup', 'Papers are actually deduplicated using the sourceId', 'Dedup execution is owned by collection/persistence (002/003)');
check('SC-006', '100% of promoted papers carry a citationsKnown that reflects whether citations were confirmed', () => {
	assert(toPaper({ ...validCandidate(), citationCount: 12 })!.citationsKnown === true, 'known count -> true');
	assert(toPaper({ ...validCandidate(), citationCount: 0 })!.citationsKnown === true, 'confirmed 0 -> true');
	assert(toPaper({ ...validCandidate(), citationCount: undefined })!.citationsKnown === false, 'unknown count -> false');
});
check('SC-007', 'Valid papers carry a content embedding + accurate embeddingModel/embeddingSource', () => {
	assert(isValidPaper({ ...validPaper(), embedding: null, embeddingModel: null, embeddingSource: null }), 'pending embedding valid');
	assert(isValidPaper({ ...validPaper(), embedding: [0.1, -0.2], embeddingModel: 'local-hashtf-v1-d2048', embeddingSource: 'local' }), 'real local embedding valid');
	assert(isValidPaper({ ...validPaper(), embedding: [0.1], embeddingModel: 'openai-x', embeddingSource: 'llm' }), 'llm source valid');
	assert(!isValidPaper({ ...validPaper(), embedding: [Number.NaN], embeddingModel: 'm', embeddingSource: 'local' }), 'non-finite vector element invalid');
	assert(!isValidPaper({ ...validPaper(), embedding: ['x'] as unknown as number[], embeddingModel: 'm', embeddingSource: 'local' }), 'non-number vector element invalid');
	assert(!isValidPaper({ ...validPaper(), embedding: [0.1], embeddingModel: 5 as unknown as string, embeddingSource: 'local' }), 'non-string embeddingModel invalid');
	assert(!isValidPaper({ ...validPaper(), embedding: [0.1], embeddingModel: 'm', embeddingSource: 'bogus' as unknown as 'local' }), 'unknown embeddingSource invalid');
});
skip('SC-007-projection', 'No two papers from different model spaces are ever projected together', 'Projection/space-homogeneity enforcement is owned by graph conversion (006)');

// ---- report ----
let p = 0, f = 0, s = 0;
for (const r of results) {
	if (r.status === 'PASS') { p++; console.log(`[PASS] ${r.id} — ${r.desc}`); }
	else if (r.status === 'FAIL') { f++; console.log(`[FAIL] ${r.id} — ${r.desc}: ${r.note}`); }
	else { s++; console.log(`[SKIP] ${r.id} — ${r.desc} (${r.note})`); }
}
console.log(`\nSummary: ${p} passed, ${f} failed, ${s} skipped`);
process.exitCode = f > 0 ? 1 : 0;
