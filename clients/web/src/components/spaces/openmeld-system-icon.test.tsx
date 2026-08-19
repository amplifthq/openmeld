import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OpenMeldSystemIcon } from "./openmeld-system-icon";

describe("OpenMeldSystemIcon", () => {
	afterEach(() => {
		cleanup();
	});

	it("uses the bounded favicon artwork instead of the oversized text logo", () => {
		const { container } = render(<OpenMeldSystemIcon />);
		const icon = screen.getByTestId("openmeld-system-icon");

		expect(icon.getAttribute("src")).toBe("/favicon-32x32.png");
		expect(icon.getAttribute("width")).toBe("16");
		expect(icon.getAttribute("height")).toBe("16");
		expect(container.querySelector("pre")).toBeNull();
	});
});
