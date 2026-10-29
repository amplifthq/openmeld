import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	root: import.meta.dirname,
	publicDir: path.resolve(import.meta.dirname, "../../public"),
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			"@openmeld/schemas": path.resolve(
				import.meta.dirname,
				"../../../../packages/schemas/src/index.ts"
			),
		},
	},
	server: { host: "127.0.0.1", port: 30_184, strictPort: true },
	build: {
		outDir: path.resolve(
			import.meta.dirname,
			"../../../../dev-tmp/key-projects-build"
		),
		emptyOutDir: true,
	},
});
