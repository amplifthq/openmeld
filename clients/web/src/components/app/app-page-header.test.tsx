import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppPageHeader } from "./app-page-header";

describe("AppPageHeader", () => {
	it("keeps app pages on one heading hierarchy and title size", () => {
		render(
			<AppPageHeader
				action={<button type="button">Create</button>}
				description="Manage this area."
				eyebrow="Organization"
				title="Skills"
			/>
		);

		const heading = screen.getByRole("heading", {
			level: 1,
			name: "Skills",
		});
		expect(heading.classList.contains("text-2xl")).toBe(true);
		expect(screen.getByText("Organization")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Create" })).toBeTruthy();
		expect(heading.closest('[data-slot="app-page-header"]')).toBeTruthy();
	});

	it("can let a page description use the full available width", () => {
		render(
			<AppPageHeader
				description="A description that should use the available page width."
				descriptionWidth="full"
				eyebrow="Personal workspace"
				title="Channels"
			/>
		);

		const description = screen.getByText(
			"A description that should use the available page width."
		);
		expect(description.classList.contains("max-w-none")).toBe(true);
		expect(description.classList.contains("max-w-2xl")).toBe(false);
	});
});
