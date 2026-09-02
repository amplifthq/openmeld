import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
	AgentConfigurationCard,
	AgentConfigurationGrid,
} from "./agent-configuration-card";

describe("AgentConfigurationCard", () => {
	it("keeps the interactive card and Fluid surface at the full grid-cell width", () => {
		render(
			<AgentConfigurationGrid>
				<AgentConfigurationCard
					icon={<span />}
					itemId="model"
					label="Model"
					onClick={vi.fn()}
					summary="GPT-5.6 Sol · High"
				/>
			</AgentConfigurationGrid>
		);

		const trigger = screen.getByRole("button", { name: "Edit Model" });
		expect(trigger.className).toContain("w-full");
		expect(trigger.closest("[data-fluid-card-item]")?.className).toContain(
			"w-full"
		);
	});

	it("includes a read-only card in the Fluid shared hover highlight", () => {
		const { container } = render(
			<AgentConfigurationGrid>
				<AgentConfigurationCard
					icon={<span />}
					itemId="owner"
					label="Owner"
					readOnly
					summary="Felix Lu"
				/>
			</AgentConfigurationGrid>
		);

		const ownerCard = container.querySelector<HTMLElement>(
			'[data-fluid-card-item=""]'
		);
		expect(ownerCard).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Edit Owner" })).toBeNull();

		fireEvent.pointerEnter(ownerCard as HTMLElement);

		expect(
			ownerCard?.querySelector('[data-slot="shared-layout-background"]')
		).toBeTruthy();
	});
});
