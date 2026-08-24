import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProfileCard } from "#/components/profiles/profile-list-item";

describe("ProfileCard", () => {
	it("opens from the card surface without hijacking nested actions", () => {
		const onCardClick = vi.fn();
		const onNestedAction = vi.fn();
		render(
			<ProfileCard
				actions={
					<button onClick={onNestedAction} type="button">
						Nested action
					</button>
				}
				icon={<span aria-hidden="true">FL</span>}
				onCardClick={onCardClick}
				testId="profile-card"
				title="Ari Chen"
			/>
		);

		const cardSurface = screen.getByRole("button", {
			name: "About Ari Chen",
		});
		expect(cardSurface.classList.contains("absolute")).toBe(true);
		expect(cardSurface.classList.contains("inset-0")).toBe(true);
		fireEvent.click(cardSurface);
		expect(onCardClick).toHaveBeenCalledTimes(1);

		fireEvent.click(screen.getByRole("button", { name: "Nested action" }));
		expect(onNestedAction).toHaveBeenCalledTimes(1);
		expect(onCardClick).toHaveBeenCalledTimes(1);
	});

	it("centers the title, adornment, and role badge on one visual axis", () => {
		render(
			<ProfileCard
				icon={<span aria-hidden="true">FL</span>}
				title="Felix Lu"
				titleAction={<span>Owner</span>}
				titleAdornment={<span>(you)</span>}
			/>
		);

		const titleRow = screen.getByText("Felix Lu").parentElement;
		expect(titleRow?.classList.contains("items-center")).toBe(true);
		expect(titleRow?.classList.contains("items-start")).toBe(false);
		for (const label of ["(you)", "Owner"]) {
			const alignmentSlot = screen.getByText(label).parentElement;
			expect(alignmentSlot?.classList.contains("h-5")).toBe(true);
			expect(alignmentSlot?.classList.contains("items-center")).toBe(true);
		}
	});

	it("gives the profile name its own phone row without moving desktop actions", () => {
		render(
			<ProfileCard
				icon={<span aria-hidden="true">FL</span>}
				menu={<button type="button">More</button>}
				title="A deliberately long profile name"
				titleAction={<span>Owner</span>}
				titleAdornment={<span>(you)</span>}
			/>
		);

		const title = screen.getByText("A deliberately long profile name");
		const summary = title.closest('[data-slot="profile-card-summary"]');
		const menu = screen
			.getByRole("button", { name: "More" })
			.closest('[data-slot="profile-card-menu"]');

		expect(title.className).toContain("w-full");
		expect(title.className).toContain("sm:w-auto");
		expect(summary?.className).toContain("pr-8");
		expect(summary?.className).toContain("sm:pr-0");
		expect(menu?.className).toContain("absolute");
		expect(menu?.className).toContain("sm:static");
	});
});
