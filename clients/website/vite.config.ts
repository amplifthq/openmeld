import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
// @ts-expect-error Shared build-only JavaScript helper.
import { prepareSharedPublicAssets } from "../../scripts/vite/shared-public-assets.mjs";

prepareSharedPublicAssets(import.meta.dirname);
const appOrigins: Record<string, string> = {
	prod: "https://app.openmeld.ai",
	stg: "https://app.staging.openmeld.ai",
};

export default defineConfig({
	define: {
		"import.meta.env.VITE_APP_URL": JSON.stringify(
			process.env.VITE_APP_URL ??
				appOrigins[process.env.CLOUDFLARE_ENV ?? ""] ??
				"http://localhost:3000"
		),
	},
	build: { assetsDir: "_website/assets" },
	resolve: {
		alias: {
			"@openmeld/schemas/schemas": path.resolve(
				import.meta.dirname,
				"../../packages/schemas/src/schemas/index.ts"
			),
			...Object.fromEntries(
				["schemas", "api-client", "gateway-contract", "protocol", "utils"].map(
					(name) => [
						`@openmeld/${name}`,
						path.resolve(
							import.meta.dirname,
							`../../packages/${name}/src/index.ts`
						),
					]
				)
			),
		},
	},
	plugins: [
		cloudflare({ viteEnvironment: { name: "ssr" }, inspectorPort: false }),
		tsconfigPaths(),
		tanstackStart({
			router: { routeFileIgnorePattern: "\\.(test|spec)\\." },
			client: { base: "/_website/build" },
			serverFns: { base: "/_website/serverFn" },
		}),
		react(),
		tailwindcss(),
	],
});
