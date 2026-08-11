import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SpaceMessageProgressRow } from "./space-message-progress-row";

afterEach(cleanup);

describe("SpaceMessageProgressRow", () => {
	it("keeps Stop beside the status in one fixed control slot", () => {
		const view = render(
			<SpaceMessageProgressRow slot="test-progress">
				<span>Sending to Agent…</span>
			</SpaceMessageProgressRow>
		);

		const controlSlot = screen.getByTestId(
			"space-message-progress-control-slot"
		);
		const progressContent = controlSlot.previousElementSibling;

		expect(controlSlot.className).toContain("w-20");
		expect(controlSlot.className).toContain("justify-start");
		expect(controlSlot.className).not.toContain("ml-auto");
		expect(controlSlot.childElementCount).toBe(0);
		expect(progressContent?.getAttribute("data-slot")).toBe(
			"space-message-progress-content"
		);
		expect(progressContent?.className).not.toContain("flex-1");

		view.rerender(
			<SpaceMessageProgressRow
				control={<button type="button">Stop</button>}
				slot="test-progress"
			>
				<span>Agent is working</span>
			</SpaceMessageProgressRow>
		);

		expect(screen.getByTestId("space-message-progress-control-slot")).toBe(
			controlSlot
		);
		expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
	});

	it("aligns the control to the message edge for an end-aligned row", () => {
		render(
			<SpaceMessageProgressRow
				align="end"
				control={<button type="button">Stop</button>}
				slot="test-progress"
			>
				<span>Agent is working</span>
			</SpaceMessageProgressRow>
		);

		const controlSlot = screen.getByTestId(
			"space-message-progress-control-slot"
		);

		expect(controlSlot.className).toContain("justify-end");
		expect(controlSlot.className).not.toContain("justify-start");
	});
});
