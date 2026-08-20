import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProfileCard } from "#/components/profiles/profile-list-item";

describe("ProfileCard", () => {
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
});
