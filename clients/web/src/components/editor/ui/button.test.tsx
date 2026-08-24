// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";

describe("Editor Button", () => {
	it("provides a mobile touch target without changing desktop button sizes", () => {
		render(<Button size="icon-xs">Open</Button>);

		const button = screen.getByRole("button", { name: "Open" });
		expect(button.className).toContain("size-6");
		expect(button.className).toContain("max-lg:min-h-11");
		expect(button.className).toContain("max-lg:min-w-11");
	});
});
