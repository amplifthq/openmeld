import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import testConfig from "../../vitest.config";

// Isolated presentation harness. Only setup transport is simulated; it never
// contacts a Worker, creates an Agent, or touches a real computer connection.
export default defineConfig({
	root: import.meta.dirname,
	publicDir: path.resolve(import.meta.dirname, "../../public"),
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			"#/components/connect/bring-agents-setup-context": path.resolve(
				import.meta.dirname,
				"setup-mock.tsx"
			),
			"#/components/connect/start-bring-agents-setup-page": path.resolve(
				import.meta.dirname,
				"setup-mock.tsx"
			),
			...testConfig.resolve?.alias,
			"#": path.resolve(import.meta.dirname, "../../src"),
		},
	},
	server: { host: "127.0.0.1", port: 30_284, strictPort: true },
	build: {
		outDir: "../../../../dev-tmp/agent-creation-preview-build",
		emptyOutDir: true,
	},
});
