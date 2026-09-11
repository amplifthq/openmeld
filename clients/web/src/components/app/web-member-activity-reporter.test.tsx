import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { WebMemberActivityReporter } from "./web-member-activity-reporter";

const recordWebActivityMock = vi.hoisted(() => vi.fn());
const recordPresenceMock = vi.hoisted(() => vi.fn());
vi.mock("#/lib/organizations/organization-member-presence", () => ({
	recordCurrentOrganizationMemberPresence: recordPresenceMock,
	memberPresenceQueryKey: (id: string) => [
		"organization",
		id,
		"member-presence",
	],
}));
beforeEach(() => {
	vi.spyOn(document, "hasFocus").mockReturnValue(true);
	recordPresenceMock.mockResolvedValue({
		organizationId: "org-1",
		userId: "user-1",
	});
});

vi.mock("#/lib/organizations/organization-member-activity", () => ({
	recordCurrentOrganizationWebActivity: recordWebActivityMock,
}));

afterEach(() => {
	cleanup();
	recordWebActivityMock.mockReset();
	recordPresenceMock.mockReset();
	vi.restoreAllMocks();
});

describe("WebMemberActivityReporter", () => {
	it("stops online and historical activity after five idle minutes, then reports foreground return", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-09-10T00:00:00Z"));
		vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
		recordWebActivityMock.mockResolvedValue({
			organizationId: "org-1",
			userId: "user-1",
			lastActiveAt: new Date().toISOString(),
		});
		const client = new QueryClient();
		const view = renderWithQueryClient(
			<WebMemberActivityReporter
				currentUserId="user-1"
				organizationId="org-1"
			/>,
			client
		);
		try {
			await act(() => vi.advanceTimersByTimeAsync(300_000));
			expect(recordWebActivityMock).toHaveBeenCalledTimes(1);
			expect(recordPresenceMock).toHaveBeenLastCalledWith(
				"org-1",
				expect.objectContaining({ foreground: false, interaction: false })
			);
			const count = recordPresenceMock.mock.calls.length;
			await act(() => vi.advanceTimersByTimeAsync(120_000));
			expect(recordPresenceMock).toHaveBeenCalledTimes(count);
			await act(async () => {
				window.dispatchEvent(new Event("focus"));
				await vi.advanceTimersByTimeAsync(0);
			});
			expect(recordPresenceMock).toHaveBeenLastCalledWith(
				"org-1",
				expect.objectContaining({ foreground: true, interaction: true })
			);
			expect(recordWebActivityMock).toHaveBeenCalledTimes(2);
		} finally {
			view.unmount();
			client.clear();
			vi.useRealTimers();
		}
	});
	it("reports the visible Space but never advances visits from a background tab", async () => {
		vi.useFakeTimers();
		let visibility: DocumentVisibilityState = "hidden";
		vi.spyOn(document, "visibilityState", "get").mockImplementation(
			() => visibility
		);
		recordWebActivityMock.mockResolvedValue({
			organizationId: "org-1",
			userId: "user-1",
			lastActiveAt: "2026-09-05T00:00:00.000Z",
		});
		const client = new QueryClient();
		const view = renderWithQueryClient(
			<WebMemberActivityReporter
				currentUserId="user-1"
				organizationId="org-1"
				spaceId="space-a"
			/>,
			client
		);
		try {
			await act(async () => {
				await vi.advanceTimersByTimeAsync(600_000);
			});
			expect(recordWebActivityMock).not.toHaveBeenCalled();
			visibility = "visible";
			await act(async () => {
				document.dispatchEvent(new Event("visibilitychange"));
				await vi.advanceTimersByTimeAsync(0);
			});
			expect(recordWebActivityMock).toHaveBeenCalledWith({
				organizationId: "org-1",
				spaceId: "space-a",
			});
			visibility = "hidden";
			await act(async () => {
				await vi.advanceTimersByTimeAsync(600_000);
			});
			expect(recordWebActivityMock).toHaveBeenCalledTimes(1);
		} finally {
			view.unmount();
			client.clear();
			vi.useRealTimers();
		}
	});

	it("records entry into the Web app and updates an existing People directory", async () => {
		const queryClient = new QueryClient();
		const directory = {
			agentProfiles: [],
			generatedAt: "2026-08-28T00:00:00.000Z",
			members: [
				{
					humanProfile: null,
					joinedAt: "2026-08-01T00:00:00.000Z",
					lastActiveAt: "2026-08-28T00:00:00.000Z",
					memberId: "member-1",
					organizationId: "org-1",
					role: "owner",
					user: {
						email: "felix@example.com",
						id: "user-1",
						image: null,
						name: "Felix",
					},
					userId: "user-1",
				},
			],
			organizationId: "org-1",
		};
		queryClient.setQueryData(
			organizationQueryKeys.directory("org-1"),
			directory
		);
		queryClient.setQueryData(
			organizationQueryKeys.profileDirectory("org-1"),
			directory
		);
		recordWebActivityMock.mockResolvedValue({
			lastActiveAt: "2026-08-28T03:00:00.000Z",
			organizationId: "org-1",
			userId: "user-1",
		});

		renderWithQueryClient(
			<WebMemberActivityReporter
				currentUserId="user-1"
				organizationId="org-1"
			/>,
			queryClient
		);

		await waitFor(() => {
			expect(recordWebActivityMock).toHaveBeenCalledWith({
				organizationId: "org-1",
			});
		});
		expect(
			queryClient.getQueryData<{
				members: Array<{ lastActiveAt?: string }>;
			}>(organizationQueryKeys.directory("org-1"))?.members[0]?.lastActiveAt
		).toBe("2026-08-28T03:00:00.000Z");
		expect(
			queryClient.getQueryData<{
				members: Array<{ lastActiveAt?: string }>;
			}>(organizationQueryKeys.profileDirectory("org-1"))?.members[0]
				?.lastActiveAt
		).toBe("2026-08-28T03:00:00.000Z");
	});
});

function renderWithQueryClient(children: ReactNode, queryClient: QueryClient) {
	return render(
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}
