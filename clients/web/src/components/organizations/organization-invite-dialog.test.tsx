import { cleanup, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import { TestQueryClientProvider } from "#/test-support/query-client";
import { OrganizationInviteDialog } from "./organization-invite-dialog";

const personal: OrganizationSummary = {
	id: "personal",
	name: "New User",
	slug: "new-user",
	isPersonal: true,
};
let organizations = [personal];

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization: personal,
		currentUserId: "new-user",
		organizations,
	}),
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		search,
		to,
		...props
	}: {
		children: ReactNode;
		search?: Record<string, string>;
		to: string;
	} & AnchorHTMLAttributes<HTMLAnchorElement>) => (
		<a href={`${to}?${new URLSearchParams(search)}`} {...props}>
			{children}
		</a>
	),
}));

describe("Personal Workspace invitation dialog", () => {
	afterEach(cleanup);
	it.each([
		false,
		true,
	])("offers the right next step when an organization exists: %s", async (hasOrganization) => {
		organizations = hasOrganization
			? [
					personal,
					{ id: "acme", name: "Acme", slug: "acme", isPersonal: false },
				]
			: [personal];
		render(
			<TestQueryClientProvider>
				<OrganizationInviteDialog onOpenChange={() => undefined} open />
			</TestQueryClientProvider>
		);
		expect(
			await screen.findByText("Work together in an organization.")
		).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: "Create organization" })
				.getAttribute("href")
		).toBe("/o/new-user/new-organization?intent=invite-people");
		const choose = screen.queryByRole("link", {
			name: "Choose organization",
		});
		expect(choose?.getAttribute("href") ?? null).toBe(
			hasOrganization ? "/o/new-user/organizations?intent=invite-people" : null
		);
		expect(screen.queryByLabelText("Email")).toBeNull();
		expect(screen.queryByText("Loading invitation options")).toBeNull();
	});
});
