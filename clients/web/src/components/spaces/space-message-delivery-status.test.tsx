import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpaceMessageDeliveryStatus } from "./space-message-delivery-status";

afterEach(() => {
	vi.restoreAllMocks();
	cleanup();
});

describe("SpaceMessageDeliveryStatus", () => {
	it("swaps optimistic agent status copy in one stable status", () => {
		const view = render(
			<SpaceMessageDeliveryStatus presentation="agent_sending" />
		);
		const status = screen.getByRole("status", { name: "Sending to Agent…" });

		view.rerender(<SpaceMessageDeliveryStatus presentation="agent_starting" />);

		expect(screen.getByRole("status", { name: "Agent is working" })).toBe(
			status
		);
		expect(
			status
				.querySelector('[data-slot="animated-mobius-icon"] path')
				?.getAttribute("d")
		).toBe(
			"M 12 8 C 14.21 8 16 9.79 16 12 C 16 14.21 14.21 16 12 16 C 9.79 16 8 14.21 8 12 C 8 9.79 9.79 8 12 8 Z"
		);

		const visualLayers = Array.from(
			status.querySelectorAll(
				'[data-slot="space-message-delivery-status-text"]'
			)
		);
		expect(visualLayers.map((layer) => layer.textContent)).toEqual([
			"Sending to Agent…",
			"Agent is working",
		]);
		expect(
			status.querySelector('[data-slot="agent-thinking-elapsed"]')
		).toBeNull();
		const enteringLayer = visualLayers.at(-1) as HTMLElement;
		expect(enteringLayer.style.filter).toBe("blur(8px)");
		expect(enteringLayer.style.transform).toContain("translateY(80%)");
		for (const layer of visualLayers) {
			expect(layer.getAttribute("aria-hidden")).toBe("true");
			expect(layer.className).toContain("col-start-1");
			expect(layer.className).toContain("row-start-1");
		}
	});

	it("never writes an invalid path while the working icon starts animating", async () => {
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

		render(<SpaceMessageDeliveryStatus presentation="agent_starting" />);
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
