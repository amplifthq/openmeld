import { realpathSync } from "node:fs";
import path from "node:path";
import { normalizePath, type Plugin } from "vite";

/**
 * Optional media modules share the existing content-addressed URL boundary.
 * Native import keeps a media download failure out of critical-route recovery.
 */
export function optionalMediaModules(
	effectFile = path.resolve(
		import.meta.dirname,
		"../src/components/spaces/space-image-loading-effect.tsx"
	),
	videoFile = path.resolve(
		import.meta.dirname,
		"../src/components/spaces/space-video-playback.tsx"
	)
): Plugin {
	const modules = [
		{
			id: "virtual:openmeld-image-loading-effect",
			file: normalizePath(realpathSync(effectFile)),
			name: "space-image-loading-effect",
		},
		{
			id: "virtual:openmeld-video-playback",
			file: normalizePath(realpathSync(videoFile)),
			name: "space-video-playback",
		},
	];
	let building = false;
	const mediaReferences = new Set<string>();
	return {
		name: "openmeld-optional-media-modules",
		enforce: "pre",
		configResolved(config) {
			building = config.command === "build";
		},
		resolveId(source) {
			const module = modules.find(
				(item) => source === item.id || source === `\0${item.id}`
			);
			return module ? `\0${module.id}` : null;
		},
		load(id) {
			const module = modules.find((item) => id === `\0${item.id}`);
			if (!module) {
				return null;
			}
			if (this.environment.config.consumer === "server") {
				return "export default null;";
			}
			if (!building) {
				return `export default () => import(/* @vite-ignore */ ${JSON.stringify(`/@fs/${module.file}`)});`;
			}
			const reference = this.emitFile({
				type: "chunk",
				id: module.file,
				name: module.name,
				preserveSignature: "strict",
			});
			mediaReferences.add(reference);
			return `export default import.meta.ROLLUP_FILE_URL_${reference};`;
		},
		resolveFileUrl({ referenceId, relativePath }) {
			if (!mediaReferences.has(referenceId)) {
				return null;
			}
			// Generate the native loader after Vite's preload transform. Vite 8
			// wraps even @vite-ignore imports in global error recovery.
			// Bundler-owned relative paths also work with the Desktop URL scheme.
			return `(() => import(new URL(${JSON.stringify(relativePath)}, import.meta.url).href))`;
		},
		generateBundle: {
			order: "pre",
			handler(_options, bundle) {
				// Rolldown emits these URL-loaded modules as entries. They retain
				// their exports and files, but are not application bootstrap entries.
				// Classify only our media modules before Start captures its manifest.
				for (const output of Object.values(bundle)) {
					if (
						output.type === "chunk" &&
						modules.some((module) => output.facadeModuleId === module.file)
					) {
						output.isEntry = false;
					}
				}
			},
		},
	};
}
