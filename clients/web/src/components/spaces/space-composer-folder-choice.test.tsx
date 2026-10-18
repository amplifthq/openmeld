import {
	DropdownMenu,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { FluidDropdownMenuContent } from "@openmeld/ui/fluid/dropdown-menu";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	chooseComposerFolder,
	composerFolderOptions,
} from "./space-composer-folder-choice";
import { SpaceComposerAgentOptions } from "./space-composer-task-menu";

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

	it("shows no folder menu without the owner's folder list", async () => {
		renderOptions({ onChange: vi.fn() });
		await screen.findByText("Session");
		expect(screen.queryByRole("menuitem", { name: FOLDER_MENU })).toBeNull();
	});
});
