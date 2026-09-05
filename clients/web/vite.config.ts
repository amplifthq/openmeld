import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { resolveIsolatedWebDevSettings } from "./scripts/isolated-dev-config.ts";

const isolatedDev = resolveIsolatedWebDevSettings(process.env);

const config = defineConfig({
	define: {
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
		tanstackStart(),
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
});

export default config;
