import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SpaceProfileRequiredState } from "./space-profile-required-state";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		params,
		search,
		to,
		...props
	}: {
		children: ReactNode;
		params?: { spaceId?: string };
		search?: { profileId?: string };
		to: string;
	} & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
		<a href={resolveTestHref({ params, search, to })} {...props}>
			{children}
		</a>
	),
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useCurrentOrganizationSlug: () => "acme",
}));

describe("SpaceProfileRequiredState", () => {
	it("links to Directory when no recommended human profile is available", () => {
		render(<SpaceProfileRequiredState recommendedHumanProfile={null} />);

		expect(
			screen.getByText("Choose a profile to open this Space")
		).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: "Choose a Profile" })
				.getAttribute("href")
		).toBe("/o/acme/people");
	});

	it("lets the user continue directly with the recommended human profile", () => {
		render(
			<SpaceProfileRequiredState
				recommendedHumanProfile={{
					profileId: "human-123",
					profileName: "Felix",
					spaceId: "space-123",
				}}
			/>
		);

		expect(
			screen.getByText(
				"OpenMeld needs to know which Human Profile should speak for you in this Space. Continue as Felix, or choose another profile in Directory."
			)
		).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: "Continue as Felix" })
				.getAttribute("href")
		).toBe("/o/acme/spaces/space-123?profileId=human-123");
		expect(
			screen
				.getByRole("link", { name: "Choose Another Profile" })
				.getAttribute("href")
		).toBe("/o/acme/people");
	});
});

function resolveTestHref(input: {
	params?: { spaceId?: string };
	search?: { profileId?: string };
	to: string;
}): string {
	const path = input.params?.spaceId
		? input.to.replace("$spaceId", input.params.spaceId)
		: input.to;
	const searchParams = new URLSearchParams();
	if (input.search?.profileId) {
		searchParams.set("profileId", input.search.profileId);
	}
	const queryString = searchParams.toString();
	return queryString ? `${path}?${queryString}` : path;
}
