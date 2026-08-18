import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	bulkAuthorizeAgentProfileBindingsMock,
	createAgentProfileBindingApiMock,
	createOrganizationApiMock,
	foundationMock,
	getBindingAuthorizationPreferenceMock,
	saveWakeAccessChoiceMock,
	setBindingAuthorizationPreferenceMock,
} = vi.hoisted(() => ({
	bulkAuthorizeAgentProfileBindingsMock: vi.fn(),
	createAgentProfileBindingApiMock: vi.fn(),
	createOrganizationApiMock: vi.fn(),
	foundationMock: {},
	getBindingAuthorizationPreferenceMock: vi.fn(),
	saveWakeAccessChoiceMock: vi.fn(),
	setBindingAuthorizationPreferenceMock: vi.fn(),
}));

vi.mock("@openmeld/api-client", () => ({
	createAgentProfileBindingApi: createAgentProfileBindingApiMock,
	createOrganizationApi: createOrganizationApiMock,
	toStructuredApiClientFailure: (error: unknown) => error,
}));

vi.mock("#/lib/openmeld-api/client", () => ({
	createOrganizationScopedWebOpenMeldApiFoundation: () => foundationMock,
	createUnscopedWebOpenMeldApiFoundation: () => foundationMock,
}));

import {
	bulkAuthorizeAgentProfileBindingsForOrganization,
	getOrganizationBindingAuthorizationPreference,
	saveOrganizationWakeAccessChoice,
	setOrganizationBindingAuthorizationPreference,
} from "./organization-binding-authorizations";

describe("organization Binding authorization Web API helpers", () => {
	beforeEach(() => {
		bulkAuthorizeAgentProfileBindingsMock.mockReset().mockResolvedValue({
			alreadyAuthorizedCount: 0,
			authorizedCount: 2,
			authorizations: [],
			organizationId: "org-acme",
		});
		createAgentProfileBindingApiMock.mockReset().mockReturnValue({});
		createOrganizationApiMock.mockReset().mockReturnValue({
			bulkAuthorizeAgentProfileBindings: bulkAuthorizeAgentProfileBindingsMock,
			getBindingAuthorizationPreference: getBindingAuthorizationPreferenceMock,
			saveWakeAccessChoice: saveWakeAccessChoiceMock,
			setBindingAuthorizationPreference: setBindingAuthorizationPreferenceMock,
		});
		getBindingAuthorizationPreferenceMock.mockReset().mockResolvedValue({
			autoAuthorizeAgentProfileBindings: true,
			organizationId: "org-acme",
			updatedAt: "2026-07-05T00:00:00.000Z",
			userId: "user-1",
		});
		setBindingAuthorizationPreferenceMock.mockReset().mockResolvedValue({
			autoAuthorizeAgentProfileBindings: false,
			organizationId: "org-acme",
			updatedAt: "2026-07-05T00:00:00.000Z",
			userId: "user-1",
		});
		saveWakeAccessChoiceMock.mockReset().mockResolvedValue({
			alreadyAuthorizedCount: 0,
			authorizedCount: 2,
			organizationId: "org-acme",
			preference: {
				autoAuthorizeAgentProfileBindings: true,
				organizationId: "org-acme",
				updatedAt: "2026-07-16T00:00:00.000Z",
				userId: "user-1",
			},
		});
	});

	it("bulk-authorizes current bound Agent Profiles for an organization", async () => {
		await bulkAuthorizeAgentProfileBindingsForOrganization({
			organizationId: "org-acme",
		});

		expect(createOrganizationApiMock).toHaveBeenCalledWith(foundationMock);
		expect(bulkAuthorizeAgentProfileBindingsMock).toHaveBeenCalledWith({
			organizationId: "org-acme",
		});
	});

	it("reads and writes the organization Binding authorization preference", async () => {
		await getOrganizationBindingAuthorizationPreference({
			organizationId: "org-acme",
		});
		await setOrganizationBindingAuthorizationPreference({
			autoAuthorizeAgentProfileBindings: false,
			organizationId: "org-acme",
		});

		expect(getBindingAuthorizationPreferenceMock).toHaveBeenCalledWith({
			organizationId: "org-acme",
		});
		expect(setBindingAuthorizationPreferenceMock).toHaveBeenCalledWith({
			autoAuthorizeAgentProfileBindings: false,
			organizationId: "org-acme",
		});
	});

	it("saves current and future Wake access in one organization request", async () => {
		await saveOrganizationWakeAccessChoice({
			enableWakeAccess: true,
			organizationId: "org-acme",
		});

		expect(saveWakeAccessChoiceMock).toHaveBeenCalledWith({
			enableWakeAccess: true,
			organizationId: "org-acme",
		});
	});
});
