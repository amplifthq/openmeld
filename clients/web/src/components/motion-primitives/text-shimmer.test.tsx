import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TextShimmer } from "./text-shimmer";

vi.mock("motion/react", () => ({
	motion: {
		create: (component: string) => component,
	},
	useReducedMotion: () => true,
}));

describe("TextShimmer", () => {
	it("renders static legible text when reduced motion is requested", () => {
		render(<TextShimmer as="span">Checking activity</TextShimmer>);

		const text = screen.getByText("Checking activity");
		expect(text.className).toContain("text-muted-foreground");
		expect(text.className).not.toContain("text-transparent");
	});
});
