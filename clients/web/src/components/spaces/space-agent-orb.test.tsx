import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SpaceAgentOrb } from "./space-agent-orb";
import {
	DEFAULT_SPACE_AGENT_ORB_STATE,
	resolveSpaceAgentWorkOrbState,
} from "./space-agent-orb-state";

afterEach(cleanup);

describe("SpaceAgentOrb", () => {
	it("renders the working orb at a 16 pixel visual footprint", () => {
		const { container } = render(<SpaceAgentOrb />);
		const orb = container.querySelector<HTMLCanvasElement>("canvas");
		const orbSlot = container.querySelector<HTMLElement>(
			'[data-slot="space-agent-orb"]'
		);

		expect(DEFAULT_SPACE_AGENT_ORB_STATE).toBe("solving");
		expect(orbSlot?.className).toContain("size-4");
		expect(orb?.className).toContain("scale-80");
		expect(orb?.style.width).toBe("20px");
		expect(orb?.style.height).toBe("20px");
		expect(orb?.getAttribute("aria-hidden")).toBe("true");
		expect(orb?.dataset.spaceAgentOrbState).toBe("solving");
	});

	it("renders a prominent 32 pixel orb without the compact scale", () => {
		const { container } = render(<SpaceAgentOrb prominent />);
		const orb = container.querySelector<HTMLCanvasElement>("canvas");
		const orbSlot = container.querySelector<HTMLElement>(
			'[data-slot="space-agent-orb"]'
		);

		expect(orbSlot?.className).toContain("size-8");
		expect(orb?.className).toContain("scale-50");
		expect(orb?.className).not.toContain("scale-80");
		expect(orb?.style.width).toBe("64px");
		expect(orb?.style.height).toBe("64px");
	});

	it.each([
		"github.code.search",
		"github.commits.search",
		"github.issues.search",
		"slack.messages.search",
		"source.search",
		"web.search",
	] as const)("uses searching for active %s work", (key) => {
		expect(
			resolveSpaceAgentWorkOrbState({
				state: "input-available",
				work: { key, v: 1 },
			})
		).toBe("searching");
	});

	it.each([
		"image.generate",
		"organization.document.draft",
	] as const)("uses shaping for active %s work", (key) => {
		expect(
			resolveSpaceAgentWorkOrbState({
				state: "input-available",
				work: { key, v: 1 },
			})
		).toBe("shaping");
	});

	it("returns to working after specialized work settles", () => {
		expect(
			resolveSpaceAgentWorkOrbState({
				state: "output-available",
				work: { key: "source.search", v: 1 },
			})
		).toBe("solving");
	});
});
