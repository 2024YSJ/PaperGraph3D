import type { SummarizationInput, SummaryResult } from '../../collection/pipeline';
import { runGeneration } from './generate';
import { isUncited } from './isUncited';
import type { SummarizationProvider } from './types';

// FR-008a: a rate-limit Notice fires at most once per this window, so a whole batch
// hitting the quota surfaces one nudge, not one per paper (the abstract fallback
// still applies to every paper). Mirrors the per-load unconfigured Notice in main.ts.
const RATE_LIMIT_NOTICE_THROTTLE_MS = 5 * 60 * 1000;

// The exact shape PipelineHooks['summarize'] requires (data-model.md §1) —
// main.ts wires pipelineHooks.summarize = createSummarizeHook({...}) with no
// adapter of its own (contracts/summarization-api.md § hook.ts).
export interface SummarizeHookConfig {
	getProvider: () => SummarizationProvider | undefined; // undefined = not configured
	getCredential: () => string | undefined;
	notifyCredentialProblem: (message: string) => void; // FR-008
	// FR-008a: 429 quota/rate-limit reached. Optional — an unwired caller degrades to
	// the same silent abstract fallback as before; main.ts always wires it.
	notifyRateLimited?: (message: string) => void;
}

export function createSummarizeHook(
	config: SummarizeHookConfig,
): (input: SummarizationInput) => Promise<SummaryResult | undefined> {
	// Per-hook throttle state — one hook instance is created per plugin load.
	let lastRateLimitNoticeAt = 0;
	return async (input: SummarizationInput): Promise<SummaryResult | undefined> => {
		const provider = config.getProvider();
		if (provider === undefined) {
			return undefined;
		}

		const credential = config.getCredential();
		if (credential === undefined || credential.trim().length === 0) {
			return undefined;
		}

		// isUncited() gating owned here, not generate.ts (research.md §9,
		// contracts/summarization-api.md § hook.ts) — a future-directions call is
		// only attempted for a CONFIRMED-uncited paper.
		const wantFutureDirections = isUncited(input);

		const outcome = await runGeneration(input, provider, credential, wantFutureDirections);

		if (!outcome.ok) {
			if (outcome.reason === 'invalid-credentials') {
				config.notifyCredentialProblem(
					`Summarization credential was rejected (provider: ${provider.id}). ` +
						'Check the configured credential in settings.',
				);
			} else if (outcome.reason === 'rate-limited' && config.notifyRateLimited !== undefined) {
				// FR-008a: surface the quota/rate-limit at most once per throttle window
				// so a batch that all rate-limits never spams one Notice per paper. The
				// paper still falls back to its abstract, so persistence is never blocked.
				const now = Date.now();
				if (now - lastRateLimitNoticeAt >= RATE_LIMIT_NOTICE_THROTTLE_MS) {
					lastRateLimitNoticeAt = now;
					config.notifyRateLimited(
						`Summarization API rate limit or quota reached (provider: ${provider.id}). ` +
							'Papers are saved with the original abstract for now — try again later. ' +
							`요약 API 한도에 도달했습니다 (제공자: ${provider.id}). ` +
							'논문은 원문 초록으로 저장되며, 잠시 후 다시 시도하세요.',
					);
				}
			}
			// Every other failure reason (timeout, provider-error, empty-or-too-short)
			// is a silent abstract-fallback — never blocks note creation (FR-007/FR-012).
			return undefined;
		}

		return {
			summary: outcome.summary,
			// Not uncited -> '' (the 003 "not applicable" sentinel, research.md §2) —
			// no future-directions call was even attempted in that case, and
			// runGeneration() already degrades a requested-but-failed one to ''.
			futureDirections: outcome.futureDirections,
		};
	};
}
