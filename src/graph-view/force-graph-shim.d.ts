// The 3d-force-graph factory is used through a deliberately narrow surface here; this
// ambient declaration keeps `tsc --noEmit` (npm run build) green without depending on
// the package's own (heavily generic) type exports. The runtime import is unaffected.
declare module '3d-force-graph' {
	const ForceGraph3D: () => (element: HTMLElement) => any;
	export default ForceGraph3D;
}
