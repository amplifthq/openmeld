import { describe, expect, it } from "vitest";
import {
	APP_PAGE_FRAME_CLASS_NAME,
	APP_PAGE_FRAME_PADDING_CLASS_NAME,
	APP_SPACE_FRAME_CLASS_NAME,
	appShellStaticData,
	resolveAppOuterRailDestinationFromMatches,
	resolveAppShellFrameClassName,
	resolveAppShellSectionFromMatches,
} from "./shell-layout";

describe("app shell layout", () => {
	it("uses the landing page frame width for non-space pages", () => {
		expect(resolveAppShellFrameClassName("start")).toBe(
			APP_PAGE_FRAME_CLASS_NAME
		);
		expect(resolveAppShellFrameClassName("connect")).toBe(
			APP_PAGE_FRAME_CLASS_NAME
		);
		expect(resolveAppShellFrameClassName("people")).toBe(
			APP_PAGE_FRAME_CLASS_NAME
		);
		expect(APP_PAGE_FRAME_CLASS_NAME).toBe("max-w-7xl");
		expect(APP_PAGE_FRAME_PADDING_CLASS_NAME).toBe("px-4 sm:px-6 lg:px-8");
	});

	it("keeps collaboration conversations on the workspace frame width", () => {
		expect(resolveAppShellFrameClassName("space")).toBe(
			APP_SPACE_FRAME_CLASS_NAME
		);
		expect(resolveAppShellFrameClassName("directMessages")).toBe(
			APP_SPACE_FRAME_CLASS_NAME
		);
		expect(APP_SPACE_FRAME_CLASS_NAME).toBe("max-w-[96rem]");
	});

	it("reads the deepest rendered app shell section from route static data", () => {
		expect(
			resolveAppShellSectionFromMatches([
				{ staticData: {} },
				{ staticData: appShellStaticData.start },
				{ staticData: appShellStaticData.space },
			])
		).toBe("space");
	});

	it.each([
		[appShellStaticData.newAgent, "newAgent"],
		[appShellStaticData.agentActivity, "agentActivity"],
		[appShellStaticData.agents, "agents"],
		[appShellStaticData.centerAgent, "directMessages"],
		[appShellStaticData.computers, "people"],
		[appShellStaticData.connect, "spaces"],
		[appShellStaticData.directMessages, "directMessages"],
		[appShellStaticData.home, "home"],
		[appShellStaticData.inbox, "inbox"],
		[appShellStaticData.organizations, null],
		[appShellStaticData.people, "people"],
		[appShellStaticData.plugins, "people"],
		[appShellStaticData.projects, "projects"],
		[appShellStaticData.settings, "settings"],
		[appShellStaticData.space, "spaces"],
	] as const)("maps %j route matches to the %s outer rail item", (staticData, expected) => {
		expect(
			resolveAppOuterRailDestinationFromMatches([
				{ staticData: appShellStaticData.start },
				{ staticData },
			])
		).toBe(expected);
	});

	it("fails fast when the rendered app route tree does not declare a shell section", () => {
		expect(() =>
			resolveAppShellSectionFromMatches([{ staticData: {} }])
		).toThrow(
			"AppShell requires an active route with staticData.appShellSection."
		);
	});
});
