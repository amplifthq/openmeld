import {
	readOrUpdateSpaceFilePins,
	readOrUpdateSpaceMessagePins,
} from "@openmeld/api-client";
import type {
	SpaceFilePinsResponse,
	SpaceMessagePinsResponse,
} from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	SpacePinnedItemsBar,
	SpacePinsProvider,
	SpacePinsRecallAction,
} from "./space-pins";

vi.mock("@openmeld/api-client", async (original) => ({
	...(await original<typeof import("@openmeld/api-client")>()),
	readOrUpdateSpaceFilePins: vi.fn(),
	readOrUpdateSpaceMessagePins: vi.fn(),
}));

const owner = "11111111-1111-4111-8111-111111111111";
const reader = "22222222-2222-4222-8222-222222222222";
const date = "2026-09-01T00:00:00Z";
const actor = {
	profileId: owner,
	profileKind: "human" as const,
	displayName: "Mira",
	ownerUserId: "mira",
};
const messages: SpaceMessagePinsResponse = {
	pins: [
		{
			signalId: "message-1",
			pinnedByProfileId: owner,
			pinnedByName: "Mira",
			pinnedAt: date,
			authorName: "Mira",
			preview: "Release checklist",
		},
	],
};
const files: SpaceFilePinsResponse = {
	pins: [
		{
			pinnedByProfileId: owner,
			pinnedByName: "Mira",
			pinnedAt: date,
			file: {
				id: "file-1",
				spaceId: "space-1",
				parentId: null,
				name: "notes.md",
				path: "/notes.md",
				kind: "file",
				createdAt: date,
				updatedAt: date,
				createdBy: actor,
				updatedBy: actor,
				trashedAt: null,
				trashedBy: null,
				latestRevision: {
					id: "revision-1",
					fileId: "file-1",
					revision: 1,
					mimeType: "text/markdown",
					sizeBytes: 12,
					createdAt: date,
					createdBy: actor,
				},
			},
		},
	],
};

function show(profileId = reader, spaceId = "space-1") {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const jump = vi.fn();
	const open = vi.fn();
	const view = render(
		<QueryClientProvider client={client}>
			<SpacePinsProvider
				canPin
				organizationSlug="northstar"
				profileId={profileId}
				spaceId={spaceId}
			>
				<SpacePinsRecallAction />
				<SpacePinnedItemsBar onJump={jump} onOpen={open} />
			</SpacePinsProvider>
		</QueryClientProvider>
	);
	return { ...view, jump, open };
}

describe("Space pinned items", () => {
	beforeEach(() => {
		localStorage.clear();
		vi.clearAllMocks();
		vi.mocked(readOrUpdateSpaceMessagePins).mockResolvedValue(messages);
		vi.mocked(readOrUpdateSpaceFilePins).mockResolvedValue(files);
	});
	afterEach(cleanup);

	it("pages through files and messages in one preview and opens the selected source", async () => {
		const view = show();
		await screen.findByText("notes.md");
		expect(screen.queryByText("Release checklist")).toBeNull();
		expect(screen.getByText("1/2")).toBeTruthy();
		fireEvent.click(screen.getByLabelText("Open pinned file"));
		expect(view.open).toHaveBeenCalledWith("file-1", 1);
		fireEvent.click(screen.getByLabelText("Next pinned item"));
		expect(screen.getByText("Release checklist")).toBeTruthy();
		expect(screen.queryByText("notes.md")).toBeNull();
		fireEvent.click(screen.getByLabelText("Jump to message"));
		expect(view.jump).toHaveBeenCalledWith("message-1");
	});

	it("keeps personal dismissal across remounts, isolates readers and Spaces, and restores all pins", async () => {
		const view = show();
		await screen.findByText("notes.md");
		fireEvent.click(screen.getByLabelText("Dismiss pinned items"));
		expect(screen.queryByText("notes.md")).toBeNull();
		expect(screen.queryByLabelText("Pinned item options")).toBeNull();
		view.unmount();
		const restored = show();
		await screen.findByLabelText("Show pinned items");
		expect(screen.queryByText("notes.md")).toBeNull();
		restored.unmount();
		const otherSpace = show(reader, "space-2");
		await screen.findByText("notes.md");
		otherSpace.unmount();
		const otherReader = show(owner);
		await screen.findByText("notes.md");
		otherReader.unmount();
		show();
		fireEvent.click(await screen.findByLabelText("Show pinned items"));
		expect(screen.getByText("notes.md")).toBeTruthy();
		expect(screen.getByText("1/2")).toBeTruthy();
		expect(
			vi
				.mocked(readOrUpdateSpaceMessagePins)
				.mock.calls.every(([, input]) => !input.mutation)
		).toBe(true);
		expect(
			vi
				.mocked(readOrUpdateSpaceFilePins)
				.mock.calls.every(([, input]) => !input.mutation)
		).toBe(true);
	});

	it("offers the original pinner a choice and only unpins the selected source", async () => {
		show(owner);
		await screen.findByText("notes.md");
		fireEvent.click(screen.getByLabelText("Pinned item options"));
		expect(await screen.findByText("Dismiss")).toBeTruthy();
		fireEvent.click(screen.getByText("Unpin file"));
		await waitFor(() =>
			expect(readOrUpdateSpaceFilePins).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({
					mutation: { fileId: "file-1", action: "unpin" },
				})
			)
		);
		expect(
			vi
				.mocked(readOrUpdateSpaceMessagePins)
				.mock.calls.every(([, input]) => !input.mutation)
		).toBe(true);
	});
});
