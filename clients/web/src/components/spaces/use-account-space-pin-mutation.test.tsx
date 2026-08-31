import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	AccountSpaceItem,
	AccountSpaceSections,
} from "#/lib/spaces/account-spaces";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";
import { preserveOptimisticAccountSpacePinUpdates } from "./account-space-sections";
import { useAccountSpacePinMutation } from "./use-account-space-pin-mutation";

const { setAccountSpaceItemPinnedMock, toastErrorMock, toastWarningMock } =
	vi.hoisted(() => ({
		setAccountSpaceItemPinnedMock: vi.fn(),
		toastErrorMock: vi.fn(),
		toastWarningMock: vi.fn(),
	}));

vi.mock("#/lib/spaces/account-spaces", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("#/lib/spaces/account-spaces")>();
	return {
		...actual,
		setAccountSpaceItemPinned: (...args: unknown[]) =>
			setAccountSpaceItemPinnedMock(...args),
	};
});

vi.mock("sonner", () => ({
	toast: {
		error: toastErrorMock,
		warning: toastWarningMock,
	},
}));

describe("useAccountSpacePinMutation", () => {
	beforeEach(() => {
		setAccountSpaceItemPinnedMock.mockReset();
		toastErrorMock.mockReset();
		toastWarningMock.mockReset();
	});

	afterEach(() => {
		cleanup();
	});

	it("shares pending state across two controls for the same Space", async () => {
		const item = createAccountSpaceItem({
			spaceId: "space-planning",
			spaceName: "Planning",
		});
		const queryClient = createQueryClient({
			pinnedItems: [],
			spaceItems: [item],
		});
		let resolvePin:
			| ((value: readonly [ReturnType<typeof appliedPinResult>]) => void)
			| undefined;
		setAccountSpaceItemPinnedMock.mockReturnValue(
			new Promise<readonly [ReturnType<typeof appliedPinResult>]>((resolve) => {
				resolvePin = resolve;
			})
		);

		renderWithQueryClient(
			queryClient,
			<>
				<PinControl controlName="Browse" item={item} />
				<PinControl controlName="Sidebar" item={item} />
			</>
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Browse Pin Planning" })
		);

		await waitFor(() => {
			expect(setAccountSpaceItemPinnedMock).toHaveBeenCalledOnce();
			expect(
				(
					screen.getByRole("button", {
						name: "Browse Pin Planning",
					}) as HTMLButtonElement
				).disabled
			).toBe(true);
			expect(
				(
					screen.getByRole("button", {
						name: "Sidebar Pin Planning",
					}) as HTMLButtonElement
				).disabled
			).toBe(true);
		});

		fireEvent.click(
			screen.getByRole("button", { name: "Sidebar Pin Planning" })
		);
		expect(setAccountSpaceItemPinnedMock).toHaveBeenCalledOnce();

		await act(async () => {
			resolvePin?.([appliedPinResult("space-planning")]);
			await Promise.resolve();
		});
		await waitFor(() => {
			expect(
				(
					screen.getByRole("button", {
						name: "Browse Pin Planning",
					}) as HTMLButtonElement
				).disabled
			).toBe(false);
		});
	});

	it("blocks another Space pin update and restores a failed optimistic update", async () => {
		const alpha = createAccountSpaceItem({
			spaceId: "space-alpha",
			spaceName: "Alpha",
		});
		const beta = createAccountSpaceItem({
			spaceId: "space-beta",
			spaceName: "Beta",
		});
		const queryClient = createQueryClient({
			pinnedItems: [],
			spaceItems: [alpha, beta],
		});
		let rejectAlpha: ((error: Error) => void) | undefined;
		setAccountSpaceItemPinnedMock.mockReturnValue(
			new Promise((_resolve, reject) => {
				rejectAlpha = reject;
			})
		);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);

		renderWithQueryClient(
			queryClient,
			<>
				<PinControl controlName="Alpha" item={alpha} />
				<PinControl controlName="Beta" item={beta} />
			</>
		);

		fireEvent.click(screen.getByRole("button", { name: "Alpha Pin Alpha" }));

		await waitFor(() => {
			expect(setAccountSpaceItemPinnedMock).toHaveBeenCalledOnce();
			expect(readSections(queryClient).pinnedItems).toHaveLength(1);
			expect(
				(
					screen.getByRole("button", {
						name: "Beta Pin Beta",
					}) as HTMLButtonElement
				).disabled
			).toBe(true);
		});
		fireEvent.click(screen.getByRole("button", { name: "Beta Pin Beta" }));
		expect(setAccountSpaceItemPinnedMock).toHaveBeenCalledOnce();
		await act(async () => {
			rejectAlpha?.(new Error("Alpha pin failed"));
			await Promise.resolve();
		});

		await waitFor(() => {
			const sections = readSections(queryClient);
			expect(sections.pinnedItems).toHaveLength(0);
			expect(sections.spaceItems.map((item) => item.spaceId)).toContain(
				"space-alpha"
			);
			expect(
				(
					screen.getByRole("button", {
						name: "Beta Pin Beta",
					}) as HTMLButtonElement
				).disabled
			).toBe(false);
		});
		expect(toastErrorMock).toHaveBeenCalledWith(
			"Could not update pinned spaces."
		);
		consoleError.mockRestore();
	});

	it("keeps refreshed owner facts when a pending pin update fails", async () => {
		const item = {
			...createAccountSpaceItem({
				spaceId: "space-planning",
				spaceName: "Planning",
			}),
			lastSeenTs: null,
		};
		const queryClient = createQueryClient({
			pinnedItems: [],
			spaceItems: [item],
		});
		let rejectPin: ((error: Error) => void) | undefined;
		setAccountSpaceItemPinnedMock.mockReturnValue(
			new Promise((_resolve, reject) => {
				rejectPin = reject;
			})
		);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);

		renderWithQueryClient(
			queryClient,
			<PinControl controlName="Sidebar" item={item} />
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Sidebar Pin Planning" })
		);
		await waitFor(() => {
			expect(readSections(queryClient).pinnedItems).toHaveLength(1);
		});

		act(() => {
			const refreshedLastSeenTs = Date.parse("2026-08-31T20:00:00.000Z");
			queryClient.setQueryData<AccountSpaceSections>(
				accountSpaceQueryKeys.items("human-1", "account"),
				{
					pinnedItems: [],
					recentlyDeletedItems: [],
					spaceItems: [
						{
							...item,
							lastSeenTs: refreshedLastSeenTs,
							spaceName: "Planning Renamed",
						},
					],
				}
			);
		});
		expect(readSections(queryClient).pinnedItems[0]).toMatchObject({
			lastSeenTs: Date.parse("2026-08-31T20:00:00.000Z"),
			spaceName: "Planning Renamed",
		});

		await act(async () => {
			rejectPin?.(new Error("Pin failed"));
			await Promise.resolve();
		});

		await waitFor(() => {
			expect(readSections(queryClient).spaceItems[0]).toMatchObject({
				lastSeenTs: Date.parse("2026-08-31T20:00:00.000Z"),
				pinnedAt: null,
				pinnedProfileIds: [],
				spaceName: "Planning Renamed",
			});
		});
		consoleError.mockRestore();
	});
});

function PinControl(input: { controlName: string; item: AccountSpaceItem }) {
	const pinMutation = useAccountSpacePinMutation({
		currentProfileId: "human-1",
	});
	return (
		<button
			disabled={pinMutation.arePinActionsPending}
			onClick={() => pinMutation.toggle(input.item)}
			type="button"
		>
			{input.controlName} Pin {input.item.spaceName}
		</button>
	);
}

function createQueryClient(sections: AccountSpaceSections): QueryClient {
	const queryClient = new QueryClient({
		defaultOptions: {
			mutations: { retry: false },
			queries: {
				retry: false,
				structuralSharing: preserveOptimisticAccountSpacePinUpdates,
			},
		},
	});
	queryClient.setQueryData(
		accountSpaceQueryKeys.items("human-1", "account"),
		sections
	);
	return queryClient;
}

function renderWithQueryClient(queryClient: QueryClient, children: ReactNode) {
	return render(
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}

function readSections(queryClient: QueryClient): AccountSpaceSections {
	const sections = queryClient.getQueryData<AccountSpaceSections>(
		accountSpaceQueryKeys.items("human-1", "account")
	);
	if (!sections) {
		throw new Error("Expected Account Space Index cache data.");
	}
	return sections;
}

function createAccountSpaceItem(input: {
	spaceId: string;
	spaceName: string;
}): AccountSpaceItem {
	return {
		activeAgentCount: null,
		activeHumanCount: null,
		activeMemberCount: 2,
		joinedProfiles: [
			{
				lastJoinedAt: "2026-08-24T00:00:00.000Z",
				pinnedAt: null,
				profileId: "human-1",
				profileName: "Mira",
			},
		],
		lastJoinedAt: "2026-08-24T00:00:00.000Z",
		openProfileId: "human-1",
		openProfileName: "Mira",
		organizationId: "org-acme",
		pinnedAt: null,
		pinnedProfileIds: [],
		spaceId: input.spaceId,
		spaceName: input.spaceName,
		spacePurpose: null,
		visibility: "private",
	};
}

function appliedPinResult(spaceId: string) {
	return {
		item: { spaceId },
		spaceIndexOverlay: { status: "applied" as const },
	};
}
