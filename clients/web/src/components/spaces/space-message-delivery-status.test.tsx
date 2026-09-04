import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpaceMessageDeliveryStatus } from "./space-message-delivery-status";

afterEach(() => {
	vi.restoreAllMocks();
	cleanup();
});

describe("SpaceMessageDeliveryStatus", () => {
	it("never writes an invalid path while the sending icon starts animating", async () => {
		const animationPathWrites: string[] = [];
		const originalSetAttribute = SVGElement.prototype.setAttribute;
		vi.spyOn(SVGElement.prototype, "setAttribute").mockImplementation(
			function setAttribute(this: SVGElement, name, value) {
				if (name === "d") {
					animationPathWrites.push(String(value));
				}
				return originalSetAttribute.call(this, name, value);
			}
		);

		render(<SpaceMessageDeliveryStatus presentation="agent_sending" />);
		animationPathWrites.length = 0;

		await waitFor(() => {
			expect(animationPathWrites.length).toBeGreaterThan(0);
		});

		expect(animationPathWrites).not.toContain("undefined");
	});

	it("shows the solving orb in the shared 16 pixel status slot", () => {
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
});
