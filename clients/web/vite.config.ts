import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
// @ts-expect-error Build-only JavaScript helper.
import { desktopWebBuildIdentity } from "../../scripts/desktop/web-build-identity.mjs";
import { resolveIsolatedWebDevSettings } from "./scripts/isolated-dev-config.ts";

const isolatedDev = resolveIsolatedWebDevSettings(process.env);

const config = defineConfig(({ command }) => {
	const desktopWebBuild = desktopWebBuildIdentity(
		path.resolve(import.meta.dirname, "../..")
	);
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
			__OPENMELD_DESKTOP_WEB_BUILD__: JSON.stringify(desktopWebBuild),
			__OPENMELD_DESKTOP_PILOT__: JSON.stringify(
				process.env.OPENMELD_DESKTOP_PILOT === "1" &&
					command === "build" &&
					process.env.CLOUDFLARE_ENV !== "prod"
			),
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
		environments: { client: { build: { sourcemap: "hidden" } } },
		plugins: [
			{
				name: "openmeld-desktop-build-identity",
				apply: "build",
				generateBundle() {
					if (
						process.env.OPENMELD_DESKTOP_PILOT === "1" &&
						this.environment.name === "client"
					) {
						this.emitFile({
							type: "asset",
							fileName: "desktop-build.json",
							source: JSON.stringify({ webBuild: desktopWebBuild }),
						});
					}
				},
			},
			cloudflare({
				viteEnvironment: { name: "ssr" },
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
					enabled: process.env.OPENMELD_DESKTOP_PILOT === "1",
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
					server: {
						host: new URL(isolatedDev.vars.WEB_APP_URL).hostname,
						port: isolatedDev.port,
						strictPort: true,
					},
				}
			: {}),
	};
});

export default config;
