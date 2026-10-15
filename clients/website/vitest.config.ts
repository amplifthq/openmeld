import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		tsconfigPaths: true,
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
	test: { environment: "jsdom", setupFiles: ["./src/test-support/setup.ts"] },
});

import path from "node:path";
