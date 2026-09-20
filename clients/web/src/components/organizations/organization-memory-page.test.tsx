import type { CenterAgentOrganizationMemoryPolicyResponse } from "@openmeld/schemas/types";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import { TestQueryClientProvider } from "#/test-support/query-client";
import { OrganizationMemoryPage } from "./organization-memory-page";

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

vi.mock("#/lib/organizations/center-agent-memory", () => ({
	readCurrentOrganizationCenterAgentMemoryPolicy:
		readCurrentOrganizationCenterAgentMemoryPolicyMock,
	setCurrentOrganizationCenterAgentMemoryPolicy:
		setCurrentOrganizationCenterAgentMemoryPolicyMock,
	wipeCurrentMemberCenterAgentMemory: wipeCurrentMemberCenterAgentMemoryMock,
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({ currentOrganization }),
}));

describe("OrganizationMemoryPage", () => {
	beforeEach(() => {
		currentOrganization = {
			id: "org-acme",
			name: "Acme",
			slug: "acme",
		};
		organizationMemoryOptIn = false;
		readCurrentOrganizationCenterAgentMemoryPolicyMock
			.mockReset()
			.mockImplementation(() => Promise.resolve(buildMemoryPolicy()));
		setCurrentOrganizationCenterAgentMemoryPolicyMock.mockReset();
		wipeCurrentMemberCenterAgentMemoryMock.mockReset().mockResolvedValue({
			organizationId: currentOrganization.id,
			wiped: true,
		});
	});

	afterEach(cleanup);

	it("keeps organization Memory focused on the current member", async () => {
		renderMemoryPage();

		expect(await screen.findByRole("heading", { name: "Memory" })).toBeTruthy();
		expect(
			screen.getByText(
				"Review or erase what this Center Agent remembers about you."
			)
		).toBeTruthy();
		expect(
			screen.getByRole("heading", { name: "Your Center Agent memory" })
		).toBeTruthy();
		expect(
			screen.queryByRole("heading", { name: "Organization memory" })
		).toBeNull();
		expect(screen.queryByRole("switch")).toBeNull();
		expect(
			readCurrentOrganizationCenterAgentMemoryPolicyMock
		).not.toHaveBeenCalled();
	});

	it("lets every member erase their own Center Agent memory", async () => {
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

	it("keeps Workspace memory on the Memory page for a personal workspace", async () => {
		organizationMemoryOptIn = true;
		currentOrganization = {
			id: "org-personal",
			isPersonal: true,
			name: "Felix",
			slug: "felix",
		};

		renderMemoryPage();

		expect(await screen.findByText("Personal workspace")).toBeTruthy();
		expect(
			(
				await screen.findByRole("switch", {
					name: "Use Workspace memory",
				})
			).getAttribute("aria-checked")
		).toBe("true");
		expect(screen.getByText("Remember shared conversations")).toBeTruthy();
		expect(
			screen.getByText(
				"Center Agent can use useful details from Spaces and connected channels in future replies. Private chats use your personal memory instead."
			)
		).toBeTruthy();
		expect(
			screen.getByRole("heading", { name: "Your Center Agent memory" })
		).toBeTruthy();
		expect(
			readCurrentOrganizationCenterAgentMemoryPolicyMock
		).toHaveBeenCalledTimes(1);
	});
});

function renderMemoryPage() {
	return render(
		<TestQueryClientProvider>
			<OrganizationMemoryPage />
		</TestQueryClientProvider>
	);
}

function buildMemoryPolicy(): CenterAgentOrganizationMemoryPolicyResponse {
	return {
		organizationId: currentOrganization.id,
		organizationMemoryOptIn,
		provider: "zep_cloud",
		updatedByUserId: organizationMemoryOptIn ? "user-1" : null,
	};
}
