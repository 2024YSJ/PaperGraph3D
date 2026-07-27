import { ItemView, Menu, type WorkspaceLeaf } from 'obsidian';
import ForceGraph3D from '3d-force-graph';
import * as THREE from 'three';
import type { GraphData } from '../graph/types';
import {
	toForceGraphData,
	type AdapterOptions,
	type ForceGraphData,
	type ForceNode,
} from './adapter';

export const GRAPH_VIEW_TYPE = 'paper-graph-3d-view';

// Host-injected capabilities (the "guest" model): the view owns everything inside its
// container, but delegates host-specific actions (data access, opening notes, refresh,
// read-toggle, notices) to the plugin that mounts it.
export interface GraphViewDeps {
	getGraphData: () => Promise<GraphData>;
	openNote: (id: string) => void;
	refreshPaper: (id: string) => void;
	toggleRead: (id: string) => void;
	notify: (message: string) => void;
	adapterOptions?: AdapterOptions;
}

// Color priority: a node with NO SPECTER2 embedding (fallback position) is drawn RED
// so "not embedded yet" is unmistakable; otherwise uncited papers are orange, and
// normal (embedded + cited) papers are blue.
const COLOR_NOT_EMBEDDED = '#e03131'; // red: no SPECTER2 embedding (006 fallback position)
const COLOR_UNCITED = '#e8a33d'; // orange: uncited (but embedded)
const COLOR_NODE = '#4a90d9'; // blue: embedded + cited

export class GraphView extends ItemView {
	private readonly deps: GraphViewDeps;
	private graph: ReturnType<ReturnType<typeof ForceGraph3D>> | undefined;
	private graphHost!: HTMLElement;
	private hoverPanel!: HTMLElement;
	private emptyMessage!: HTMLElement;
	private yearMinInput!: HTMLInputElement;
	private yearMaxInput!: HTMLInputElement;
	private searchInput!: HTMLInputElement;
	private full: ForceGraphData = { nodes: [], links: [] };
	private hidden = new Set<string>();
	private resizeObserver?: ResizeObserver;
	private axisGroup?: any;

	constructor(leaf: WorkspaceLeaf, deps: GraphViewDeps) {
		super(leaf);
		this.deps = deps;
	}

	getViewType(): string {
		return GRAPH_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Paper graph (3D)';
	}

	getIcon(): string {
		return 'git-fork';
	}

	async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.style.position = 'relative';
		root.style.height = '100%';
		root.style.padding = '0';

		// The 3d-force-graph canvas host fills the view.
		this.graphHost = root.createDiv();
		Object.assign(this.graphHost.style, {
			position: 'absolute',
			inset: '0',
		});

		this.buildControls(root);
		this.buildHoverPanel(root);

		this.emptyMessage = root.createDiv({ text: 'No papers to show.' });
		Object.assign(this.emptyMessage.style, {
			position: 'absolute',
			inset: '0',
			display: 'none',
			alignItems: 'center',
			justifyContent: 'center',
			color: 'var(--text-muted)',
			fontSize: '15px',
			pointerEvents: 'none',
		});

		await this.reload();

		this.resizeObserver = new ResizeObserver(() => this.resizeGraph());
		this.resizeObserver.observe(this.graphHost);
	}

	async onClose(): Promise<void> {
		this.resizeObserver?.disconnect();
		this.resizeObserver = undefined;
		if (this.axisGroup !== undefined) {
			this.disposeGroup(this.axisGroup);
			this.axisGroup = undefined;
		}
		// Release the WebGL context / animation loop (constitution Principle II).
		const g = this.graph as unknown as { _destructor?: () => void } | undefined;
		g?._destructor?.();
		this.graph = undefined;
	}

	private buildControls(root: HTMLElement): void {
		const bar = root.createDiv();
		Object.assign(bar.style, {
			position: 'absolute',
			top: '8px',
			left: '8px',
			zIndex: '10',
			display: 'flex',
			gap: '6px',
			alignItems: 'center',
			background: 'var(--background-secondary)',
			padding: '6px 8px',
			borderRadius: '8px',
			opacity: '0.94',
		});

		bar.createSpan({ text: 'Year' });
		this.yearMinInput = bar.createEl('input', { type: 'number' });
		this.yearMinInput.style.width = '64px';
		this.yearMinInput.placeholder = 'min';
		this.yearMaxInput = bar.createEl('input', { type: 'number' });
		this.yearMaxInput.style.width = '64px';
		this.yearMaxInput.placeholder = 'max';
		const applyBtn = bar.createEl('button', { text: 'Filter' });
		this.registerDomEvent(applyBtn, 'click', () => this.applyFilter());

		this.searchInput = bar.createEl('input', { type: 'text' });
		this.searchInput.style.width = '160px';
		this.searchInput.placeholder = 'Search title…';
		const searchBtn = bar.createEl('button', { text: 'Go' });
		this.registerDomEvent(searchBtn, 'click', () => this.doSearch());
		this.registerDomEvent(this.searchInput, 'keydown', (e) => {
			if ((e as KeyboardEvent).key === 'Enter') this.doSearch();
		});

		const reloadBtn = bar.createEl('button', { text: 'Reload' });
		this.registerDomEvent(reloadBtn, 'click', () => void this.reload());
	}

	private buildHoverPanel(root: HTMLElement): void {
		this.hoverPanel = root.createDiv();
		Object.assign(this.hoverPanel.style, {
			position: 'absolute',
			top: '8px',
			right: '8px',
			zIndex: '10',
			maxWidth: '280px',
			display: 'none',
			background: 'var(--background-secondary)',
			padding: '10px 12px',
			borderRadius: '8px',
			fontSize: '12px',
			lineHeight: '1.5',
			pointerEvents: 'none',
			opacity: '0.96',
		});
	}

	private async reload(): Promise<void> {
		try {
			const data = await this.deps.getGraphData();
			this.hidden.clear();
			this.render(data);
		} catch (error) {
			this.deps.notify(
				`Graph load failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	private render(data: GraphData): void {
		this.full = toForceGraphData(data, this.deps.adapterOptions);

		if (this.full.nodes.length === 0) {
			this.emptyMessage.style.display = 'flex';
			this.graphHost.style.display = 'none';
			return;
		}
		this.emptyMessage.style.display = 'none';
		this.graphHost.style.display = 'block';

		if (this.graph === undefined) {
			this.graph = ForceGraph3D()(this.graphHost);
			this.graph
				.cooldownTicks(0) // coords are fixed (fx/fy/fz) — no simulation
				.backgroundColor('#101014')
				.nodeRelSize(4)
				.nodeVal((n: ForceNode) => Math.max(1, Math.log2(n.citationCount + 1) + 1))
				.nodeColor((n: ForceNode) =>
					n.positionSource === 'fallback'
						? COLOR_NOT_EMBEDDED
						: n.uncited
							? COLOR_UNCITED
							: COLOR_NODE,
				)
				.nodeLabel((n: ForceNode) => this.nodeLabelHtml(n))
				.nodeOpacity(0.9)
				.linkDirectionalArrowLength(4)
				.linkDirectionalArrowRelPos(1)
				.linkColor(() => '#8fb7ff')
				.linkOpacity(0.55)
				.linkWidth(1)
				.onNodeHover((n: ForceNode | null) => this.onHover(n))
				.onNodeClick((n: ForceNode) => this.deps.openNote(n.id))
				.onNodeRightClick((n: ForceNode, evt: MouseEvent) => this.showMenu(n, evt));
		}

		this.applyFilter();
		this.resizeGraph();
		// Frame the whole graph once it is populated.
		window.setTimeout(() => this.graph?.zoomToFit?.(500, 40), 60);
	}

	private applyFilter(): void {
		if (this.graph === undefined) return;
		const min = this.parseYear(this.yearMinInput.value);
		const max = this.parseYear(this.yearMaxInput.value);

		const nodes = this.full.nodes.filter(
			(n) =>
				!this.hidden.has(n.id) &&
				(min === undefined || n.publicationYear >= min) &&
				(max === undefined || n.publicationYear <= max),
		);
		const visible = new Set(nodes.map((n) => n.id));
		const links = this.full.links.filter(
			(l) => visible.has(this.endId(l.source)) && visible.has(this.endId(l.target)),
		);
		// Fresh copies — 3d-force-graph mutates link source/target into node refs.
		this.graph.graphData({
			nodes,
			links: links.map((l) => ({ source: this.endId(l.source), target: this.endId(l.target) })),
		});

		this.drawTimeAxis(nodes);
	}

	// Draw the z (time) axis: a line spanning the visible nodes' depth range, with date
	// tick labels, so the depth dimension reads as a timeline. Added directly to the
	// underlying ThreeJS scene (3d-force-graph exposes it via .scene()).
	private drawTimeAxis(nodes: ForceNode[]): void {
		const scene = this.graph?.scene?.() as any;
		if (scene === undefined || scene === null) return;

		if (this.axisGroup !== undefined) {
			scene.remove(this.axisGroup);
			this.disposeGroup(this.axisGroup);
			this.axisGroup = undefined;
		}
		if (nodes.length === 0) return;

		let minZ = Infinity;
		let maxZ = -Infinity;
		for (const n of nodes) {
			if (n.fz < minZ) minZ = n.fz;
			if (n.fz > maxZ) maxZ = n.fz;
		}
		if (!Number.isFinite(minZ) || !Number.isFinite(maxZ)) return;

		const group = new THREE.Group();
		// Extend the axis well past the node cloud so the timeline reads as a continuous
		// line, not just the span of current data. The cloud is recentered on the origin,
		// so the axis runs through its middle (0,0). A solid shaft (cylinder) + arrowhead
		// (cone) points from past → present (+z), giving direction without date labels.
		const range = maxZ - minZ;
		const ext = Math.max(140, range * 0.5);
		const z0 = minZ - ext;
		const z1 = maxZ + ext;
		const length = z1 - z0;
		const headLength = Math.min(48, length * 0.06);
		const shaftLength = length - headLength;
		const material = new THREE.MeshBasicMaterial({ color: 0x6b7078, transparent: true, opacity: 0.7 });

		// Shaft: a thin cylinder (real thickness — a plain line ignores linewidth on WebGL).
		const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, shaftLength, 8), material);
		shaft.rotation.x = Math.PI / 2; // cylinder's default +Y axis → +Z
		shaft.position.set(0, 0, z0 + shaftLength / 2);
		group.add(shaft);

		// Arrowhead at the present (+z) end.
		const head = new THREE.Mesh(new THREE.ConeGeometry(3, headLength, 14), material);
		head.rotation.x = Math.PI / 2; // cone tip → +Z
		head.position.set(0, 0, z0 + shaftLength + headLength / 2);
		group.add(head);

		scene.add(group);
		this.axisGroup = group;
	}

	private disposeGroup(group: any): void {
		group.traverse((obj: any) => {
			obj.geometry?.dispose?.();
			const material = obj.material;
			if (Array.isArray(material)) material.forEach((m: any) => m.dispose?.());
			else material?.dispose?.();
		});
	}

	private doSearch(): void {
		if (this.graph === undefined) return;
		const term = this.searchInput.value.trim().toLowerCase();
		if (term.length === 0) return;
		const hit = this.full.nodes.find(
			(n) => !this.hidden.has(n.id) && n.title.toLowerCase().includes(term),
		);
		if (hit === undefined) {
			this.deps.notify(`No paper matches "${this.searchInput.value}".`);
			return;
		}
		const distance = 120;
		this.graph.cameraPosition(
			{ x: hit.fx, y: hit.fy, z: hit.fz + distance },
			{ x: hit.fx, y: hit.fy, z: hit.fz },
			1200,
		);
	}

	private showMenu(node: ForceNode, evt: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((i) => i.setTitle('Open note').setIcon('file-text').onClick(() => this.deps.openNote(node.id)));
		menu.addItem((i) => i.setTitle('Refresh this paper').setIcon('refresh-cw').onClick(() => this.deps.refreshPaper(node.id)));
		menu.addItem((i) =>
			i.setTitle('Copy source link').setIcon('link').onClick(() => {
				void navigator.clipboard.writeText(node.id);
				this.deps.notify('Source id copied.');
			}),
		);
		menu.addItem((i) =>
			i.setTitle('Copy title').setIcon('text').onClick(() => {
				void navigator.clipboard.writeText(node.title);
				this.deps.notify('Title copied.');
			}),
		);
		menu.addItem((i) => i.setTitle('Toggle read/unread').setIcon('check').onClick(() => this.deps.toggleRead(node.id)));
		menu.addItem((i) =>
			i.setTitle('Remove from graph (hide)').setIcon('eye-off').onClick(() => {
				this.hidden.add(node.id);
				this.applyFilter();
			}),
		);
		menu.showAtMouseEvent(evt);
	}

	private onHover(node: ForceNode | null): void {
		if (node === null) {
			this.hoverPanel.style.display = 'none';
			return;
		}
		this.hoverPanel.empty();
		this.hoverPanel.createEl('div', { text: node.title }).style.fontWeight = '600';
		const meta = this.hoverPanel.createEl('div');
		meta.style.color = 'var(--text-muted)';
		meta.style.marginTop = '4px';
		const cites = node.citationsKnown
			? `${node.citationCount} citation(s)`
			: 'citations not yet enriched';
		meta.setText(
			`${node.publicationYear} · ${cites}${node.uncited ? ' · UNCITED' : ''}` +
				`${node.positionSource === 'fallback' ? ' · layout pending' : ''}`,
		);
		this.hoverPanel.style.display = 'block';
	}

	private nodeLabelHtml(n: ForceNode): string {
		return `${n.title} (${n.publicationYear})`;
	}

	private resizeGraph(): void {
		if (this.graph === undefined) return;
		const w = this.graphHost.clientWidth;
		const h = this.graphHost.clientHeight;
		if (w > 0 && h > 0) {
			this.graph.width(w).height(h);
		}
	}

	private parseYear(raw: string): number | undefined {
		const n = Number(raw);
		return raw.trim().length > 0 && Number.isFinite(n) ? n : undefined;
	}

	private endId(end: string | { id: string }): string {
		return typeof end === 'string' ? end : end.id;
	}
}
