import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { readInstalledDesktopTarget } from "../../scripts/desktop/installed-target";
// @ts-expect-error Build-only JavaScript helper.
import { desktopWebBuildIdentity } from "../../scripts/desktop/web-build-identity.mjs";
import { resolveCliBuildEnvironment } from "./scripts/cli-target-config";
import { desktopPilotBuildPrerequisites } from "./scripts/desktop-pilot-build";
import { resolveIsolatedWebDevSettings } from "./scripts/isolated-dev-config.ts";
import { optionalMediaModules } from "./scripts/optional-media-modules";

const isolatedDev = resolveIsolatedWebDevSettings(process.env);

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
			tsconfigPaths({ projects: ["./tsconfig.json"] }),
			tanstackStart({
				spa: {
					enabled: desktopRendererBuild,
					maskPath: "/desktop-shell",
				},
			}),
			viteReact({
				babel: {
					plugins: ["babel-plugin-react-compiler"],
				},
			}),
			tailwindcss(),
		],
		resolve: {
			alias: {
				"@openmeld/schemas/schemas": path.resolve(
					import.meta.dirname,
					"../../packages/schemas/src/schemas/index.ts"
				),
				"@openmeld/schemas/testing": path.resolve(
					import.meta.dirname,
					"../../packages/schemas/src/testing/space-members.ts"
				),
				"@openmeld/schemas/types": path.resolve(
					import.meta.dirname,
					"../../packages/schemas/src/types/index.ts"
				),
				"@openmeld/schemas": path.resolve(
					import.meta.dirname,
					"../../packages/schemas/src/index.ts"
				),
			},
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
