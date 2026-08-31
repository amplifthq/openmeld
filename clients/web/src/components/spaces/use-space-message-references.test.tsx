import type { OrganizationSpaceDirectoryWithMemberCountsResponse } from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";
import { useSpaceMessageReferences } from "./use-space-message-references";

const { listAccountSpaceItemsMock, listCurrentOrganizationSpacesMock } =
	vi.hoisted(() => ({
		listAccountSpaceItemsMock: vi.fn(),
		listCurrentOrganizationSpacesMock: vi.fn(),
	}));

vi.mock("#/lib/organizations/organization-spaces", () => ({
	listCurrentOrganizationSpaces: listCurrentOrganizationSpacesMock,
}));

vi.mock("#/lib/spaces/account-spaces", () => ({
	listAccountSpaceItems: listAccountSpaceItemsMock,
}));

const ORGANIZATION_ID = "org-1";
const CURRENT_SPACE_ID = "a".repeat(64);
const REFERENCED_SPACE_ID = "b".repeat(64);
const OTHER_REFERENCED_SPACE_ID = "c".repeat(64);

describe("useSpaceMessageReferences", () => {
	beforeEach(() => {
		listAccountSpaceItemsMock.mockResolvedValue(createEmptyAccountSpaces());
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		listAccountSpaceItemsMock.mockReset();
		listCurrentOrganizationSpacesMock.mockReset();
	});

	it("returns only references proven by the current Space or Organization directory", async () => {
		listCurrentOrganizationSpacesMock.mockResolvedValue(
			createDirectoryResponse()
		);

		renderReferenceHarness({
			messageTexts: [
				`Current /spaces/${CURRENT_SPACE_ID}`,
				`Target /spaces/${REFERENCED_SPACE_ID}`,
			],
		});

		expect(screen.getByTestId(CURRENT_SPACE_ID).textContent).toBe(
			"Current Space"
		);
		await waitFor(() => {
			expect(screen.getByTestId(REFERENCED_SPACE_ID).textContent).toBe(
				"Launch Planning"
			);
		});
		expect(screen.getByTestId(REFERENCED_SPACE_ID).dataset.href).toBe(
			`/o/acme/spaces/${REFERENCED_SPACE_ID}?profileId=profile-1`
		);
		expect(listCurrentOrganizationSpacesMock).toHaveBeenCalledTimes(1);
	});

	it("renders an authenticated App link while reference details are loading", () => {
		listCurrentOrganizationSpacesMock.mockReturnValue(
			new Promise(() => undefined)
		);
		listAccountSpaceItemsMock.mockReturnValue(new Promise(() => undefined));

		renderReferenceHarness({
			messageTexts: [`Target /spaces/${REFERENCED_SPACE_ID}`],
		});

		const reference = screen.getByTestId(REFERENCED_SPACE_ID);
		expect(reference.dataset.href).toBe(
			`/o/acme/spaces/${REFERENCED_SPACE_ID}?profileId=profile-1`
		);
		expect(reference.textContent).toBe("");
	});

	it("resolves a joined Space from the account-wide access projection", async () => {
		listCurrentOrganizationSpacesMock.mockResolvedValue({
			...createDirectoryResponse(),
			spaces: [],
		});
		listAccountSpaceItemsMock.mockResolvedValue({
			...createEmptyAccountSpaces(),
			spaceItems: [createAccountSpaceItem()],
		});

		renderReferenceHarness({
			messageTexts: [`Target /spaces/${REFERENCED_SPACE_ID}`],
		});

		await waitFor(() => {
			expect(screen.getByTestId(REFERENCED_SPACE_ID).textContent).toBe(
				"Launch Planning"
			);
		});
	});

	it("keeps a cached account Space name when its refresh fails", async () => {
		const onCommit = vi.fn();
		listCurrentOrganizationSpacesMock.mockResolvedValue({
			...createDirectoryResponse(),
			spaces: [],
		});
		listAccountSpaceItemsMock
			.mockResolvedValueOnce({
				...createEmptyAccountSpaces(),
				spaceItems: [createAccountSpaceItem()],
			})
			.mockRejectedValueOnce(
				Object.assign(new Error("Account Space refresh failed"), {
					code: "gateway.invalid_response",
				})
			);
		const queryClient = createTestQueryClient();

		renderReferenceHarness(
			{
				messageTexts: [`Target /spaces/${REFERENCED_SPACE_ID}`],
				onCommit,
			},
			queryClient
		);
		await waitFor(() => {
			expect(screen.getByTestId(REFERENCED_SPACE_ID).textContent).toBe(
				"Launch Planning"
			);
		});
		const commitCountBeforeRefresh = onCommit.mock.calls.length;

		await act(async () => {
			await queryClient.refetchQueries({
				queryKey: accountSpaceQueryKeys.items("profile-1", "account"),
			});
		});
		expect(
			queryClient.getQueryState(
				accountSpaceQueryKeys.items("profile-1", "account")
			)?.status
		).toBe("error");
		await waitFor(() => {
			expect(onCommit.mock.calls.length).toBeGreaterThan(
				commitCountBeforeRefresh
			);
		});
		expect(screen.getByTestId(REFERENCED_SPACE_ID).textContent).toBe(
			"Launch Planning"
		);
	});

	it("refreshes a cached directory at most once for new missing references inside the cooldown", async () => {
		const queryClient = createTestQueryClient();
		const emptyDirectory = {
			...createDirectoryResponse(),
			spaces: [],
		};
		queryClient.setQueryData(
			organizationQueryKeys.spaces(ORGANIZATION_ID),
			emptyDirectory
		);
		listCurrentOrganizationSpacesMock.mockResolvedValue(emptyDirectory);

		const view = renderReferenceHarness(
			{ messageTexts: [`Target /spaces/${REFERENCED_SPACE_ID}`] },
			queryClient
		);

		await waitFor(() => {
			expect(listCurrentOrganizationSpacesMock).toHaveBeenCalledTimes(1);
		});
		expect(screen.getByTestId(REFERENCED_SPACE_ID).textContent).toBe("");

		view.rerenderMessages([
			`Target /spaces/${REFERENCED_SPACE_ID}`,
			`Another /spaces/${OTHER_REFERENCED_SPACE_ID}`,
		]);
		await Promise.resolve();

		expect(listCurrentOrganizationSpacesMock).toHaveBeenCalledTimes(1);
	});

	it("performs one bounded refresh when the initial directory projection is stale", async () => {
		const emptyDirectory = {
			...createDirectoryResponse(),
			spaces: [],
		};
		listCurrentOrganizationSpacesMock
			.mockResolvedValueOnce(emptyDirectory)
			.mockResolvedValueOnce(createDirectoryResponse());

		renderReferenceHarness({
			messageTexts: [`Target /spaces/${REFERENCED_SPACE_ID}`],
		});

		await waitFor(() => {
			expect(listCurrentOrganizationSpacesMock).toHaveBeenCalledTimes(2);
		});
		expect(screen.getByTestId(REFERENCED_SPACE_ID).textContent).toBe(
			"Launch Planning"
		);
	});

	it("logs a manual directory refresh failure through TanStack Query", async () => {
		const queryClient = createTestQueryClient();
		queryClient.setQueryData(organizationQueryKeys.spaces(ORGANIZATION_ID), {
			...createDirectoryResponse(),
			spaces: [],
		});
		const error = Object.assign(new Error("Directory unavailable"), {
			code: "organization.membership_required",
		});
		listCurrentOrganizationSpacesMock.mockRejectedValue(error);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		renderReferenceHarness(
			{ messageTexts: [`Target /spaces/${REFERENCED_SPACE_ID}`] },
			queryClient
		);

		await waitFor(() => {
			expect(warn).toHaveBeenCalledWith(
				"Failed to refresh Space references.",
				error
			);
		});
		expect(listCurrentOrganizationSpacesMock).toHaveBeenCalledTimes(1);
	});

	it("does not expose cached directory data without an Organization access context", () => {
		const queryClient = createTestQueryClient();
		queryClient.setQueryData(
			organizationQueryKeys.spaces(""),
			createDirectoryResponse()
		);

		renderReferenceHarness(
			{
				accountProfileId: null,
				messageTexts: [`Target /spaces/${REFERENCED_SPACE_ID}`],
				organizationId: null,
			},
			queryClient
		);

		expect(screen.queryByTestId(REFERENCED_SPACE_ID)).toBeNull();
		expect(listCurrentOrganizationSpacesMock).not.toHaveBeenCalled();
		expect(listAccountSpaceItemsMock).not.toHaveBeenCalled();
	});
});

function ReferenceHarness(input: {
	accountProfileId: string | null;
	messageTexts: readonly string[];
	onCommit?: () => void;
	organizationId: string | null;
}) {
	useEffect(() => {
		input.onCommit?.();
	});
	const references = useSpaceMessageReferences({
		accountProfileId: input.accountProfileId,
		currentSpace: { name: "Current Space", spaceId: CURRENT_SPACE_ID },
		messageTexts: input.messageTexts,
		organizationId: input.organizationId,
		organizationSlug: input.organizationId ? "acme" : null,
	});

	return (
		<>
			{[...references.values()].map((reference) => (
				<output
					data-href={reference.href}
					data-testid={reference.spaceId}
					key={reference.spaceId}
				>
					{reference.name}
				</output>
			))}
		</>
	);
}

function renderReferenceHarness(
	input: {
		accountProfileId?: string | null;
		messageTexts: readonly string[];
		onCommit?: () => void;
		organizationId?: string | null;
	},
	queryClient = createTestQueryClient()
) {
	const organizationId =
		input.organizationId === undefined ? ORGANIZATION_ID : input.organizationId;
	const accountProfileId =
		input.accountProfileId === undefined ? "profile-1" : input.accountProfileId;
	const renderHarness = (messageTexts: readonly string[]) => (
		<QueryClientProvider client={queryClient}>
			<ReferenceHarness
				accountProfileId={accountProfileId}
				messageTexts={messageTexts}
				onCommit={input.onCommit}
				organizationId={organizationId}
			/>
		</QueryClientProvider>
	);
	const view = render(renderHarness(input.messageTexts));

	return {
		rerenderMessages(messageTexts: readonly string[]) {
			view.rerender(renderHarness(messageTexts));
		},
	};
}

function createTestQueryClient(): QueryClient {
	return new QueryClient({
		defaultOptions: {
			queries: {
				gcTime: Number.POSITIVE_INFINITY,
				retry: false,
			},
		},
	});
}

function createDirectoryResponse(): OrganizationSpaceDirectoryWithMemberCountsResponse {
	return {
		generatedAt: "2026-07-10T00:00:00.000Z",
		organizationId: ORGANIZATION_ID,
		spaces: [
			{
				activeMemberCount: 1,
				joined: true,
				lastJoinedAt: "2026-07-10T00:00:00.000Z",
				name: "Launch Planning",
				organizationId: ORGANIZATION_ID,
				spaceCreatedAt: "2026-07-10T00:00:00.000Z",
				spaceId: REFERENCED_SPACE_ID,
				spaceUpdatedAt: "2026-07-10T00:00:00.000Z",
				updatedAt: "2026-07-10T00:00:00.000Z",
				visibility: "private",
			},
		],
	};
}

function createEmptyAccountSpaces() {
	return {
		pinnedItems: [],
		recentlyDeletedItems: [],
		spaceItems: [],
	};
}

function createAccountSpaceItem() {
	return {
		activeAgentCount: null,
		activeHumanCount: null,
		activeMemberCount: null,
		joinedProfiles: [
			{
				lastJoinedAt: "2026-07-10T00:00:00.000Z",
				pinnedAt: null,
				profileId: "profile-1",
				profileName: "Felix",
			},
		],
		lastJoinedAt: "2026-07-10T00:00:00.000Z",
		openProfileId: "profile-1",
		openProfileName: "Felix",
		organizationId: "org-2",
		pinnedAt: null,
		pinnedProfileIds: [],
		spaceId: REFERENCED_SPACE_ID,
		spaceName: "Launch Planning",
		spacePurpose: null,
		visibility: "private" as const,
	};
}
