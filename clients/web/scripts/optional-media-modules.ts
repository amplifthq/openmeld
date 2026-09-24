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
			id: "virtual:openmeld-image-loading-effect-url",
			file: effectFile,
			name: "space-image-loading-effect",
		},
		{
			id: "virtual:openmeld-video-playback-url",
			file: videoFile,
			name: "space-video-playback",
		},
	];
	let building = false;
	return {
		name: "openmeld-optional-media-modules",
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
				return `export default ${JSON.stringify(`/@fs/${normalizePath(module.file)}`)};`;
			}
			const reference = this.emitFile({
				type: "chunk",
				id: module.file,
				name: module.name,
				preserveSignature: "strict",
				// Media runs only after its requesting application chunk.
				// It is not a second application entry for Start's client manifest.
				implicitlyLoadedAfterOneOf: [id],
			});
			// Rollup owns hashes and relative URLs, including the Desktop scheme.
			return `export default import.meta.ROLLUP_FILE_URL_${reference};`;
		},
	};
}
