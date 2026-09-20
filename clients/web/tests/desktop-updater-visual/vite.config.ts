import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const webRoot = path.resolve(import.meta.dirname, "../..");
const platformFile = path.join(webRoot, "src/desktop/platform.ts");
const typescriptExtension = /\.ts$/;

// A separate test entry, not an application route or a production build flag.
export default defineConfig({
	root: import.meta.dirname,
	publicDir: path.join(webRoot, "public"),
	plugins: [
		{
			name: "synthetic-updater-boundary",
			enforce: "pre",
			resolveId(source, importer) {
				const resolved =
					importer && source.startsWith(".")
						? path
								.resolve(path.dirname(importer), source)
								.replace(typescriptExtension, "")
						: source;
				if (
					source === "#/desktop/platform" ||
					resolved === platformFile.replace(typescriptExtension, "")
				) {
					return path.join(import.meta.dirname, "bridge.ts");
				}
			},
		},
		react(),
		tailwindcss(),
	],
	resolve: { alias: { "#": path.join(webRoot, "src") } },
	define: {
		"import.meta.env.VITE_BETTER_AUTH_URL": JSON.stringify(
			"http://127.0.0.1:4176"
		),
		__OPENMELD_DESKTOP_PILOT__: "false",
		__OPENMELD_DESKTOP_WEB_BUILD__: JSON.stringify("synthetic-updater-visual"),
	},
	server: { host: "127.0.0.1", port: 4176, strictPort: true },
	build: {
		outDir: path.resolve(webRoot, "../../dev-tmp/pr1160-visual-build"),
		emptyOutDir: false,
	},
});
