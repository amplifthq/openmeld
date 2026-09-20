import assert from "node:assert/strict";
import test from "node:test";

import { resolveIsolatedWebDevSettings } from "./isolated-dev-config.ts";

const MISSING_WEB_PORT_RE = /OPENMELD_DEV_WEB_PORT/u;

test("maps the shared isolated lane into Vite and Worker settings", () => {
	assert.deepEqual(
		resolveIsolatedWebDevSettings({
			BETTER_AUTH_URL: "http://localhost:31002",
			VITE_BETTER_AUTH_URL: "http://localhost:31002",
			VITE_OPENMELD_HOME: "/repo/.turbo/dev/isolated/wt-example/home",
			VITE_OPENMELD_SETUP_USER_FACING_COMMAND: "openmeld-dev",
			VITE_OPENMELD_CLI_BINARY_MANIFEST_URL:
				"http://127.0.0.1:31004/cli/manifest.json",
			OPENMELD_CLI_BINARY_MANIFEST_URL:
				"http://127.0.0.1:31004/cli/manifest.json",
			OPENMELD_DEV_ISOLATED: "1",
			OPENMELD_DEV_LANE_ID: "wt-example",
			OPENMELD_DEV_WEB_INSPECTOR_PORT: "31008",
			OPENMELD_DEV_WEB_PORT: "31000",
			OPENMELD_DEV_WRANGLER_STATE_DIR:
				"/repo/.wrangler-dev-state/isolated/wt-example",
			OPENMELD_GATEWAY_URL: "http://localhost:31001",
			WEB_APP_URL: "http://localhost:31000",
		}),
		{
			inspectorPort: 31_008,
			laneId: "wt-example",
			persistStatePath: "/repo/.wrangler-dev-state/isolated/wt-example/web",
			port: 31_000,
			vars: {
				VITE_OPENMELD_SETUP_USER_FACING_COMMAND: "openmeld-dev",
				VITE_OPENMELD_DEV_LANE_ID: "wt-example",
				VITE_OPENMELD_GATEWAY_URL: "http://localhost:31001",
				VITE_OPENMELD_WEB_URL: "http://localhost:31000",
				VITE_OPENMELD_CLI_BINARY_MANIFEST_URL:
					"http://127.0.0.1:31004/cli/manifest.json",
				OPENMELD_CLI_BINARY_MANIFEST_URL:
					"http://127.0.0.1:31004/cli/manifest.json",
				BETTER_AUTH_URL: "http://localhost:31002",
				VITE_BETTER_AUTH_URL: "http://localhost:31002",
				VITE_OPENMELD_HOME: "/repo/.turbo/dev/isolated/wt-example/home",
				OPENMELD_GATEWAY_URL: "http://localhost:31001",
				WEB_APP_URL: "http://localhost:31000",
			},
		}
	);
});

test("leaves the standard Web dev configuration unchanged", () => {
	assert.equal(resolveIsolatedWebDevSettings({}), null);
});

test("fails fast when an isolated Web port is missing", () => {
	assert.throws(
		() =>
			resolveIsolatedWebDevSettings({
				OPENMELD_DEV_WRANGLER_STATE_DIR: "/repo/isolated",
				OPENMELD_DEV_ISOLATED: "1",
				OPENMELD_DEV_LANE_ID: "wt-example",
				OPENMELD_DEV_WEB_INSPECTOR_PORT: "31008",
			}),
		MISSING_WEB_PORT_RE
	);
});
