// three ships its type declarations via an "exports" map that the project's classic
// `moduleResolution: node` does not read, so tsc sees `three` as untyped. This ambient
// declaration keeps `tsc --noEmit` (npm run build) green; the runtime import is the real
// three bundled by esbuild. The view uses only a narrow slice of the API.
declare module 'three';
