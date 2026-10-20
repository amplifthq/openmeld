import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentProfileAccessSection } from "./agent-profile-access-section";

const { grants, revoke } = vi.hoisted(() => ({
	grants: vi.fn(),
	revoke: vi.fn(),
}));
vi.mock("#/query/agent-access", () => ({
	useAgentProfileAccessGrants: grants,
	useRevokeAgentProfileAccessGrant: () => ({
		mutate: revoke,
		isPending: false,
		error: null,
	}),
}));
vi.mock("#/lib/member-agents/member-agents-feature", () => ({
	isMemberAgentsEnabled: () => true,
}));
vi.mock("#/lib/organizations/organization-context", () => ({
	useOptionalAppOrganization: () => null,
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-query")>()),
	useQuery: () => ({ data: undefined }),
}));

afterEach(() => {
	cleanup();
	revoke.mockReset();
});

function openSection() {
	render(<AgentProfileAccessSection enabled profileId="p-1" />);
	fireEvent.click(
		screen.getByRole("button", { name: "Who can use this Agent" })
	);
}

describe("AgentProfileAccessSection", () => {
	it("lists allowed colleagues, then everyone else", () => {
		grants.mockReturnValue({
			data: [
				{
					id: "g-1",
					profileId: "p-1",
					granteeUserId: "u-tali",
					granteeName: "Tali Smoke",
					granteeKind: "member",
					scope: "always",
					grantedAt: "2026-10-20T00:00:00.000Z",
				},
			],
			isPending: false,
			isError: false,
		});
		openSection();
		expect(screen.getByText("Tali Smoke")).toBeTruthy();
		expect(screen.getByText("Can start work")).toBeTruthy();
		expect(screen.getByText("Everyone else")).toBeTruthy();
		expect(screen.getByText("Asks you first")).toBeTruthy();
	});

	it("shows only everyone else when no one is allowed", () => {
		grants.mockReturnValue({ data: [], isPending: false, isError: false });
		openSection();
		expect(screen.getAllByRole("listitem")).toHaveLength(1);
		expect(screen.getByText("Everyone else")).toBeTruthy();
	});

	it("revokes only after confirming", () => {
		grants.mockReturnValue({
			data: [
				{
					id: "g-1",
					profileId: "p-1",
					granteeUserId: "u-tali",
					granteeName: "Tali Smoke",
					granteeKind: "member",
					scope: "once",
					grantedAt: "2026-10-20T00:00:00.000Z",
				},
			],
			isPending: false,
			isError: false,
		});
		openSection();
		fireEvent.click(screen.getByRole("button", { name: "Revoke Tali Smoke" }));
		expect(revoke).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
		expect(revoke).toHaveBeenCalledWith("g-1");
	});
});
