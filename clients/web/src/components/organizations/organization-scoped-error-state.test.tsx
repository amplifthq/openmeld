import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrganizationScopedErrorState } from "./organization-scoped-error-state";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		...props
	}: {
		children: ReactNode;
		to: string;
	} & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

describe("OrganizationScopedErrorState", () => {
	afterEach(() => {
		cleanup();
	});

	it("does not link back to the current organization and keeps Retry available", () => {
		const onRetry = vi.fn();

		render(
			<OrganizationScopedErrorState
				activeOrganization={{
					id: "org-acme",
					name: "Acme",
					slug: "acme",
				}}
				currentOrganizationSlug="acme"
				description="OpenMeld could not confirm your access right now. Try again in a moment."
				onRetry={onRetry}
				title="OpenMeld could not load your Spaces."
			/>
		);

		expect(
			screen.getByText(
				"OpenMeld could not confirm your access right now. Try again in a moment."
			)
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
		expect(screen.queryByRole("link", { name: "Go to Acme" })).toBeNull();
		expect(screen.queryByRole("link", { name: "Sign out" })).toBeNull();
	});

	it("keeps the valid organization link when it points outside the current URL org", () => {
		render(
			<OrganizationScopedErrorState
				activeOrganization={{
					id: "org-home",
					name: "Home",
					slug: "home",
				}}
				currentOrganizationSlug="acme"
				description="This organization is not available from your OpenMeld account. Switch back to an organization you belong to."
				title="Organization access unavailable"
			/>
		);

		const homeLink = screen.getByRole("link", { name: "Go to Home" });
		expect(homeLink.getAttribute("href")).toBe("/o/home");
		expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
		expect(screen.queryByRole("link", { name: "Sign out" })).toBeNull();
	});
});
