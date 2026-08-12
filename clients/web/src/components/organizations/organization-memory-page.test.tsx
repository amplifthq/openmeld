import { centerAgentOrganizationMemoryPolicyResponseSchema } from "@openmeld/schemas/schemas";
import type {
	CenterAgentOrganizationMemoryPolicyResponse,
	UpdateCenterAgentOrganizationMemoryPolicyBody,
} from "@openmeld/schemas/types";
import type { QueryClient } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import { OrganizationMemoryPage } from "./organization-memory-page";

const getActiveOrganizationMemberRoleMock = vi.hoisted(() => vi.fn());
const readCurrentOrganizationCenterAgentMemoryPolicyMock = vi.hoisted(() =>
	vi.fn()
);
const setCurrentOrganizationCenterAgentMemoryPolicyMock = vi.hoisted(() =>
	vi.fn()
);
const wipeCurrentMemberCenterAgentMemoryMock = vi.hoisted(() => vi.fn());
let currentOrganization: OrganizationSummary = {
	id: "org-acme",
	name: "Acme",
	slug: "acme",
};
let organizationMemoryOptIn = false;

vi.mock("@openmeld/ui/components/switch", () => ({
	Switch: ({
		"aria-label": ariaLabel,
		checked,
		disabled,
		onCheckedChange,
	}: {
		"aria-label": string;
		checked: boolean;
		disabled?: boolean;
		onCheckedChange?: (checked: boolean) => void;
	}) => (
		<button
			aria-checked={checked}
			aria-label={ariaLabel}
			disabled={disabled}
			onClick={() => onCheckedChange?.(!checked)}
			role="switch"
			type="button"
		/>
	),
}));

vi.mock("#/lib/organizations/auth-organizations", () => ({
	getActiveOrganizationMemberRole: getActiveOrganizationMemberRoleMock,
}));

vi.mock("#/query/organizations/organization-directory", async () => {
	const actual = await vi.importActual<
		typeof import("#/query/organizations/organization-directory")
	>("#/query/organizations/organization-directory");
	return {
		...actual,
		organizationMemberRoleQueryOptions: (input: {
			enabled: boolean;
			organizationId: string;
			userId: string;
		}) => ({
			enabled: input.enabled,
			queryFn: () => getActiveOrganizationMemberRoleMock(),
			queryKey: actual.organizationQueryKeys.role(
				input.organizationId,
				input.userId
			),
			retry: false,
			staleTime: 60_000,
		}),
	};
});

vi.mock("#/lib/organizations/center-agent-memory", () => ({
	readCurrentOrganizationCenterAgentMemoryPolicy:
		readCurrentOrganizationCenterAgentMemoryPolicyMock,
	setCurrentOrganizationCenterAgentMemoryPolicy:
		setCurrentOrganizationCenterAgentMemoryPolicyMock,
	wipeCurrentMemberCenterAgentMemory: wipeCurrentMemberCenterAgentMemoryMock,
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization,
		currentUserId: "user-123",
	}),
}));

describe("OrganizationMemoryPage", () => {
	beforeEach(() => {
		currentOrganization = {
			id: "org-acme",
			name: "Acme",
			slug: "acme",
		};
		getActiveOrganizationMemberRoleMock.mockReset().mockResolvedValue("owner");
		readCurrentOrganizationCenterAgentMemoryPolicyMock
			.mockReset()
			.mockImplementation(() => Promise.resolve(buildMemoryPolicy()));
		organizationMemoryOptIn = false;
		setCurrentOrganizationCenterAgentMemoryPolicyMock
			.mockReset()
			.mockImplementation(
				(input: UpdateCenterAgentOrganizationMemoryPolicyBody) => {
					organizationMemoryOptIn = input.organizationMemoryOptIn;
					return Promise.resolve(buildMemoryPolicy());
				}
			);
		wipeCurrentMemberCenterAgentMemoryMock.mockReset().mockResolvedValue({
			organizationId: currentOrganization.id,
			wiped: true,
		});
	});

	afterEach(cleanup);

	it.each([
		"owner",
		"admin",
	])("lets an %s manage shared organization memory", async (role) => {
		getActiveOrganizationMemberRoleMock.mockResolvedValue(role);
		renderMemoryPage();

		expect(await screen.findByRole("heading", { name: "Memory" })).toBeTruthy();
		expect(
			screen.getByText(
				"Manage shared memory for Acme and the personal information this Center Agent remembers about you."
			)
		).toBeTruthy();
		const memorySwitch = await screen.findByRole("switch", {
			name: "Use shared Center Agent organization memory",
		});
		await waitFor(() => {
			expect(memorySwitch.getAttribute("aria-checked")).toBe("false");
			expect((memorySwitch as HTMLButtonElement).disabled).toBe(false);
		});

		fireEvent.click(memorySwitch);

		await waitFor(() => {
			expect(
				setCurrentOrganizationCenterAgentMemoryPolicyMock
			).toHaveBeenCalledWith({
				organizationId: "org-acme",
				organizationMemoryOptIn: true,
			});
		});
		await waitFor(() => {
			expect(
				readCurrentOrganizationCenterAgentMemoryPolicyMock
			).toHaveBeenCalledTimes(2);
			expect(memorySwitch.getAttribute("aria-checked")).toBe("true");
		});
	});

	it("shows organization memory read-only to members", async () => {
		getActiveOrganizationMemberRoleMock.mockResolvedValue("member");
		renderMemoryPage();

		const memorySwitch = await screen.findByRole("switch", {
			name: "Use shared Center Agent organization memory",
		});
		expect(await screen.findByText("Organization memory is off.")).toBeTruthy();
		expect(
			screen.getByText(
				"Only organization owners and admins can change this setting."
			)
		).toBeTruthy();
		expect(getActiveOrganizationMemberRoleMock).toHaveBeenCalledTimes(1);
		expect(
			readCurrentOrganizationCenterAgentMemoryPolicyMock
		).toHaveBeenCalledTimes(1);
		expect((memorySwitch as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(memorySwitch);
		expect(
			setCurrentOrganizationCenterAgentMemoryPolicyMock
		).not.toHaveBeenCalled();
	});

	it("lets every member erase their own Center Agent memory from the Memory page", async () => {
		getActiveOrganizationMemberRoleMock.mockResolvedValue("member");
		renderMemoryPage();

		fireEvent.click(
			await screen.findByRole("button", { name: "Erase memory" })
		);
		expect(
			screen.getByRole("heading", {
				name: "Erase your Center Agent memory?",
			})
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Erase memory" }));

		await waitFor(() => {
			expect(wipeCurrentMemberCenterAgentMemoryMock).toHaveBeenCalledWith({
				organizationId: "org-acme",
			});
		});
		expect(
			await screen.findByText("Your Center Agent memory was erased.")
		).toBeTruthy();
	});

	it("keeps the switch disabled and shows role lookup failures honestly", async () => {
		getActiveOrganizationMemberRoleMock.mockRejectedValue(
			new Error("Organization role request failed.")
		);
		renderMemoryPage();

		const memorySwitch = await screen.findByRole("switch", {
			name: "Use shared Center Agent organization memory",
		});
		expect(
			await screen.findByText(
				"Could not load your organization role. Organization role request failed."
			)
		).toBeTruthy();
		expect((memorySwitch as HTMLButtonElement).disabled).toBe(true);
		expect(
			screen.queryByText(
				"Only organization owners and admins can change this setting."
			)
		).toBeNull();
	});

	it("fails closed when a cached manager role refresh fails", async () => {
		const queryClient = createTestQueryClient();
		queryClient.setQueryData(
			organizationQueryKeys.role("org-acme", "user-123"),
			"owner",
			{
				updatedAt: 0,
			}
		);
		getActiveOrganizationMemberRoleMock.mockRejectedValue(
			new Error("Organization role refresh failed.")
		);

		renderMemoryPage(queryClient);

		const memorySwitch = await screen.findByRole("switch", {
			name: "Use shared Center Agent organization memory",
		});
		expect(
			await screen.findByText(
				"Could not load your organization role. Organization role refresh failed."
			)
		).toBeTruthy();
		expect((memorySwitch as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(memorySwitch);
		expect(
			setCurrentOrganizationCenterAgentMemoryPolicyMock
		).not.toHaveBeenCalled();
	});

	it("renders the real memory policy for a personal workspace", async () => {
		organizationMemoryOptIn = true;
		currentOrganization = {
			id: "org-personal",
			isPersonal: true,
			name: "Felix",
			slug: "felix",
		};

		renderMemoryPage();

		expect(await screen.findByRole("heading", { name: "Memory" })).toBeTruthy();
		expect(screen.getByText("Personal workspace")).toBeTruthy();
		expect(
			(
				await screen.findByRole("switch", {
					name: "Use Workspace memory",
				})
			).getAttribute("aria-checked")
		).toBe("true");
		expect(await screen.findByText("Workspace memory is on.")).toBeTruthy();
		expect(
			screen.getByText(
				"Control the two kinds of memory your Center Agent uses in this personal workspace."
			)
		).toBeTruthy();
		expect(
			screen.getByRole("heading", { name: "Your Center Agent memory" })
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Erase memory" })).toBeTruthy();
		expect(
			readCurrentOrganizationCenterAgentMemoryPolicyMock
		).toHaveBeenCalledTimes(1);
		expect(getActiveOrganizationMemberRoleMock).not.toHaveBeenCalled();
	});
});

function renderMemoryPage(queryClient?: QueryClient) {
	return render(
		<TestQueryClientProvider queryClient={queryClient}>
			<OrganizationMemoryPage />
		</TestQueryClientProvider>
	);
}

function buildMemoryPolicy(): CenterAgentOrganizationMemoryPolicyResponse {
	return centerAgentOrganizationMemoryPolicyResponseSchema.parse({
		organizationId: "org-acme",
		organizationMemoryOptIn,
		provider: "zep_cloud",
		updatedByUserId: organizationMemoryOptIn ? "user-1" : null,
	});
}
