import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	root: import.meta.dirname,
	plugins: [react()],
	server: { host: "127.0.0.1", port: 5194, strictPort: true },
	define: {
		"import.meta.env.VITE_OPENMELD_SETUP_USER_FACING_COMMAND":
			JSON.stringify("openmeld-dev"),
	},
	resolve: {
		tsconfigPaths: true,
		dedupe: ["react", "react-dom"],
		alias: {
			"#": path.resolve(import.meta.dirname, "../../src"),
			"@tanstack/react-start": path.resolve(
				import.meta.dirname,
				"server-boundary.ts"
			),
		},
	},
});
