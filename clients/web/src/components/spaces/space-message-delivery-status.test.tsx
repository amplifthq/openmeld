import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpaceMessageDeliveryStatus } from "./space-message-delivery-status";

afterEach(() => {
	vi.restoreAllMocks();
	cleanup();
});

describe("SpaceMessageDeliveryStatus", () => {
	it("shows the working orb in the shared 16 pixel status slot", () => {
		const { container } = render(
			<SpaceMessageDeliveryStatus presentation="agent_streaming" />
		);

		const status = screen.getByRole("status", { name: "Agent is working" });
		const orb = container.querySelector<HTMLCanvasElement>(
			'canvas[data-testid="agent-working-orb"]'
		);

		expect(orb).toBeTruthy();
		expect(orb?.closest('[data-slot="space-agent-orb"]')?.className).toContain(
			"size-4"
		);
		expect(orb?.className).toContain("scale-80");
		expect(orb?.style.width).toBe("20px");
		expect(orb?.style.height).toBe("20px");
		expect(orb?.getAttribute("aria-hidden")).toBe("true");
		expect(orb?.dataset.spaceAgentOrbState).toBe("solving");
		expect(status.querySelector("svg.animate-spin")).toBeNull();
	});

	it.each([
		["send_failed", "Message not sent"],
		["agent_stream_failed", "Reply failed"],
		["agent_stream_stopped", "Stopped"],
		["agent_stream_publish_failed", "Reply could not be posted"],
	] as const)("renders %s as a full-width system outcome", (presentation, label) => {
		render(<SpaceMessageDeliveryStatus presentation={presentation} />);

		const status = screen.getByRole("status", { name: label });
		expect(status.getAttribute("data-variant")).toBe("separator");
		expect(status.className).toContain("before:content-['']");
		expect(status.className).toContain("after:content-['']");
		expect(status.className).toContain("w-full");
	});
});
