import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/editor-browser",
	testMatch: "**/*.spec.ts",
	fullyParallel: false,
	workers: 1,
	use: { baseURL: "http://127.0.0.1:5194", trace: "retain-on-failure" },
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
		{ name: "webkit", use: { ...devices["Desktop Safari"] } },
		{ name: "mobile-webkit", use: { ...devices["iPhone 13"] } },
	],
	webServer: {
		command:
			"pnpm exec vite --force --config tests/editor-browser/vite.config.ts",
		url: "http://127.0.0.1:5194",
		reuseExistingServer: false,
	},
});
