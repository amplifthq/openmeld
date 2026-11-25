import type { OrganizationDirectoryResponse } from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DirectoryMemberRemoval } from "./directory-member-removal";

const mocks = vi.hoisted(() => ({
	navigate: vi.fn().mockResolvedValue(undefined),
	preview: vi.fn(),
	prepare: vi.fn(),
	remove: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => mocks.navigate,
}));
vi.mock("#/lib/organizations/organization-member-removal", () => ({
	prepareOrganizationMemberRemoval: mocks.prepare,
	previewOrganizationMemberRemoval: mocks.preview,
}));
vi.mock("#/lib/organizations/auth-organizations", () => ({
	removeOrganizationMember: mocks.remove,
}));

const RETAINED_ASSETS_COPY =
	/Agents, computers, and connected channel accounts/;

const member = {
	memberId: "membership-fixture",
	role: "member",
	userId: "user-fixture",
	user: { name: "Casey Fixture" },
} as OrganizationDirectoryResponse["members"][number];
const organization = {
	id: "org-fixture",
	name: "Fixture team",
	slug: "fixture-team",
};

function renderAction(
	viewerRole: string | null,
	userId = "viewer",
	targetRole = "member"
) {
	return render(
		<QueryClientProvider client={new QueryClient()}>
			<DirectoryMemberRemoval
				directoryQuery={{
					data: { members: [{ ...member, role: targetRole }] },
					isError: false,
				}}
				organization={organization}
				profileId={`member:${member.memberId}`}
				roleQuery={{ data: viewerRole, isError: false }}
				userId={userId}
			/>
		</QueryClientProvider>
	);
}

async function openMemberRemoval() {
	const more = screen.getByRole("button", {
		name: "More actions for Casey Fixture",
	});
	fireEvent.click(more);
	fireEvent.click(
		await screen.findByRole("menuitem", { name: "Remove member" })
	);
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

it.each([
	"owner",
	"admin",
])("lets an %s review and confirm removal on the member detail", async (role) => {
	mocks.preview.mockResolvedValue({
		memberId: member.memberId,
		userId: member.userId,
		spaces: [],
	});
	mocks.remove.mockResolvedValue(undefined);
	renderAction(role);
	await openMemberRemoval();
	const dialog = await screen.findByRole("alertdialog", {
		name: "Remove Casey Fixture?",
	});
	expect(within(dialog).getByText(RETAINED_ASSETS_COPY)).toBeTruthy();
	const confirm = within(dialog).getByRole("button", { name: "Remove member" });
	await waitFor(() => expect(confirm).toHaveProperty("disabled", false));
	expect(mocks.remove).not.toHaveBeenCalled();
	fireEvent.click(confirm);
	await waitFor(() =>
		expect(mocks.navigate).toHaveBeenCalledWith({
			replace: true,
			search: {},
			to: "/o/fixture-team/people",
		})
	);
	expect(mocks.preview).toHaveBeenCalledWith({
		memberId: member.memberId,
		organizationId: organization.id,
	});
	expect(mocks.remove).toHaveBeenCalledExactlyOnceWith({
		memberIdOrEmail: member.memberId,
		organizationId: organization.id,
	});
	expect(mocks.prepare).not.toHaveBeenCalled();
});

it.each([
	{ role: "member", user: "other", target: "member" },
	{ role: null, user: "other", target: "member" },
	{ role: "admin", user: member.userId, target: "admin" },
	{ role: "owner", user: "other", target: "owner" },
])("does not expose removal for role $role / target $target", ({
	role,
	user,
	target,
}) => {
	renderAction(role, user, target);
	expect(
		screen.queryByRole("button", { name: "More actions for Casey Fixture" })
	).toBeNull();
	expect(mocks.preview).not.toHaveBeenCalled();
	expect(mocks.remove).not.toHaveBeenCalled();
});

it("does not remove the member when preview is denied", async () => {
	mocks.preview.mockRejectedValue(new Error("Not permitted"));
	renderAction("admin");
	await openMemberRemoval();
	const dialog = await screen.findByRole("alertdialog");
	expect((await within(dialog).findByRole("alert")).textContent).toContain(
		"Not permitted"
	);
	expect(
		within(dialog).getByRole("button", { name: "Remove member" })
	).toHaveProperty("disabled", true);
	expect(mocks.remove).not.toHaveBeenCalled();
});

const defaultSuccessor = {
	userId: "owner-user-fixture",
	profileName: "Owner Fixture",
};
const sharedSpaceTransfer = {
	spaceId: "space-fixture",
	name: "Operations handoff",
	action: "transfer",
};
const DEFAULT_RECIPIENT_COPY =
	/Owner Fixture is the organization’s default recipient and already has access/;
const EXPLICIT_PRIVATE_ACCESS_COPY = /including private content/;

it("reviews the configured recipient before preparing transfer and removing the member", async () => {
	mocks.preview.mockResolvedValue({
		memberId: member.memberId,
		userId: member.userId,
		spaces: [sharedSpaceTransfer],
		defaultSuccessor,
	});
	mocks.prepare.mockResolvedValue({ prepared: true });
	mocks.remove.mockResolvedValue(undefined);
	renderAction("admin");
	await openMemberRemoval();
	const dialog = await screen.findByRole("alertdialog");
	expect(await within(dialog).findByText(DEFAULT_RECIPIENT_COPY)).toBeTruthy();
	expect(within(dialog).queryByText(EXPLICIT_PRIVATE_ACCESS_COPY)).toBeNull();
	expect(
		within(dialog).getByRole("combobox", { name: "New Space owner" })
			.textContent
	).toContain(defaultSuccessor.profileName);
	expect(mocks.prepare).not.toHaveBeenCalled();
	expect(mocks.remove).not.toHaveBeenCalled();
	fireEvent.click(
		within(dialog).getByRole("button", { name: "Remove member" })
	);
	await waitFor(() => expect(mocks.remove).toHaveBeenCalledOnce());
	expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith({
		memberId: member.memberId,
		organizationId: organization.id,
		spaces: [sharedSpaceTransfer],
		successorUserId: defaultSuccessor.userId,
		useDefaultSuccessor: true,
	});
	expect(mocks.prepare.mock.invocationCallOrder[0]).toBeLessThan(
		mocks.remove.mock.invocationCallOrder[0]
	);
});

it("requires an explicit choice when Core did not offer the organization default", async () => {
	mocks.preview.mockResolvedValue({
		memberId: member.memberId,
		userId: member.userId,
		spaces: [sharedSpaceTransfer],
	});
	renderAction("owner");
	await openMemberRemoval();
	const dialog = await screen.findByRole("alertdialog");
	expect(
		await within(dialog).findByText(EXPLICIT_PRIVATE_ACCESS_COPY)
	).toBeTruthy();
	expect(within(dialog).queryByText(DEFAULT_RECIPIENT_COPY)).toBeNull();
	expect(
		within(dialog).getByRole("button", { name: "Remove member" })
	).toHaveProperty("disabled", true);
	expect(mocks.prepare).not.toHaveBeenCalled();
	expect(mocks.remove).not.toHaveBeenCalled();
});

it("does not remove the member if the reviewed default is no longer eligible", async () => {
	mocks.preview.mockResolvedValue({
		memberId: member.memberId,
		userId: member.userId,
		spaces: [sharedSpaceTransfer],
		defaultSuccessor,
	});
	mocks.prepare.mockRejectedValue(new Error("Space ownership changed."));
	renderAction("admin");
	await openMemberRemoval();
	const dialog = await screen.findByRole("alertdialog");
	await within(dialog).findByText(DEFAULT_RECIPIENT_COPY);
	fireEvent.click(
		within(dialog).getByRole("button", { name: "Remove member" })
	);
	await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
	expect(mocks.prepare).toHaveBeenCalledOnce();
	expect(mocks.remove).not.toHaveBeenCalled();
});
