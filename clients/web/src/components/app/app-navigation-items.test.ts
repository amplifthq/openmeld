import { describe, expect, it } from "vitest";
import { resolveAppNavigationItems } from "./app-navigation-items";
import {
	appShellStaticData,
	resolveAppOuterRailDestinationFromMatches,
} from "./shell-layout";

describe("resolveAppNavigationItems", () => {
	it("labels the Organization workspace root as Desk", () => {
		const items = resolveAppNavigationItems({
			includeSpaces: true,
			orgSlug: "acme",
		});

		expect(items[0]).toEqual({
			label: "Desk",
			section: "home",
			to: "/o/acme",
		});
		expect(items.filter((item) => item.label === "Desk")).toHaveLength(1);
	});

	it("keeps Computers out of shared product navigation", () => {
		const items = resolveAppNavigationItems({
			includeSpaces: true,
			orgSlug: "acme",
		});

		expect(items.some((item) => item.label === "Computers")).toBe(false);
		expect(
			resolveAppOuterRailDestinationFromMatches([
				{ staticData: appShellStaticData.computers },
			])
		).toBe("people");
	});
});
