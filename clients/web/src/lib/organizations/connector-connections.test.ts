import { beforeEach, describe, expect, it, vi } from "vitest";

const requestJsonMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/openmeld-api/client", () => ({
	createWebOpenMeldApiFoundation: () => ({
		requestJson: requestJsonMock,
	}),
}));

import {
	createCurrentOrganizationConnectorAppRequest,
	listCurrentOrganizationConnectorAppCatalog,
	listCurrentOrganizationConnectorAppRequests,
	resolveConnectorConnectionErrorMessage,
	startCurrentMemberGitHubAuthorization,
	startCurrentOrganizationSharedGitHubAuthorization,
} from "./connector-connections";

describe("connector connection Web API helpers", () => {
	beforeEach(() => {
		requestJsonMock.mockReset().mockResolvedValue({
			authorizationUrl: "https://github.example/authorize",
			connection: {
				canDisconnect: false,
				connectionName: "github-pending",
				createdAtMs: 1,
				disconnectedAtMs: null,
				organizationId: "org-acme",
				ownerDisplayName: "Felix",
				scope: "shared",
				service: "github",
				status: "pending",
				updatedAtMs: 1,
				userId: "user-1",
			},
			expiresAtMs: 601_000,
		});
	});

	it("keeps OpenConnector internals out of a failed GitHub setup", () => {
		expect(
			resolveConnectorConnectionErrorMessage(
				{
					code: "upstream_unreachable",
					message: "OpenConnector request failed with status 404.",
					status: 502,
				},
				"GitHub"
			)
		).toBe("OpenMeld could not finish GitHub setup. Try again.");
	});

	it("opts shared GitHub setup into the server-owned installation expiry", async () => {
		await startCurrentOrganizationSharedGitHubAuthorization({
			organizationId: "org-acme",
		});

		expect(requestJsonMock).toHaveBeenCalledWith(
			expect.objectContaining({
				url: "/v1/organizations/current/connectors/github/shared-authorization?expectedOrganizationId=org-acme&includeAuthorizationExpiry=true",
			})
		);
	});

	it("keeps member GitHub authorization on the legacy-compatible request", async () => {
		await startCurrentMemberGitHubAuthorization({
			organizationId: "org-acme",
		});

		expect(requestJsonMock).toHaveBeenCalledWith(
			expect.objectContaining({
				url: "/v1/organizations/current/connectors/github/authorization?expectedOrganizationId=org-acme",
			})
		);
	});

	it("lists App requests inside the expected Organization boundary", async () => {
		requestJsonMock.mockResolvedValueOnce({
			organizationId: "org-acme",
			requests: [],
		});

		await listCurrentOrganizationConnectorAppRequests({
			organizationId: "org-acme",
		});

		expect(requestJsonMock).toHaveBeenCalledWith(
			expect.objectContaining({
				method: "GET",
				url: "/v1/organizations/current/connectors/requests?expectedOrganizationId=org-acme",
			})
		);
	});

	it("lists the live OpenConnector catalog inside the expected Organization boundary", async () => {
		requestJsonMock.mockResolvedValueOnce({
			organizationId: "org-acme",
			providers: [
				{
					authTypes: ["oauth2"],
					categories: [
						{
							displayName: "Developer tools",
							id: "developer-tools",
						},
					],
					displayName: "GitHub",
					homepageUrl: "https://github.com",
					iconUrl: "https://example.com/github.svg",
					service: "github",
				},
			],
		});

		await listCurrentOrganizationConnectorAppCatalog({
			organizationId: "org-acme",
		});

		expect(requestJsonMock).toHaveBeenCalledWith(
			expect.objectContaining({
				method: "GET",
				url: "/v1/organizations/current/connectors/catalog?expectedOrganizationId=org-acme",
			})
		);
	});

	it("creates a catalog App request without sending requester identity", async () => {
		requestJsonMock.mockResolvedValueOnce({
			request: {
				availableAtMs: null,
				createdAtMs: 1,
				id: "request-1",
				notifiedAtMs: null,
				organizationId: "org-acme",
				providerId: "microsoft-teams",
				providerName: "Microsoft Teams",
				requestedCapabilities: ["messages", "channels"],
				requesterMemberId: "member-1",
				requesterUserId: "user-1",
				source: "openconnector_catalog",
				status: "requested",
				updatedAtMs: 1,
				useCase: "Let Center Agent follow project updates.",
			},
		});

		await createCurrentOrganizationConnectorAppRequest({
			organizationId: "org-acme",
			providerId: "microsoft-teams",
			providerName: "Microsoft Teams",
			requestedCapabilities: ["messages", "channels"],
			source: "openconnector_catalog",
			useCase: "Let Center Agent follow project updates.",
		});

		expect(requestJsonMock).toHaveBeenCalledWith(
			expect.objectContaining({
				body: JSON.stringify({
					providerId: "microsoft-teams",
					providerName: "Microsoft Teams",
					requestedCapabilities: ["messages", "channels"],
					source: "openconnector_catalog",
					useCase: "Let Center Agent follow project updates.",
				}),
				method: "POST",
				url: "/v1/organizations/current/connectors/requests?expectedOrganizationId=org-acme",
			})
		);
	});
});
