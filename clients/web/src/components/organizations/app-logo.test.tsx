import { GITHUB_PLUGIN } from "@openmeld/product-catalog/plugins";
import { AppLogo } from "@openmeld/ui/components/app-logo";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("AppLogo", () => {
	it("keeps the GitHub identity when the catalog order changes", () => {
		const { getByTestId } = render(<AppLogo app={GITHUB_PLUGIN} />);
		expect(getByTestId("app-logo-github").getAttribute("src")).toBe(
			"/app-logos/github.svg"
		);
	});
});
