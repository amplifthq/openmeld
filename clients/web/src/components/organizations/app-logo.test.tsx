import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppLogo } from "./app-logo";
import { GITHUB_PLUGIN } from "./plugin-catalog";

describe("AppLogo", () => {
	it("keeps the GitHub identity when the catalog order changes", () => {
		const { getByTestId } = render(<AppLogo app={GITHUB_PLUGIN} />);
		expect(getByTestId("app-logo-github").getAttribute("src")).toBe(
			"/app-logos/github.svg"
		);
	});
});
