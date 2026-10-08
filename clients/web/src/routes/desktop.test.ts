import { describe, expect, it } from "vitest";
import { Route } from "./desktop";

describe("legacy Desktop download entry", () => {
	it.each([
		"",
		"?platform=windows-x64",
		`?candidate=${"a".repeat(64)}&platform=macos-arm64`,
		"?candidate=invalid&candidate=invalid",
	])("redirects to the single website page without changing selectors: %s", (searchStr) => {
		const beforeLoad = Route.options.beforeLoad;
		if (!beforeLoad) {
			throw new Error("Download redirect is missing.");
		}
		try {
			beforeLoad({
				location: { pathname: "/desktop", searchStr, hash: "" },
			} as never);
			throw new Error("Expected a redirect.");
		} catch (error) {
			expect(error).toMatchObject({
				options: {
					href: `${import.meta.env.VITE_WEBSITE_URL}/downloads${searchStr}`,
				},
			});
		}
	});
});
