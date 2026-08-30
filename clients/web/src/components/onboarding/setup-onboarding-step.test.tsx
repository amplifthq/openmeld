import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestQueryClientProvider } from "#/test-support/query-client";
import { SetupOnboardingStep } from "./setup-onboarding-step";

const ORGANIZATION_BRIEF_BUTTON_NAME = /Organization brief/i;
const INFORMATION_PROTECTION_BUTTON_NAME = /Information protection/i;

const api = vi.hoisted(() => ({
	createDocument: vi.fn(),
	getDocument: vi.fn(),
	listDocuments: vi.fn(),
	readInformationProtection: vi.fn(),
	readMemory: vi.fn(),
	readRole: vi.fn(),
	setInformationProtection: vi.fn(),
	setMemory: vi.fn(),
	updateDocument: vi.fn(),
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization: {
			id: "org-acme",
			name: "Acme",
			slug: "acme",
		},
		currentUserId: "user-1",
	}),
}));

vi.mock("#/lib/organizations/center-agent-memory", () => ({
	setCurrentOrganizationCenterAgentMemoryPolicy: api.setMemory,
}));

vi.mock("#/lib/organizations/organization-documents", () => ({
	createCurrentOrganizationDocument: api.createDocument,
	resolveOrganizationDocumentErrorMessage: () =>
		"OpenMeld could not save this document.",
	updateCurrentOrganizationDocument: api.updateDocument,
}));

vi.mock("#/lib/organizations/organization-information-protection", () => ({
	setCurrentOrganizationInformationProtection: api.setInformationProtection,
}));

vi.mock("#/query/organizations/center-agent", () => ({
	centerAgentMemoryPolicyQueryOptions: () => ({
		queryFn: api.readMemory,
		queryKey: ["center-agent", "org-acme", "memory-policy"],
	}),
	centerAgentQueryKeys: {
		memoryPolicy: (organizationId: string) => [
			"center-agent",
			organizationId,
			"memory-policy",
		],
	},
}));

vi.mock("#/query/organizations/organization-directory", () => ({
	organizationMemberRoleQueryOptions: () => ({
		queryFn: api.readRole,
		queryKey: ["organization", "org-acme", "role", "user-1"],
	}),
}));

vi.mock("#/query/organizations/organization-documents", () => ({
	organizationDocumentQueryKeys: {
		detail: (organizationId: string, documentId: string) => [
			"organization-documents",
			organizationId,
			"detail",
			documentId,
		],
		list: (organizationId: string) => [
			"organization-documents",
			organizationId,
			"list",
		],
	},
	organizationDocumentQueryOptions: () => ({
		enabled: false,
		queryFn: api.getDocument,
		queryKey: ["organization-documents", "org-acme", "detail", "none"],
	}),
	organizationDocumentsQueryOptions: () => ({
		queryFn: api.listDocuments,
		queryKey: ["organization-documents", "org-acme", "list"],
	}),
}));

vi.mock("#/query/organizations/organization-information-protection", () => ({
	organizationInformationProtectionQueryKeys: {
		policy: (organizationId: string) => [
			"organization-information-protection",
			organizationId,
			"policy",
		],
	},
	organizationInformationProtectionQueryOptions: () => ({
		queryFn: api.readInformationProtection,
		queryKey: ["organization-information-protection", "org-acme", "policy"],
	}),
}));

describe("SetupOnboardingStep", () => {
	beforeEach(() => {
		api.readMemory.mockResolvedValue({
			organizationId: "org-acme",
			organizationMemoryOptIn: true,
			provider: "zep_cloud",
			updatedByUserId: null,
		});
		api.readRole.mockResolvedValue("owner");
		api.listDocuments.mockResolvedValue({
			canManage: true,
			currentUserId: "user-1",
			documents: [],
			folders: [],
			organizationId: "org-acme",
		});
		api.readInformationProtection.mockResolvedValue({
			organizationId: "org-acme",
			protectedInformation: null,
			updatedAt: null,
			updatedByUserId: null,
		});
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("renders the Core-owned memory default without cross-workspace Agent controls", async () => {
		render(
			<TestQueryClientProvider>
				<SetupOnboardingStep onContinue={vi.fn()} />
			</TestQueryClientProvider>
		);

		expect(api.setMemory).not.toHaveBeenCalled();
		await waitFor(() => {
			expect(
				screen
					.getByRole("switch", { name: "Organization memory" })
					.getAttribute("aria-checked")
			).toBe("true");
		});
		expect(
			screen.queryByRole("switch", { name: "Use my connected agents" })
		).toBeNull();
		expect(
			screen.getByRole("button", { name: ORGANIZATION_BRIEF_BUTTON_NAME })
		).toBeTruthy();
		expect(
			screen.getByRole("button", {
				name: INFORMATION_PROTECTION_BUTTON_NAME,
			})
		).toBeTruthy();
	});

	it("keeps information protection hidden from ordinary members", async () => {
		api.readRole.mockResolvedValue("member");
		api.setMemory.mockResolvedValue({
			organizationId: "org-acme",
			organizationMemoryOptIn: true,
			provider: "zep_cloud",
			updatedByUserId: "user-1",
		});

		render(
			<TestQueryClientProvider>
				<SetupOnboardingStep onContinue={vi.fn()} />
			</TestQueryClientProvider>
		);

		await waitFor(() => {
			expect(api.readRole).toHaveBeenCalled();
		});
		expect(
			screen.queryByRole("button", {
				name: INFORMATION_PROTECTION_BUTTON_NAME,
			})
		).toBeNull();
	});

	it("preserves an owner's explicit memory-off choice", async () => {
		api.readMemory.mockResolvedValue({
			organizationId: "org-acme",
			organizationMemoryOptIn: false,
			provider: "zep_cloud",
			updatedByUserId: "user-1",
		});

		render(
			<TestQueryClientProvider>
				<SetupOnboardingStep onContinue={vi.fn()} />
			</TestQueryClientProvider>
		);

		await waitFor(() => {
			expect(
				screen
					.getByRole("switch", { name: "Organization memory" })
					.getAttribute("aria-checked")
			).toBe("false");
		});
		expect(api.setMemory).not.toHaveBeenCalled();
	});
});
