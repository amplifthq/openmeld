// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import { expect, it } from "vitest";
import { optionalMediaModules } from "../scripts/optional-media-modules";

const emittedImageEffectPattern = /^space-image-loading-effect-.*\.mjs$/;

it.each([
	"/",
	"./",
])("bundles an isolated lazy effect with base %s", async (base) => {
	const root = await mkdtemp(path.join(tmpdir(), "openmeld-image-effect-"));
	const loader = path.resolve(
		import.meta.dirname,
		"../src/components/spaces/load-space-image-effect.ts"
	);
	const effect = path.join(root, "effect.ts");
	const output = path.join(root, "dist");
	try {
		await writeFile(
			effect,
			"globalThis.effectLoaded = true; export default function effect() { return 'effect'; }"
		);
		await writeFile(
			path.join(root, "critical.ts"),
			"throw new TypeError('Failed to fetch dynamically imported module'); export default 1;"
		);
		await writeFile(
			path.join(root, "entry.ts"),
			`export { loadSpaceImageEffect } from ${JSON.stringify(loader)}; export const critical = () => import('./critical');`
		);
		await build({
			base,
			configFile: false,
			root,
			publicDir: false,
			logLevel: "silent",
			plugins: [
				optionalMediaModules(effect),
				{
					name: "assert-single-application-entry",
					generateBundle(_options, bundle) {
						const entries = Object.values(bundle).filter(
							(chunk) => chunk.type === "chunk" && chunk.isEntry
						);
						expect(entries).toHaveLength(1);
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
		const entryUrl = pathToFileURL(path.join(output, "entry.mjs")).href;
		const probe = `
      globalThis.window = new EventTarget();
      const errors = [];
      window.addEventListener('vite:preloadError', e => errors.push(e.payload));
      const { loadSpaceImageEffect, critical } = await import(${JSON.stringify(entryUrl)});
      if (globalThis.effectLoaded) throw new Error('Effect loaded eagerly');
      const module = await loadSpaceImageEffect();
      console.log(JSON.stringify({ result: module.default(), errors: errors.length }));
      try { await critical(); } catch { /* Expected critical import failure. */ }
      console.log(JSON.stringify({ criticalErrors: errors.length }));
    `;
		const run = () =>
			execFileSync(process.execPath, ["--input-type=module", "-e", probe], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			});
		expect(run()).toContain('{"result":"effect","errors":0}');
		const files = await readdir(output);
		const emittedEffect = files.find(
			(name) =>
				name.startsWith("space-image-loading-effect-") && name.endsWith(".mjs")
		);
		if (!emittedEffect) {
			throw new Error("Expected a separately emitted effect chunk.");
		}
		await rm(path.join(output, emittedEffect));
		const failed = run();
		expect(failed).toContain('{"result":null,"errors":0}');
		expect(failed).toContain('{"criticalErrors":1}');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

it("keeps the browser-only image effect out of server bundles", async () => {
	const root = await mkdtemp(
		path.join(tmpdir(), "openmeld-server-image-effect-")
	);
	const loader = path.resolve(
		import.meta.dirname,
		"../src/components/spaces/load-space-image-effect.ts"
	);
	const effect = path.join(root, "effect.ts");
	const output = path.join(root, "dist");
	try {
		await writeFile(
			effect,
			"export default function effect() { return 'effect'; }"
		);
		await writeFile(
			path.join(root, "server-entry.ts"),
			`import { loadSpaceImageEffect } from ${JSON.stringify(loader)}; export default async () => (await loadSpaceImageEffect()).default();`
		);
		await build({
			configFile: false,
			root,
			publicDir: false,
			logLevel: "silent",
			plugins: [optionalMediaModules(effect)],
			build: {
				ssr: path.join(root, "server-entry.ts"),
				outDir: output,
				target: "esnext",
				minify: false,
				rollupOptions: {
					output: {
						entryFileNames: "server-entry.mjs",
						chunkFileNames: "[name]-[hash].mjs",
					},
				},
			},
		});

		const serverEntry = await import(
			`${pathToFileURL(path.join(output, "server-entry.mjs")).href}?${Date.now()}`
		);
		expect(await serverEntry.default()).toBeNull();
		expect(await readdir(output)).not.toContainEqual(
			expect.stringMatching(emittedImageEffectPattern)
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
