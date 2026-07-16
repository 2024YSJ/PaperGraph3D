import { App, Modal, Notice, Setting } from 'obsidian';
import type { EmbeddingDiagnostics } from '../collection/localTransformer';

// Shows the measured embedding-runtime numbers. A modal rather than the developer
// console because the plugin guidelines forbid console logging (AGENTS.md), and a
// Notice cannot hold a readable table — and unlike console output, this can be copied
// out of a normal Obsidian window by a user who is reporting an environment.

function round(value: number): number {
	return Math.round(value * 10) / 10;
}

function copiedNotice(): string {
	return 'PaperGraph3D: 진단 결과를 복사했습니다.\nDiagnostics copied.';
}

/**
 * Shows a failure in full. The embedding runtime fails through several layers
 * (transformers.js -> onnxruntime -> the WASM glue's own dynamic import), and each
 * layer wraps the one below, so `error.message` alone routinely names the symptom
 * ("cannot read wasm") rather than the cause. Cause chain and stack are what make it
 * diagnosable, and a Notice cannot carry them.
 */
export class EmbeddingErrorModal extends Modal {
	private readonly error: unknown;
	private readonly context: string;

	constructor(app: App, error: unknown, context: string) {
		super(app);
		this.error = error;
		this.context = context;
	}

	private details(): string {
		const lines: string[] = [this.context, ''];
		let current: unknown = this.error;
		let depth = 0;
		while (current !== undefined && current !== null && depth < 5) {
			if (current instanceof Error) {
				lines.push(`${depth === 0 ? 'error' : `cause[${depth}]`}: ${current.name}: ${current.message}`);
				if (current.stack !== undefined) {
					lines.push(current.stack.split('\n').slice(1, 6).join('\n'));
				}
				current = (current as { cause?: unknown }).cause;
			} else {
				// A thrown non-Error is exactly the case where String() yields
				// '[object Object]' and hides the payload — which is the whole failure mode
				// this modal exists to avoid.
				let rendered: string;
				try {
					// JSON.stringify rather than String(): it renders a plain thrown object
					// instead of collapsing it, and returns undefined (not a lie) for the
					// values it cannot render, which the fallback then names.
					rendered = JSON.stringify(current) ?? Object.prototype.toString.call(current);
				} catch {
					rendered = Object.prototype.toString.call(current);
				}
				lines.push(`${depth === 0 ? 'error' : `cause[${depth}]`}: ${rendered}`);
				current = undefined;
			}
			depth += 1;
			lines.push('');
		}
		return lines.join('\n');
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Embedding runtime failed' });
		contentEl.createEl('pre', { text: this.details() });
		new Setting(contentEl).addButton((button) =>
			button
				.setButtonText('Copy')
				.setCta()
				.onClick(() => {
					void navigator.clipboard.writeText(this.details()).then(() => {
						new Notice(copiedNotice());
					});
				}),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class EmbeddingDiagnosticsModal extends Modal {
	private readonly diagnostics: EmbeddingDiagnostics;

	constructor(app: App, diagnostics: EmbeddingDiagnostics) {
		super(app);
		this.diagnostics = diagnostics;
	}

	private summary(): string {
		const d = this.diagnostics;
		const mean = d.perPaperMs.reduce((a, b) => a + b, 0) / d.perPaperMs.length;
		const lines = [
			`crossOriginIsolated : ${d.crossOriginIsolated}`,
			`numThreads          : ${d.numThreads ?? '(unset)'}`,
			`wasmPaths           : ${d.wasmPaths}`,
			`wasmBinary          : ${d.wasmBinaryBytes === undefined ? '(none!)' : `${(d.wasmBinaryBytes / 1048576).toFixed(1)} MB`}`,
			'',
			`init                : ${round(d.initMs)} ms`,
			`per paper           : ${d.perPaperMs.map(round).join(' / ')} ms`,
			`mean                : ${round(mean)} ms`,
			`1,000 papers        : ${round((mean * 1000) / 60000)} min`,
			'',
			`dimension           : ${d.dimension}  (expected 768)`,
			`related cosine      : ${d.relatedCosine.toFixed(4)}  (Python ref 0.9331)`,
			`unrelated cosine    : ${d.unrelatedCosine.toFixed(4)}  (Python ref 0.8874)`,
		];
		return lines.join('\n');
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Embedding runtime diagnostics' });

		const d = this.diagnostics;
		// The cosines are the only pass/fail here: they say whether this runtime
		// reproduces the model's intended use. Fast but wrong numbers are worse than slow
		// ones, so the verdict goes above the timings rather than below them.
		const correct =
			d.dimension === 768 &&
			Math.abs(d.relatedCosine - 0.9331) < 0.02 &&
			Math.abs(d.unrelatedCosine - 0.8874) < 0.02;
		contentEl.createEl('p', {
			text: correct
				? '벡터가 파이썬 기준과 일치합니다 — 런타임이 정상입니다. / Vectors match the Python reference: the runtime is correct.'
				: '벡터가 파이썬 기준과 다릅니다 — 토크나이징이나 풀링이 어긋났을 수 있습니다. / Vectors diverge from the Python reference: tokenization or pooling may be wrong.',
		});

		contentEl.createEl('pre', { text: this.summary() });

		new Setting(contentEl).addButton((button) =>
			button
				.setButtonText('Copy')
				.setCta()
				.onClick(() => {
					void navigator.clipboard.writeText(this.summary()).then(() => {
						new Notice(copiedNotice());
					});
				}),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
