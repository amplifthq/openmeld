import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import testConfig from "../../vitest.config";

// Standalone presentation harness: no Worker, account session, or API mutations.
export default defineConfig({
	root: import.meta.dirname,
	publicDir: path.resolve(import.meta.dirname, "../../public"),
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			...testConfig.resolve?.alias,
			"#": path.resolve(import.meta.dirname, "../../src"),
		},
	},
	server: { host: "127.0.0.1", port: 30_180, strictPort: true },
	build: {
		outDir: "../../../../dev-tmp/sidebar-preview-build",
		emptyOutDir: true,
	},
});
