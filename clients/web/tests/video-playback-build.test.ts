// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import { expect, it } from "vitest";
import { optionalMediaModules } from "../scripts/optional-media-modules";

it("loads the real video adapter lazily and isolates missing media without suppressing critical failures", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "openmeld-video-module-"));
	const output = path.join(root, "dist");
	const player = path.join(root, "player.ts");
	const loader = path.resolve(
		import.meta.dirname,
		"../src/components/spaces/load-space-video-playback.ts"
	);
	try {
		await writeFile(
			player,
			"globalThis.playerLoaded = true; export function SpaceVideoPlayback() { return 'video'; }"
		);
		await writeFile(
			path.join(root, "critical.ts"),
			"throw new Error('Critical import failed'); export default 1;"
		);
		await writeFile(
			path.join(root, "entry.ts"),
			`export { loadSpaceVideoPlayback } from ${JSON.stringify(loader)}; export const critical = () => import('./critical');`
		);
		await build({
			configFile: false,
			root,
			publicDir: false,
			logLevel: "silent",
			plugins: [
				optionalMediaModules(undefined, player),
				{
					name: "assert-one-app-entry",
					generateBundle(_options, bundle) {
						expect(
							Object.values(bundle).filter(
								(item) => item.type === "chunk" && item.isEntry
							)
						).toHaveLength(1);
					},
				},
			],
			build: {
				outDir: output,
				target: "esnext",
				minify: false,
				rollupOptions: {
					preserveEntrySignatures: "strict",
					input: path.join(root, "entry.ts"),
					output: {
						entryFileNames: "entry.mjs",
						chunkFileNames: "[name]-[hash].mjs",
					},
				},
			},
		});
		const probe = `
      globalThis.window = new EventTarget();
      const errors = [];
      window.addEventListener('vite:preloadError', e => errors.push(e.payload));
      const { loadSpaceVideoPlayback, critical } = await import(${JSON.stringify(pathToFileURL(path.join(output, "entry.mjs")).href)});
      if (globalThis.playerLoaded) throw new Error('Player loaded eagerly');
      let result = null;
      try { result = (await loadSpaceVideoPlayback())(); } catch { /* Component renders Retry. */ }
      console.log(JSON.stringify({ result, errors: errors.length }));
      try { await critical(); } catch { /* Critical failures retain normal recovery. */ }
      console.log(JSON.stringify({ criticalErrors: errors.length }));
    `;
		const run = () =>
			execFileSync(process.execPath, ["--input-type=module", "-e", probe], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			});
		expect(run()).toContain('{"result":"video","errors":0}');
		const emitted = (await readdir(output)).find(
			(name) =>
				name.startsWith("space-video-playback-") && name.endsWith(".mjs")
		);
		if (!emitted) {
			throw new Error("No separately emitted video module.");
		}
		await rm(path.join(output, emitted));
		const failed = run();
		expect(failed).toContain('{"result":null,"errors":0}');
		expect(failed).toContain('{"criticalErrors":1}');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
