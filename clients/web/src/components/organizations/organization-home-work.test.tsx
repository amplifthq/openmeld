import { resolveCenterAgentTaskPresentation } from "@openmeld/schemas";
import type {
	AuthProfileView,
	CenterAgentTask,
	CenterAgentTaskStatus,
} from "@openmeld/schemas/types";
import { OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE } from "@openmeld/space";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountSpaceItem } from "#/lib/spaces/account-spaces";
import { OPENMELD_WELCOMING_SPACE_PURPOSE } from "#/lib/spaces/welcoming-space";
import { centerAgentTaskQueryKeys } from "#/query/organizations/center-agent-tasks";
import { startQueryKeys } from "#/query/query-keys";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";
import { OrganizationHomeWork } from "./organization-home-work";

const listAccountSpaceItemsMock = vi.hoisted(() => vi.fn());
const listCurrentCenterAgentTasksMock = vi.hoisted(() => vi.fn());
const listStartProfilesMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		...props
	}: {
		children: ReactNode;
		to: string;
	} & AnchorHTMLAttributes<HTMLAnchorElement>) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

vi.mock("#/components/app/start-flow-state", () => ({
	useStartFlowState: () => ({ storageScope: "user-1" }),
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization: {
			id: "organization-1",
			name: "Amplift",
			slug: "amplift",
		},
	}),
}));

vi.mock("#/lib/organizations/center-agent-tasks", async (importOriginal) => ({
	...(await importOriginal()),
	listCurrentCenterAgentTasks: listCurrentCenterAgentTasksMock,
}));

vi.mock("#/lib/profiles/existing-profiles", () => ({
	listStartProfiles: listStartProfilesMock,
}));

vi.mock("#/lib/spaces/account-spaces", async (importOriginal) => ({
	...(await importOriginal()),
	listAccountSpaceItems: listAccountSpaceItemsMock,
}));

describe("OrganizationHomeWork", () => {
	beforeEach(() => {
		listStartProfilesMock.mockReset().mockResolvedValue([createHumanProfile()]);
		listAccountSpaceItemsMock.mockReset().mockResolvedValue({
			pinnedItems: [],
			spaceItems: [],
		});
		listCurrentCenterAgentTasksMock
			.mockReset()
			.mockImplementation(
				async (input: {
					organizationId: string;
					status?: CenterAgentTaskStatus;
				}) => ({
					nextCursor: null,
					organizationId: input.organizationId,
					tasks:
						input.status === "needs_attention"
							? [
									createTask(
										"needs_attention",
										"Approve the launch brief",
										"task-attention"
									),
								]
							: Array.from({ length: 40 }, (_, index) =>
									createTask(
										"running",
										`Active task ${String(index + 1)}`,
										`task-active-${String(index + 1)}`
									)
								),
				})
			);
	});

	afterEach(cleanup);

	it("loads attention through the canonical status filter instead of trusting the first general page", async () => {
		renderWork();

		expect(await screen.findByText("Approve the launch brief")).toBeTruthy();
		expect(listCurrentCenterAgentTasksMock).toHaveBeenCalledWith(
			expect.objectContaining({ status: "needs_attention" })
		);
		expect(screen.getAllByText("Needs action").length).toBeGreaterThan(0);
	});

	it("shows a retryable Spaces failure when the default profile read fails", async () => {
		listStartProfilesMock.mockRejectedValue(
			Object.assign(new Error("Profiles unavailable."), {
				code: "gateway.invalid_response",
			})
		);

		renderWork();

		expect(await screen.findByText("Couldn’t load Spaces.")).toBeTruthy();
		expect(screen.queryByText("No Spaces yet")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		await waitFor(() => expect(listStartProfilesMock).toHaveBeenCalledTimes(2));
	});

	it("shows a retryable Spaces failure when no default profile exists", async () => {
		listStartProfilesMock.mockResolvedValue([]);

		renderWork();

		expect(await screen.findByText("Couldn’t load Spaces.")).toBeTruthy();
		expect(screen.queryByText("No Spaces yet")).toBeNull();
		expect(listAccountSpaceItemsMock).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		await waitFor(() => expect(listStartProfilesMock).toHaveBeenCalledTimes(2));
	});

	it("keeps cached Spaces but surfaces and retries a failed refresh", async () => {
		listAccountSpaceItemsMock.mockResolvedValueOnce({
			pinnedItems: [],
			spaceItems: [createSpace()],
		});
		const { queryClient } = renderWork();

		expect(await screen.findByText("Launch Planning")).toBeTruthy();

		listAccountSpaceItemsMock.mockRejectedValue(
			new Error("Spaces unavailable.")
		);
		await queryClient.refetchQueries({
			queryKey: accountSpaceQueryKeys.items("human-profile-1", "account"),
		});

		expect(await screen.findByText("Spaces may be out of date.")).toBeTruthy();
		expect(screen.getByText("Launch Planning")).toBeTruthy();

		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [createSpace()],
		});
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));

		await waitFor(() =>
			expect(screen.queryByText("Spaces may be out of date.")).toBeNull()
		);
	});

	it("keeps cached Spaces but surfaces a failed profile refresh", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [createSpace()],
		});
		const { queryClient } = renderWork();

		expect(await screen.findByText("Launch Planning")).toBeTruthy();

		listStartProfilesMock.mockRejectedValue(
			new Error("Profiles refresh failed.")
		);
		await queryClient.refetchQueries({
			queryKey: startQueryKeys.profilesForStorageScope("user-1"),
		});

		expect(await screen.findByText("Spaces may be out of date.")).toBeTruthy();
		expect(screen.getByText("Launch Planning")).toBeTruthy();

		listStartProfilesMock.mockResolvedValue([createHumanProfile()]);
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));

		await waitFor(() =>
			expect(screen.queryByText("Spaces may be out of date.")).toBeNull()
		);
	});

	it("uses the canonical Space classification for the Home preview", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [
				createSpace({
					activeAgentCount: 1,
					activeHumanCount: 1,
					activeMemberCount: 2,
					directMessageConvertedAt: null,
					spaceId: "space-current-dm",
					spaceName: "Current DM",
					spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
				}),
			],
			spaceItems: [
				createSpace({
					directMessageConvertedAt: "2026-08-10T00:00:00.000Z",
					spaceId: "space-converted",
					spaceName: "Converted Planning",
					spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
				}),
				createSpace({
					spaceId: "space-welcome",
					spaceName: "Welcome",
					spacePurpose: OPENMELD_WELCOMING_SPACE_PURPOSE,
				}),
				createSpace(),
			],
		});

		renderWork();

		expect(await screen.findByText("Converted Planning")).toBeTruthy();
		expect(screen.getByText("Launch Planning")).toBeTruthy();
		expect(screen.queryByText("Current DM")).toBeNull();
		expect(screen.queryByText("Welcome")).toBeNull();
	});

	it("keeps cached Tasks but surfaces and retries a failed refresh", async () => {
		const { queryClient } = renderWork();

		expect(await screen.findByText("Approve the launch brief")).toBeTruthy();

		listCurrentCenterAgentTasksMock.mockRejectedValue(
			new Error("Tasks unavailable.")
		);
		await queryClient.refetchQueries({
			queryKey: centerAgentTaskQueryKeys.organization("organization-1"),
		});

		expect(await screen.findByText("Tasks may be out of date.")).toBeTruthy();
		expect(screen.getByText("Approve the launch brief")).toBeTruthy();
		expect(screen.getByText("Unavailable")).toBeTruthy();

		listCurrentCenterAgentTasksMock.mockImplementation(
			async (input: {
				organizationId: string;
				status?: CenterAgentTaskStatus;
			}) => ({
				nextCursor: null,
				organizationId: input.organizationId,
				tasks:
					input.status === "needs_attention"
						? [
								createTask(
									"needs_attention",
									"Approve the launch brief",
									"task-attention"
								),
							]
						: [],
			})
		);
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));

		await waitFor(() =>
			expect(screen.queryByText("Tasks may be out of date.")).toBeNull()
		);
		expect(screen.getAllByText("Needs action").length).toBeGreaterThan(0);
	});
});

function renderWork() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return {
		queryClient,
		...render(
			<QueryClientProvider client={queryClient}>
				<OrganizationHomeWork />
			</QueryClientProvider>
		),
	};
}

function createHumanProfile(): AuthProfileView {
	return {
		createdAt: "2026-08-10T00:00:00.000Z",
		createdByUserId: "user-1",
		creatorProfileId: null,
		isDefault: true,
		lastUsedAt: null,
		managedRole: null,
		ownerUserId: "user-1",
		profileHandle: "felix",
		profileKind: "human",
		profileName: "Felix",
		source: "auth_bootstrap",
		status: "active",
		updatedAt: "2026-08-10T00:00:00.000Z",
		openMeldProfileId: "human-profile-1",
	};
}

function createSpace(
	overrides: Partial<AccountSpaceItem> = {}
): AccountSpaceItem {
	return {
		activeAgentCount: 1,
		activeHumanCount: 2,
		activeMemberCount: 3,
		directMessageConvertedAt: null,
		joinedProfiles: [
			{
				lastJoinedAt: "2026-08-10T00:00:00.000Z",
				pinnedAt: null,
				profileId: "human-profile-1",
				profileName: "Felix",
			},
		],
		lastJoinedAt: "2026-08-10T00:00:00.000Z",
		openProfileId: "human-profile-1",
		openProfileName: "Felix",
		organizationId: "organization-1",
		pinnedAt: null,
		pinnedProfileIds: [],
		spaceId: "space-launch",
		spaceName: "Launch Planning",
		spacePurpose: null,
		visibility: "private",
		...overrides,
	};
}

function createTask(
	status: CenterAgentTaskStatus,
	title: string,
	id: string
): CenterAgentTask {
	return {
		...resolveCenterAgentTaskPresentation(status),
		activeAttemptGeneration: status === "queued" ? null : 1,
		createdAt: "2026-08-10T00:00:00.000Z",
		finishedAt: null,
		goal: title,
		id,
		organizationId: "organization-1",
		origin: { kind: "open_meld" },
		requesterUserId: "user-1",
		status,
		title,
		updatedAt: "2026-08-10T00:01:00.000Z",
		version: 1,
	};
}
