import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeamFilesSidebar } from "./team-files-navigation";

const organization = vi.hoisted(() => ({ isPersonal: false }));
vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({ currentOrganization: organization }),
}));

afterEach(() => {
	cleanup();
	organization.isPersonal = false;
});

describe("Files navigation", () => {
	it.each([
		["team", "Team files", "team"],
		["my", "My files", "my"],
		["team", "My files", "my"],
		["knowledge", "My files", "my"],
		["my", "Trash", "trash-my"],
		["trash-my", "Team files", "team"],
		["team", "Trash", "trash"],
	])("switches from %s to %s without carrying a folder or document across locations", async (view, label, expected) => {
		const onUrlUpdate = vi.fn();
		render(
			<NuqsTestingAdapter
				hasMemory
				onUrlUpdate={onUrlUpdate}
				searchParams={`?view=${view}&folder=folder-a&file=file-a&document=document-a&create=1&kind=knowledge&subjectUserId=user-a`}
			>
				<TeamFilesSidebar />
			</NuqsTestingAdapter>
		);
		fireEvent.click(screen.getByRole("button", { name: label }));
		await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
		const params = onUrlUpdate.mock.lastCall?.[0]
			.searchParams as URLSearchParams;
		expect(params.get("view") ?? "team").toBe(expected);
		for (const key of [
			"folder",
			"file",
			"document",
			"create",
			"kind",
			"subjectUserId",
		]) {
			expect(params.has(key)).toBe(false);
		}
	});
	it("keeps personal workspaces on their single file location", () => {
		organization.isPersonal = true;
		render(
			<NuqsTestingAdapter>
				<TeamFilesSidebar />
			</NuqsTestingAdapter>
		);
		expect(screen.getByRole("button", { name: "Team files" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "My files" })).toBeNull();
	});
});
