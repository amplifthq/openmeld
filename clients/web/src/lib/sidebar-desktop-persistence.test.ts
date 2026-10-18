import { afterEach, expect, it, vi } from "vitest";

const storage = window.localStorage;
afterEach(() => {
	storage.clear();
	vi.unstubAllGlobals();
	vi.resetModules();
});

it("restores Desktop choices after module memory is lost without relying on cookies", async () => {
	vi.stubGlobal("window", {
		location: { protocol: "openmeld-desktop:", host: "app" },
		localStorage: storage,
	});
	const cookieWrite = vi.spyOn(document, "cookie", "set");
	let preferences = await import("./sidebar-width-cookie");
	expect(
		preferences.readAppSidebarStatesFromClientCookie().outer.useRouteDefault
	).toBe(true);
	for (const tier of ["hidden", "expanded"] as const) {
		preferences.writeOuterSidebarStateCookie({
			tier,
			width: "320px",
			pageWidths: { spaces: "320px" },
		});
		preferences.writeInnerSidebarStateCookie("spaces", {
			tier: "expanded",
			width: "200px",
		});
		vi.resetModules();
		preferences = await import("./sidebar-width-cookie");
		const restored = await preferences.getAppSidebarStatesForRoute("spaces");
		expect(restored.outer).toEqual({
			tier,
			width: "320px",
			pageWidths: { spaces: "320px" },
		});
		expect(restored.inner.width).toBe("200px");
		expect(
			preferences.resolveClientSidebarInitialState(
				"outer",
				preferences.OUTER_SIDEBAR_DEFAULT_STATE
			)
		).toEqual(restored.outer);
	}
	expect(cookieWrite).not.toHaveBeenCalled();
	cookieWrite.mockRestore();
});

it("keeps automatic visibility when Desktop saves only collapsed groups", async () => {
	vi.stubGlobal("window", {
		location: { protocol: "openmeld-desktop:", host: "app" },
		localStorage: storage,
	});
	const preferences = await import("./sidebar-width-cookie");
	preferences.writeOuterSidebarStateCookie({
		...preferences.OUTER_SIDEBAR_DEFAULT_STATE,
		collapsedGroupIds: ["pinned"],
	});
	vi.resetModules();
	const fresh = await import("./sidebar-width-cookie");
	expect(fresh.readAppSidebarStatesFromClientCookie().outer).toEqual({
		...fresh.OUTER_SIDEBAR_DEFAULT_STATE,
		collapsedGroupIds: ["pinned"],
	});
});
