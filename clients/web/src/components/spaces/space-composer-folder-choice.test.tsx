import {
	DropdownMenu,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { FluidDropdownMenuContent } from "@openmeld/ui/fluid/dropdown-menu";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import {
	chooseComposerFolder,
	composerFolderOptions,
} from "./space-composer-folder-choice";
import {
	buildSpaceTaskSources,
	SpaceComposerAgentOptions,
} from "./space-composer-task-menu";

const DEFAULT_FOLDER = {
	displayName: "openmeld",
	folderId: "6f1f1d0e-8f8e-4a59-9c39-7d2b8c1e4a11",
	isDefault: true,
};
const OTHER_FOLDER = {
	displayName: "website",
	folderId: "3c2e8f8a-6b55-4b8e-9a43-0f3f2c9d7e21",
	isDefault: false,
};
const FOLDER_MENU = /^Folder/;

afterEach(cleanup);

describe("composer folder choice", () => {
	it("starts a new task in the chosen folder", () => {
		expect(
			chooseComposerFolder({ folder: OTHER_FOLDER, selection: undefined })
		).toEqual({
			label: "Start new in website",
			selection: { folderId: OTHER_FOLDER.folderId, mode: "new" },
		});
		expect(
			chooseComposerFolder({
				folder: OTHER_FOLDER,
				selection: { access: "space_context", mode: "new" },
			}).selection
		).toEqual({ folderId: OTHER_FOLDER.folderId, mode: "new" });
	});

	it("continues a session in another folder as a fork", () => {
		for (const mode of ["resume", "fork"] as const) {
			expect(
				chooseComposerFolder({
					folder: OTHER_FOLDER,
					selection: { mode, sourceWakeId: "wake-1" },
				})
			).toEqual({
				label: mode === "fork" ? "Fork in website" : "Continue in website",
				selection: {
					folderId: OTHER_FOLDER.folderId,
					mode: "fork",
					sourceWakeId: "wake-1",
				},
			});
		}
	});

	it("offers no folders when the Computer's list is unavailable", () => {
		expect(
			composerFolderOptions({
				agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
				message: "offline",
				reasonCode: "local_agent_control.service_offline",
				status: "unavailable",
				target: { deviceId: "device-1", runtimeLane: "prod" },
			})
		).toEqual([]);
	});
});

function renderOptions(input: {
	folders?: (typeof DEFAULT_FOLDER)[];
	onChange: (choice: unknown) => void;
}) {
	render(
		<DropdownMenu>
			<DropdownMenuTrigger>Options</DropdownMenuTrigger>
			<FluidDropdownMenuContent>
				<SpaceComposerAgentOptions
					{...(input.folders ? { folders: input.folders } : {})}
					onChange={input.onChange}
					sources={[]}
					supportsCurrentFolder
					targetProfileId="agent"
				/>
			</FluidDropdownMenuContent>
		</DropdownMenu>
	);
	fireEvent.click(screen.getByRole("button", { name: "Options" }));
}

describe("composer folder menu", () => {
	it("lets the owner pick a folder by name", async () => {
		const onChange = vi.fn();
		renderOptions({ folders: [DEFAULT_FOLDER, OTHER_FOLDER], onChange });
		fireEvent.click(await screen.findByRole("menuitem", { name: FOLDER_MENU }));
		const items = await screen.findAllByRole("menuitemradio");
		const website = items.find((item) => item.textContent === "website");
		if (!website) {
			throw new Error("Folder choice missing");
		}
		fireEvent.click(website);
		expect(onChange).toHaveBeenCalledWith({
			label: "Start new in website",
			selection: { folderId: OTHER_FOLDER.folderId, mode: "new" },
			targetProfileId: "agent",
		});
	});

	it.each([
		["without the owner's folder list", undefined],
		["with only one folder", [DEFAULT_FOLDER]],
	])("shows no folder menu %s", async (_case, folders) => {
		renderOptions({ ...(folders ? { folders } : {}), onChange: vi.fn() });
		await screen.findByText("Session");
		expect(screen.queryByRole("menuitem", { name: FOLDER_MENU })).toBeNull();
	});

	it("continues an earlier session in another folder as a fork", async () => {
		const onChange = vi.fn();
		render(
			<DropdownMenu>
				<DropdownMenuTrigger>Options</DropdownMenuTrigger>
				<FluidDropdownMenuContent>
					<SpaceComposerAgentOptions
						choice={{
							label: "Review upload",
							selection: { mode: "resume", sourceWakeId: "wake-previous" },
							targetProfileId: "agent",
						}}
						folders={[DEFAULT_FOLDER, OTHER_FOLDER]}
						onChange={onChange}
						sources={[]}
						supportsCurrentFolder
						targetProfileId="agent"
					/>
				</FluidDropdownMenuContent>
			</DropdownMenu>
		);
		fireEvent.click(screen.getByRole("button", { name: "Options" }));
		fireEvent.click(await screen.findByRole("menuitem", { name: FOLDER_MENU }));
		const website = (await screen.findAllByRole("menuitemradio")).find(
			(item) => item.textContent === "website"
		);
		if (!website) {
			throw new Error("Folder choice missing");
		}
		fireEvent.click(website);
		expect(onChange).toHaveBeenCalledWith({
			label: "Continue in website",
			selection: {
				folderId: OTHER_FOLDER.folderId,
				mode: "fork",
				sourceWakeId: "wake-previous",
			},
			targetProfileId: "agent",
		});
	});
});

describe("continuation sources", () => {
	const items = [
		timelineItem({ id: "ask-answered", actorProfileId: "human" }),
		timelineItem({ id: "ask-failed", actorProfileId: "human" }),
		timelineItem({
			actorProfileId: "agent",
			id: "reply-1",
			isAgentFinalReply: true,
			replyToSignalId: "ask-answered",
			wakeTargetProfileIds: [],
		}),
		// Still streaming: no finished turn yet.
		timelineItem({
			actorProfileId: "agent",
			agentStreamState: {
				reasonCode: null,
				sequence: 1,
				status: "streaming",
				streamId: "stream-1",
			},
			id: "stream-1",
			isAgentFinalReply: true,
			replyToSignalId: "ask-failed",
			wakeTargetProfileIds: [],
		}),
	];

	it("offers only requests the Agent finished, to continue or fork", async () => {
		const sources = buildSpaceTaskSources(items, "human");
		// A failed request and one still streaming have no finished turn.
		expect(sources.map((source) => source.label)).toEqual(["ask-answered"]);
		render(
			<DropdownMenu>
				<DropdownMenuTrigger>Options</DropdownMenuTrigger>
				<FluidDropdownMenuContent>
					<SpaceComposerAgentOptions
						onChange={vi.fn()}
						sources={sources}
						supportsCurrentFolder
						targetProfileId="agent"
					/>
				</FluidDropdownMenuContent>
			</DropdownMenu>
		);
		fireEvent.click(screen.getByRole("button", { name: "Options" }));
		fireEvent.click(await screen.findByText("Session"));
		expect(
			(await screen.findAllByRole("menuitemradio", { name: "ask-answered" }))
				.length
		).toBe(2);
		expect(
			screen.queryByRole("menuitemradio", { name: "ask-failed" })
		).toBeNull();
	});

	it("offers a plain Direct Message the Agent answered, though it named no wake target (R4-03)", () => {
		const sources = buildSpaceTaskSources(
			[
				// A plain DM wakes the peer without activation targets.
				timelineItem({
					actorProfileId: "human",
					id: "plain-dm",
					wakeTargetProfileIds: [],
				}),
				timelineItem({
					actorProfileId: "codex",
					id: "codex-reply",
					isAgentFinalReply: true,
					replyToSignalId: "plain-dm",
					wakeTargetProfileIds: [],
				}),
			],
			"human"
		);
		expect(
			sources.map((source) => [source.label, source.targetProfileId])
		).toEqual([["plain-dm", "codex"]]);
	});
});

function timelineItem(
	overrides: Partial<SpaceTimelineItem> & {
		actorProfileId: string;
		id: string;
	}
): SpaceTimelineItem {
	return {
		deliveryState: "sent",
		signalType: "signal.text",
		spaceId: "space-1",
		text: overrides.id,
		wakeTargetProfileIds: ["agent"],
		...overrides,
	} as SpaceTimelineItem;
}
