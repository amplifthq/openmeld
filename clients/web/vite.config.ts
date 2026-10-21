import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { readInstalledDesktopTarget } from "../../scripts/desktop/installed-target";
// @ts-expect-error Build-only JavaScript helper.
import { desktopWebBuildIdentity } from "../../scripts/desktop/web-build-identity.mjs";
// @ts-expect-error Shared build-only JavaScript helper.
import { prepareSharedPublicAssets } from "../../scripts/vite/shared-public-assets.mjs";
import { resolveCliBuildEnvironment } from "./scripts/cli-target-config";
import { desktopPilotBuildPrerequisites } from "./scripts/desktop-pilot-build";
import { resolveIsolatedWebDevSettings } from "./scripts/isolated-dev-config.ts";
import { optionalMediaModules } from "./scripts/optional-media-modules";

prepareSharedPublicAssets(import.meta.dirname);

const nodeModulesPathPattern = /\/node_modules\//;
const extendComponentsPathPattern = /\/src\/components\/extend\//;
const lucideIconsPackagePattern = /^lucide-react$/;
const phosphorIconsPackagePattern = /^@phosphor-icons\/react$/;
const streamdownMermaidChunkPattern = /^\.\/mermaid-[\w-]+\.js$/;
const isolatedDev = resolveIsolatedWebDevSettings(process.env);
const websiteOrigins: Record<string, string> = {
	prod: "https://openmeld.ai",
	stg: "https://staging.openmeld.ai",
};

const config = defineConfig(({ command, mode }) => {
	const installedTarget = readInstalledDesktopTarget(process.env);
	if (installedTarget) {
		Object.assign(process.env, {
			VITE_BETTER_AUTH_URL: installedTarget.webOrigin,
		});
	}
	const cliBuildEnvironment = resolveCliBuildEnvironment({
		...loadEnv(mode, import.meta.dirname, "VITE_"),
		...process.env,
	});
	const desktopPilotBuild =
		process.env.OPENMELD_DESKTOP_PILOT === "1" &&
		command === "build" &&
		process.env.CLOUDFLARE_ENV !== "prod";
	const desktopRendererBuild =
		command === "build" && (desktopPilotBuild || Boolean(installedTarget));
	const desktopWebBuild = desktopRendererBuild
		? desktopWebBuildIdentity(path.resolve(import.meta.dirname, "../.."))
		: "";
	const isolatedListener = isolatedDev
		? {
				host: new URL(isolatedDev.vars.WEB_APP_URL).hostname,
				port: isolatedDev.port,
				strictPort: true,
			}
		: undefined;
	if (command === "build") {
		execFileSync(
			process.execPath,
			[
				path.resolve(
					import.meta.dirname,
					"../../scripts/release/cli-skill.mjs"
				),
				"check",
			],
			{ stdio: "inherit" }
		);
	}
	return {
		define: {
			"import.meta.env.VITE_WEBSITE_URL": JSON.stringify(
				websiteOrigins[
					process.env.CLOUDFLARE_ENV ?? (installedTarget ? "prod" : "")
				] ??
					process.env.VITE_WEBSITE_URL ??
					"http://localhost:3500"
			),
			...Object.fromEntries(
				Object.entries(cliBuildEnvironment).map(([key, value]) => [
					`import.meta.env.${key}`,
					JSON.stringify(value),
				])
			),
			__OPENMELD_DESKTOP_WEB_BUILD__: JSON.stringify(desktopWebBuild),
			__OPENMELD_DESKTOP_PILOT__: JSON.stringify(desktopPilotBuild),
			__OPENMELD_WEB_BUILD__: JSON.stringify({
				id: randomUUID(),
				sha: execFileSync("git", ["rev-parse", "HEAD"], {
					encoding: "utf8",
				}).trim(),
				dirty:
					execFileSync("git", ["status", "--porcelain"], {
						encoding: "utf8",
					}).trim().length > 0,
			}),
		},
		// Keep browser diagnostics private. Full SSR maps exceed the current 4 GB
		// release build budget; server errors retain native Worker invocation logs.
		// Extend's document viewers split their worker bundles into ESM chunks.
		worker: { format: "es" },
		// Pre-bundling moves these entrypoints away from their sibling worker files.
		// Keep the package URLs intact so Vite can serve and bundle each worker.
		optimizeDeps: {
			exclude: [
				"@extend-ai/react-docx",
				"@extend-ai/react-pptx",
				"@extend-ai/react-xlsx",
			],
			// Keep the viewers' CommonJS dependencies pre-bundled separately.
			include: [
				"@extend-ai/react-docx > utif",
				"@extend-ai/react-docx > react-dom/server",
				"@extend-ai/react-pptx > react-dom/server",
				"@extend-ai/react-pptx > regl",
			],
		},
		environments: {
			client: {
				build: {
					sourcemap: "hidden",
					// Keep real source lines for local Electron DevTools breakpoints.
					...(desktopPilotBuild ? { minify: false } : {}),
				},
			},
		},
		plugins: [
			{
				name: "openmeld-client-only-heavy-modules",
				enforce: "pre",
				resolveId(source, importer) {
					if (
						this.environment.name === "ssr" &&
						[
							"#/components/extend/file-system",
							"#/components/extend/pdf-viewer",
							"#/components/extend/docx-viewer",
							"#/components/extend/pptx-viewer",
							"#/components/extend/xlsx-viewer",
						].includes(source)
					) {
						return "\0openmeld-client-only-extend-viewer";
					}
					if (
						this.environment.name === "ssr" &&
						streamdownMermaidChunkPattern.test(source) &&
						importer?.includes("/node_modules/streamdown/dist/")
					) {
						return "\0openmeld-client-only-streamdown-mermaid";
					}
				},
				load(id) {
					if (id === "\0openmeld-client-only-extend-viewer") {
						return "export const FileSystem = () => null; export const PDFViewer = () => null; export const DocxViewerPreview = () => null; export const PptxViewerPreview = () => null; export const XlsxViewerPreview = () => null;";
					}
					if (id === "\0openmeld-client-only-streamdown-mermaid") {
						return "export const Mermaid = () => null;";
					}
				},
			},
			optionalMediaModules(),
			desktopPilotBuildPrerequisites(
				desktopRendererBuild,
				installedTarget?.webOrigin
			),
			{
				name: "openmeld-desktop-build-identity",
				apply: "build",
				generateBundle() {
					if (desktopRendererBuild && this.environment.name === "client") {
						this.emitFile({
							type: "asset",
							fileName: "desktop-build.json",
							source: JSON.stringify({
								webBuild: desktopWebBuild,
								...(installedTarget ? { installedTarget } : {}),
							}),
						});
					}
				},
			},
			cloudflare({
				viteEnvironment: { name: "ssr" },
				...(process.env.OPENMELD_RELEASE_ARTIFACT_CHECK === "1"
					? { remoteBindings: false, persistState: false, inspectorPort: false }
					: {}),
				...(isolatedDev
					? {
							config(workerConfig) {
								return {
									name: `${workerConfig.name ?? "openmeld-web"}-${isolatedDev.laneId}`,
									vars: {
										...(workerConfig.vars ?? {}),
										...isolatedDev.vars,
									},
								};
							},
							inspectorPort: isolatedDev.inspectorPort,
							persistState: { path: isolatedDev.persistStatePath },
						}
					: {}),
			}),
			tanstackStart({
				spa: {
					enabled: desktopRendererBuild,
					maskPath: "/desktop-shell",
				},
			}),
			viteReact({
				exclude: [nodeModulesPathPattern, extendComponentsPathPattern],
				babel: {
					// Release builds compile the same memoized components that
					// development runs. Measured on the Rolldown production build: peak
					// V8 heap stays near 1 GiB with or without the compiler, well inside
					// the 4 GiB renderer heap budget; RSS grows by about 0.4 GiB.
					plugins: ["babel-plugin-react-compiler"],
				},
			}),
			tailwindcss(),
		],
		resolve: {
			tsconfigPaths: true,
			alias: [
				{
					find: lucideIconsPackagePattern,
					replacement: path.resolve(
						import.meta.dirname,
						"./src/lib/lucide-icons.ts"
					),
				},
				{
					find: phosphorIconsPackagePattern,
					replacement: path.resolve(
						import.meta.dirname,
						"./src/lib/phosphor-icons.ts"
					),
				},
				{
					find: "@openmeld/schemas/schemas",
					replacement: path.resolve(
						import.meta.dirname,
						"../../packages/schemas/src/schemas/index.ts"
					),
				},
				{
					find: "@openmeld/schemas/testing",
					replacement: path.resolve(
						import.meta.dirname,
						"../../packages/schemas/src/testing/space-members.ts"
					),
				},
				{
					find: "@openmeld/schemas/types",
					replacement: path.resolve(
						import.meta.dirname,
						"../../packages/schemas/src/types/index.ts"
					),
				},
				{
					find: "@openmeld/schemas",
					replacement: path.resolve(
						import.meta.dirname,
						"../../packages/schemas/src/index.ts"
					),
				},
			],
		},
		...(isolatedDev
			? {
					server: isolatedListener,
					// TanStack prerender requires a Vite resolvedUrls.local entry.
					// Only the listener uses loopback; lane URLs remain unchanged.
					preview: { ...isolatedListener, host: "127.0.0.1" },
				}
			: {}),
	};
});

export default config;
