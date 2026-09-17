import type { GetSpaceStatusResponse } from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { spaceQueryKeys } from "#/query/spaces/status";
import { SpaceGuestAccessSection } from "./space-guest-access-section";

describe("SpaceGuestAccessSection", () => {
	afterEach(cleanup);

	it("waits for the owner to choose guest invitations before showing confirmation", () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		queryClient.setQueryData(
			spaceQueryKeys.status("space-123", undefined),
			createSpaceStatus()
		);

		render(
			<QueryClientProvider client={queryClient}>
				<SpaceGuestAccessSection spaceId="space-123" surface="share" />
			</QueryClientProvider>
		);

		expect(
			screen.queryByRole("dialog", { name: "Allow guests in this Space?" })
		).toBeNull();

		fireEvent.click(
			screen.getByRole("button", { name: "Enable guest invitations" })
		);

		expect(
			screen.getByRole("dialog", { name: "Allow guests in this Space?" })
		).toBeTruthy();
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
