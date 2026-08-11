import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
	AppOrganizationProvider,
	useAppOrganization,
} from "./organization-context";
import type { OrganizationScopeAuthorized } from "./organization-types";

function OrganizationContextProbe() {
	const organization = useAppOrganization();
	return (
		<>
			<output data-testid="account-name">{organization.account.name}</output>
			<output data-testid="current-user-id">
				{organization.currentUserId}
			</output>
		</>
	);
}

describe("AppOrganizationProvider", () => {
	it("provides the signed-in session user id independently of storage scope", () => {
		const currentOrganization = {
			id: "org-acme",
			name: "Acme",
			slug: "acme",
		};
		const scope = {
			access: "authorized",
			account: {
				email: "felix@example.com",
				image: null,
				name: "Felix",
			},
			activeOrganization: currentOrganization,
			currentOrganization,
			currentUserId: "session-user-123",
			organizations: [currentOrganization],
			storageScope: "cache-scope-456",
		} satisfies OrganizationScopeAuthorized;

		render(
			<AppOrganizationProvider scope={scope}>
				<OrganizationContextProbe />
			</AppOrganizationProvider>
		);

		expect(screen.getByTestId("account-name").textContent).toBe("Felix");
		expect(screen.getByTestId("current-user-id").textContent).toBe(
			"session-user-123"
		);
	});
});
