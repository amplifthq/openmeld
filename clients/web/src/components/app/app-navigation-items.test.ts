import { describe, expect, it } from "vitest";
import { resolveAppNavigationItems } from "./app-navigation-items";

describe("resolveAppNavigationItems", () => {
	it("uses Home as the only primary Center Agent conversation entry", () => {
		const items = resolveAppNavigationItems({
			includeSpaces: true,
			orgSlug: "acme",
		});

		expect(items[0]).toEqual({
			label: "Home",
			section: "home",
			to: "/o/acme",
		});
		expect(items.some((item) => item.label === "Center Agent")).toBe(false);
	});
});
