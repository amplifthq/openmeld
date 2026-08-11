import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CenterTruncatedText } from "./center-truncated-text";

afterEach(() => {
	cleanup();
});

describe("CenterTruncatedText", () => {
	it("keeps short labels visually contiguous when no truncation is needed", () => {
		const { container } = render(<CenterTruncatedText text="Chat" />);
		const start = container.querySelector<HTMLElement>(
			'[data-slot="center-truncated-text-start"]'
		);
		const end = container.querySelector<HTMLElement>(
			'[data-slot="center-truncated-text-end"]'
		);

		expect(start?.textContent).toBe("Ch");
		expect(end?.textContent).toBe("at");
		expect(start?.className).toContain("min-w-0");
		expect(end?.className).toContain("min-w-0");
		expect(start?.className).not.toContain("min-w-[2ch]");
		expect(end?.className).not.toContain("min-w-[2ch]");
	});

	it("keeps boundary whitespace between the visible halves", () => {
		const { container } = render(<CenterTruncatedText text="Center Agent" />);
		const root = container.querySelector<HTMLElement>(
			'[data-slot="center-truncated-text"]'
		);
		const start = container.querySelector<HTMLElement>(
			'[data-slot="center-truncated-text-start"]'
		);
		const end = container.querySelector<HTMLElement>(
			'[data-slot="center-truncated-text-end"]'
		);

		expect(start?.textContent).toBe("Center ");
		expect(end?.textContent).toBe("Agent");
		expect(root?.textContent).toBe("Center Agent");
	});

	it("keeps punctuation in a suffix visually left to right", () => {
		const { container } = render(
			<CenterTruncatedText text="Privacy & Safety" />
		);
		const end = container.querySelector<HTMLElement>(
			'[data-slot="center-truncated-text-end"]'
		);
		const suffix = end?.querySelector<HTMLElement>("bdi");

		expect(end?.textContent).toBe("& Safety");
		expect(suffix?.dir).toBe("ltr");
	});
});
