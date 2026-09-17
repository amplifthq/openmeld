import type { GetSpaceStatusResponse } from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spaceQueryKeys } from "#/query/spaces/status";
import { SpaceGuestAccessSection } from "./space-guest-access-section";

const { requestSpaceInvitationsMock, updateMetaMock } = vi.hoisted(() => ({
	requestSpaceInvitationsMock: vi.fn(),
	updateMetaMock: vi.fn(),
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useOptionalAppOrganization: () => ({
		currentOrganization: {
			id: "org-123",
			isPersonal: false,
			name: "Northstar",
			slug: "northstar",
		},
		currentUserId: "user-123",
	}),
}));

vi.mock("#/query/organizations/organization-directory", () => ({
	organizationMemberRoleQueryOptions: () => ({
		queryFn: async () => "owner",
		queryKey: ["organization-role", "org-123", "user-123"],
	}),
}));

vi.mock("#/lib/spaces/api", () => ({
	createUnscopedWebSpaceApi: () => ({ updateMeta: updateMetaMock }),
}));

vi.mock("#/lib/organizations/space-invitations", () => ({
	requestSpaceInvitations: requestSpaceInvitationsMock,
	SpaceInvitationRequestError: class extends Error {},
}));

describe("SpaceGuestAccessSection", () => {
	beforeEach(() => {
		updateMetaMock.mockReset().mockResolvedValue(undefined);
		requestSpaceInvitationsMock.mockReset().mockImplementation((request) => {
			if (request.action === "list") {
				return Promise.resolve([]);
			}
			return Promise.resolve([]);
		});
	});

	afterEach(cleanup);

	it("enables guest access and continues the invitation after one confirmation", async () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		queryClient.setQueryData(
			spaceQueryKeys.status("space-123", undefined),
			createSpaceStatus()
		);

		render(
			<QueryClientProvider client={queryClient}>
				<SpaceGuestAccessSection spaceId="space-123" />
			</QueryClientProvider>
		);

		fireEvent.change(await screen.findByLabelText("Email address"), {
			target: { value: "guest@example.com" },
		});

		fireEvent.click(screen.getByRole("button", { name: "Invite guest" }));

		expect(
			screen.getByRole("dialog", { name: "Allow guest access?" })
		).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "Allow and invite guest" })
		);

		await waitFor(() => {
			expect(updateMetaMock).toHaveBeenCalledWith({
				allowGuests: true,
				spaceId: "space-123",
			});
			expect(requestSpaceInvitationsMock).toHaveBeenCalledWith({
				action: "create",
				audience: "guest",
				email: "guest@example.com",
				organizationId: "org-123",
				spaceId: "space-123",
			});
		});
	});
});

function createSpaceStatus(): GetSpaceStatusResponse {
	return {
		accessMode: "public",
		allowedActions: ["post_message", "post_status", "stay_silent"],
		allowGuests: false,
		dispatchBrief: "default",
		dispatchPolicy: { mode: "mention_only" },
		entryBrief: "default",
		generatedAt: "2026-09-17T00:00:00.000Z",
		linkJoinPolicy: "invite_only",
		members: {
			agentCount: 0,
			humanCount: 1,
			liveAgentCount: 0,
			liveHumanCount: 1,
			liveNowCount: 1,
			totalCount: 1,
		},
		passwordProtected: false,
		publicationMode: "collaboration",
		resultArchivePolicy: { mode: "all_final_results" },
		spaceId: "space-123",
	};
}
