import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateProfileDialog } from "./create-profile-dialog";
import { SpaceCreateProfileButton } from "./space-create-profile-button";

type CreateProfileDialogProps = ComponentProps<typeof CreateProfileDialog>;

const createProfileDialogMock = vi.hoisted(() =>
	vi.fn((_props: CreateProfileDialogProps) => null)
);
const useAppOrganizationMock = vi.hoisted(() => vi.fn());
const useLocalAgentRecoveryControllerMock = vi.hoisted(() => vi.fn());

vi.mock("./create-profile-dialog", () => ({
	CreateProfileDialog: createProfileDialogMock,
}));

vi.mock("#/components/agents/use-local-agent-recovery-controller", () => ({
	useLocalAgentRecoveryController: (
		...args: Parameters<typeof useLocalAgentRecoveryControllerMock>
	) => useLocalAgentRecoveryControllerMock(...args),
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => useAppOrganizationMock(),
}));

function renderSpaceCreateProfileButton() {
	render(
		<SpaceCreateProfileButton
			orgSlug="acme"
			spaceId="space-123"
			spaceName="Design Room"
		/>
	);
	fireEvent.click(screen.getByRole("button", { name: "Create Agent" }));
	const dialogProps = createProfileDialogMock.mock.calls.at(-1)?.[0];
	if (!dialogProps) {
		throw new Error("CreateProfileDialog was not rendered.");
	}
	return dialogProps;
}

describe("SpaceCreateProfileButton", () => {
	beforeEach(() => {
		createProfileDialogMock.mockClear();
		useLocalAgentRecoveryControllerMock.mockReset().mockReturnValue({
			deviceId: "device-123",
			runtimeLane: "dev-local",
			storageScope: "scope-test",
		});
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("keeps organization Space profile creation scoped to the current organization", () => {
		useAppOrganizationMock.mockReturnValue({
			activeOrganization: null,
			currentOrganization: {
				id: "org-123",
				isPersonal: false,
				name: "Acme",
				slug: "acme",
			},
			organizations: [],
		});

		const dialogProps = renderSpaceCreateProfileButton();

		expect(dialogProps).toEqual(
			expect.objectContaining({
				organizationId: "org-123",
				orgSlug: "acme",
				open: true,
				spaceContext: {
					spaceId: "space-123",
					spaceName: "Design Room",
				},
			})
		);
	});

	it("keeps personal Space profile creation scoped to the Personal Workspace", () => {
		useAppOrganizationMock.mockReturnValue({
			activeOrganization: null,
			currentOrganization: {
				id: "personal-123",
				isPersonal: true,
				name: "Felix",
				slug: "felix",
			},
			organizations: [],
		});

		const dialogProps = renderSpaceCreateProfileButton();

		expect(dialogProps.organizationId).toBe("personal-123");
		expect(dialogProps.spaceContext).toEqual({
			spaceId: "space-123",
			spaceName: "Design Room",
		});
	});
});
