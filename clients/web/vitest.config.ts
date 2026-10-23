import path from "node:path";
import { defineConfig } from "vitest/config";
import { optionalMediaModules } from "./scripts/optional-media-modules";

export default defineConfig({
	plugins: [optionalMediaModules()],
	resolve: {
		alias: {
			"@openmeld/agent-profile": path.resolve(
				import.meta.dirname,
				"../../packages/agent-profile/src/index.ts"
			),
			"@openmeld/agent-runtime": path.resolve(
				import.meta.dirname,
				"../../packages/agent-runtime/src/index.ts"
			),
			"cloudflare:workers": path.resolve(
				import.meta.dirname,
				"./src/test-support/cloudflare-workers.stub.ts"
			),
			"@openmeld/api-client": path.resolve(
				import.meta.dirname,
				"../../packages/api-client/src/index.ts"
			),
			"@openmeld/auth/client": path.resolve(
				import.meta.dirname,
				"../../packages/auth/src/client.ts"
			),
			"@openmeld/auth/server": path.resolve(
				import.meta.dirname,
				"../../packages/auth/src/server.ts"
			),
			"@openmeld/auth/organization-policy": path.resolve(
				import.meta.dirname,
				"../../packages/auth/src/organization-policy.ts"
			),
			"@openmeld/auth": path.resolve(
				import.meta.dirname,
				"../../packages/auth/src/index.ts"
			),
			"@openmeld/db/auth": path.resolve(
				import.meta.dirname,
				"../../packages/db/src/auth.ts"
			),
			"@openmeld/gateway-contract": path.resolve(
				import.meta.dirname,
				"../../packages/gateway-contract/src/index.ts"
			),
			"@openmeld/protocol": path.resolve(
				import.meta.dirname,
				"../../packages/protocol/src/index.ts"
			),
			"@openmeld/projects": path.resolve(
				import.meta.dirname,
				"../../packages/projects/src/index.ts"
			),
			"@openmeld/routine-schedule": path.resolve(
				import.meta.dirname,
				"../../packages/routine-schedule/src/index.ts"
			),
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
			"@openmeld/space": path.resolve(
				import.meta.dirname,
				"../../packages/space/src/index.ts"
			),
			"@openmeld/space-mesh": path.resolve(
				import.meta.dirname,
				"../../packages/space-mesh/src/index.ts"
			),
			"@openmeld/start/node-runtime": path.resolve(
				import.meta.dirname,
				"../../packages/start/src/setup-node-runtime.ts"
			),
			"@openmeld/start/testing": path.resolve(
				import.meta.dirname,
				"../../packages/start/src/testing/index.ts"
			),
			"@openmeld/start": path.resolve(
				import.meta.dirname,
				"../../packages/start/src/index.ts"
			),
			"@openmeld/utils": path.resolve(
				import.meta.dirname,
				"../../packages/utils/src/index.ts"
			),
		},
	},
	test: {
		// Vite declares the local lane explicitly; the test runner must too.
		env: { VITE_OPENMELD_SETUP_USER_FACING_COMMAND: "openmeld-dev" },
		environment: "jsdom",
		include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
		exclude: ["src/**/*.integration.test.{ts,tsx}"],
		passWithNoTests: true,
		pool: "threads",
		setupFiles: [
			"./src/test-support/dom-observers.setup.ts",
			"./src/test-support/reset-mocks.setup.ts",
		],
	},
});
