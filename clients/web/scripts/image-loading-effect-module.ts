import path from "node:path";
import { normalizePath, type Plugin } from "vite";

const moduleId = "virtual:openmeld-image-loading-effect-url";
const resolvedId = `\0${moduleId}`;

/**
 * Give the optional decoration a bundled, content-addressed module URL. Native
 * import owns this one failure: Vite's critical-route preload recovery must not
 * reload the chat just because its decoration could not be downloaded.
 */
export function imageLoadingEffectModule(
	effectFile = path.resolve(
		import.meta.dirname,
		"../src/components/spaces/space-image-loading-effect.tsx"
	)
): Plugin {
	let building = false;
	return {
		name: "openmeld-image-loading-effect-module",
		configResolved(config) {
			building = config.command === "build";
		},
		resolveId(source) {
			return source === moduleId || source === resolvedId ? resolvedId : null;
		},
		load(id) {
			if (id !== resolvedId) {
				return null;
			}
			if (this.environment.config.consumer === "server") {
				return "export default null;";
			}
			if (!building) {
				return `export default ${JSON.stringify(`/@fs/${normalizePath(effectFile)}`)};`;
			}
			const reference = this.emitFile({
				type: "chunk",
				id: effectFile,
				name: "space-image-loading-effect",
				preserveSignature: "strict",
				// This decoration can only run after its requesting application chunk.
				// It is not a second application entry for Start's client manifest.
				implicitlyLoadedAfterOneOf: [resolvedId],
			});
			// Rollup owns hashes and relative URLs, including the Desktop scheme.
			return `export default import.meta.ROLLUP_FILE_URL_${reference};`;
		},
	};
}
