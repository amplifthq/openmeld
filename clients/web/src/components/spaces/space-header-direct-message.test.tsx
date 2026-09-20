import type { GetSpaceStatusResponse } from "@openmeld/schemas/types";
import { OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE } from "@openmeld/space";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SpaceHeader } from "./space-header";

vi.mock("./space-access-editor", () => ({
	PUBLIC_SPACE_ACCESS_WARNING_TOOLTIP: "Public Space access warning.",
}));

vi.mock("./space-settings-dialog", () => ({
	SpaceSettingsDialog: () => (
		<button aria-label="Space settings" type="button">
			Info
		</button>
	),
}));

vi.mock("./space-share-dialog", () => ({
	SpaceShareDialog: () => (
		<button aria-label="Share space" type="button">
			Share
		</button>
	),
}));

describe("SpaceHeader Direct Message identity", () => {
	it("removes the chat icon on conversion to a Space without adding Agent type labels", () => {
		const { container, rerender } = render(
			createSpaceHeader({
				memberCount: 2,
				spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
			})
		);

		expect(screen.queryByText("Local Agent")).toBeNull();
		expect(
			container.querySelector('[data-space-header-icon="direct-message"]')
		).toBeTruthy();

		rerender(
			createSpaceHeader({
				memberCount: 3,
				spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
			})
		);

		expect(screen.queryByText("Local Agent")).toBeNull();
		expect(container.querySelector("[data-space-header-icon]")).toBeNull();
	});
});

function createSpaceHeader(input: {
	memberCount: number;
	spacePurpose?: string;
}) {
	return (
		<SpaceHeader
			accessModeErrorMessage={null}
			canManageSpaceAccess={false}
			canManageSpaceName={false}
			currentProfileName={null}
			deleteSpaceErrorMessage={null}
			isAccessModePending={false}
			isDeleteSpacePending={false}
			isLeaveSpacePending={false}
			isSpaceNamePending={false}
			leaveSpaceErrorMessage={null}
			membersControl={<button type="button">Members</button>}
			onDeleteSpace={vi.fn()}
			onLeaveSpace={vi.fn()}
			onSetAccessMode={vi.fn()}
			onUpdateSpaceName={vi.fn()}
			showDeleteSpaceAction={false}
			spaceNameErrorMessage={null}
			status={createStatus(input)}
		/>
	);
}

function createStatus(input: {
	memberCount: number;
	spacePurpose?: string;
}): GetSpaceStatusResponse {
	return {
		allowedActions: ["post_message", "post_status", "stay_silent"],
		accessMode: "protected",
		dispatchBrief: "default",
		dispatchPolicy: {
			mode: "mention_only",
		},
		entryBrief: "default",
		generatedAt: "2026-04-11T00:00:00.000Z",
		members: {
			agentCount: 1,
			humanCount: 1,
			liveAgentCount: 0,
			liveHumanCount: 1,
			liveNowCount: 1,
			totalCount: input.memberCount,
		},
		name: "Design Room",
		passwordProtected: true,
		publicationMode: "collaboration",
		resultArchivePolicy: {
			mode: "all_final_results",
		},
		spaceId: "space-1",
		spacePurpose: input.spacePurpose,
	};
}
