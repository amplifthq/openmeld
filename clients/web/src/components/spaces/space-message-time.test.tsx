import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SpaceMessageTime } from "./space-message-time";

const CREATED_AT_MS = new Date(2026, 9, 29, 14, 48, 17).getTime();

describe("SpaceMessageTime", () => {
	afterEach(cleanup);

	it("shows the short time and the full date on hover", async () => {
		render(
			<TooltipProvider delay={0}>
				<SpaceMessageTime
					createdAtMs={CREATED_AT_MS}
					isDirectMessage={false}
					placement="header"
				/>
			</TooltipProvider>
		);

		const time = screen.getByText("14:48");
		expect(time.tagName).toBe("TIME");
		expect(time.getAttribute("data-slot")).toBe("tooltip-trigger");

		fireEvent.pointerEnter(time, { pointerType: "mouse" });
		fireEvent.mouseEnter(time);
		fireEvent.mouseMove(time);

		expect(await screen.findByText("Oct 29, 2026, 2:48:17 PM")).toBeDefined();
	});
});
