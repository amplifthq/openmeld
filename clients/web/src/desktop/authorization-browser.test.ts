import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
	openExternal: vi.fn(() => Promise.resolve()),
	platform: vi.fn(() =>
		Promise.resolve({ webOrigin: "http://lane.localhost:31952" })
	),
}));

vi.mock("./platform", () => ({
	getDesktopPlatform: () => bridge,
}));

import {
	openAuthorizationBrowser,
	prepareAuthorizationBrowser,
} from "./authorization-browser";

describe("Desktop authorization browser", () => {
	beforeEach(() => {
		bridge.openExternal.mockClear();
		bridge.platform.mockClear();
	});

	it("does not fabricate a popup and opens the lane authorization URL natively", async () => {
		const open = vi.spyOn(window, "open");
		const browser = prepareAuthorizationBrowser("openmeld-test");
		expect(browser?.kind).toBe("desktop");
		expect(open).not.toHaveBeenCalled();

		if (!browser) {
			throw new Error("Expected Desktop authorization browser");
		}
		await openAuthorizationBrowser(
			browser,
			"/api/oauth/start?organizationId=org-1&state=opaque#provider"
		);

		expect(bridge.openExternal).toHaveBeenCalledWith(
			"http://lane.localhost:31952/api/oauth/start?organizationId=org-1&state=opaque#provider"
		);
	});
});
