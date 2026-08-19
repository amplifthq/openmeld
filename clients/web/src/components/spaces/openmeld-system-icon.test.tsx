import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OpenMeldSystemIcon } from "./openmeld-system-icon";

describe("OpenMeldSystemIcon", () => {
	afterEach(() => {
		cleanup();
	});

	it("renders a bounded static O mark instead of image or text artwork", () => {
		const { container } = render(<OpenMeldSystemIcon />);
		const icon = screen.getByTestId("openmeld-system-icon");

		expect(icon.tagName).toBe("svg");
		expect(icon.getAttribute("aria-hidden")).toBe("true");
		expect(icon.getAttribute("viewBox")).toBe("0 0 16 16");
		expect(icon.getAttribute("width")).toBe("16");
		expect(icon.getAttribute("height")).toBe("16");
		expect(icon.querySelector('path[fill="currentColor"]')).not.toBeNull();
		expect(container.querySelector("img")).toBeNull();
		expect(container.querySelector("pre")).toBeNull();
	});
});
