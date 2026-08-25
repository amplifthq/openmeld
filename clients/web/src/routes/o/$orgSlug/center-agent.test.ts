import { afterEach, describe, expect, it } from "vitest";
import { loadCenterAgentRouteContext } from "#/lib/organizations/center-agent-route-context";
import { serializeSidebarStateCookieValue } from "#/lib/sidebar-width-cookie";

describe("loadCenterAgentRouteContext", () => {
	afterEach(() => {
		// biome-ignore lint/suspicious/noDocumentCookie: test cleanup for the browser cookie set below.
		document.cookie = "openmeld_sidebar_inner=; Max-Age=0; Path=/";
		// biome-ignore lint/suspicious/noDocumentCookie: test cleanup for the browser cookie set below.
		document.cookie = "openmeld_sidebar_inner_center_agent=; Max-Age=0; Path=/";
		// biome-ignore lint/suspicious/noDocumentCookie: test cleanup for the browser cookie set below.
		document.cookie = "openmeld_sidebar_outer=; Max-Age=0; Path=/";
	});

	it("returns persisted sidebar geometry for pending and ready renders", async () => {
		const innerState = { tier: "compact" as const, width: "12.5rem" };
		const legacyInnerState = { tier: "full" as const, width: "14rem" };
		const outerState = { tier: "full" as const, width: "10.5rem" };
		// biome-ignore lint/suspicious/noDocumentCookie: test sets the browser cookie that the route reads.
		document.cookie = `openmeld_sidebar_inner=${encodeURIComponent(
			serializeSidebarStateCookieValue(legacyInnerState, "inner")
		)}; Path=/`;
		// biome-ignore lint/suspicious/noDocumentCookie: test sets the browser cookie that the route reads.
		document.cookie = `openmeld_sidebar_inner_center_agent=${encodeURIComponent(
			serializeSidebarStateCookieValue(innerState, "inner")
		)}; Path=/`;
		// biome-ignore lint/suspicious/noDocumentCookie: test sets the browser cookie that the route reads.
		document.cookie = `openmeld_sidebar_outer=${encodeURIComponent(
			serializeSidebarStateCookieValue(outerState, "outer")
		)}; Path=/`;

		await expect(loadCenterAgentRouteContext()).resolves.toEqual({
			initialOuterSidebarState: outerState,
		});
	});
});
