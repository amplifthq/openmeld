import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { messageChannelQueryKeys } from "#/query/organizations/message-channels";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import { useLarkPlatformChannelManagement } from "./use-lark-platform-channel-management";

const api = vi.hoisted(() => ({
	beginRegistration: vi.fn(),
	disconnect: vi.fn(),
	pollRegistration: vi.fn(),
}));

vi.mock("#/lib/organizations/message-channels", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("#/lib/organizations/message-channels")
	>()),
	beginCurrentOrganizationLarkPlatformRegistration: api.beginRegistration,
	disconnectCurrentOrganizationLarkPlatform: api.disconnect,
	pollCurrentOrganizationLarkPlatformRegistration: api.pollRegistration,
}));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("useLarkPlatformChannelManagement", () => {
	it("explicitly restarts the same provider after resume fails without starting automatically", async () => {
		const registration = {
			organizationId: "org_1",
			connection: null,
			attempt: {
				id: "attempt_restarted",
				provider: "lark" as const,
				status: "pending_registration" as const,
				reasonCode: null,
				registrationUrl:
					"https://open.larksuite.com/page/launcher?user_code=test-code",
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
				nextPollAt: new Date(Date.now() + 5000).toISOString(),
			},
		};
		api.beginRegistration
			.mockRejectedValueOnce(new Error("Saved setup could not be read."))
			.mockResolvedValueOnce(registration);
		api.pollRegistration.mockResolvedValue(registration);
		const { result } = renderHook(
			() =>
				useLarkPlatformChannelManagement({
					connections: [],
					organizationId: "org_1",
				}),
			{ wrapper: TestQueryClientProvider }
		);
		act(() => result.current.manage("lark"));
		await waitFor(() => expect(result.current.open).toBe(true));
		expect(result.current.registration).toBeNull();
		expect(result.current.errorMessage).toBeTruthy();
		expect(api.beginRegistration).toHaveBeenCalledTimes(1);
		act(() => result.current.startOver());
		await waitFor(() =>
			expect(result.current.registration?.attempt.id).toBe("attempt_restarted")
		);
		expect(api.beginRegistration).toHaveBeenLastCalledWith({
			organizationId: "org_1",
			provider: "lark",
			mode: "restart",
		});
		expect(result.current.errorMessage).toBeNull();
	});

	it("repairs a saved app through the explicit repair mode", async () => {
		const registration = {
			attempt: {
				expiresAt: "2026-07-28T00:00:00.000Z",
				id: "attempt_1",
				nextPollAt: "2026-07-28T00:00:00.000Z",
				provider: "lark" as const,
				reasonCode: null,
				registrationUrl: null,
				status: "configuring" as const,
			},
			connection: repairConnection("configuring"),
			organizationId: "org_1",
		};
		api.beginRegistration.mockResolvedValue(registration);
		api.pollRegistration.mockResolvedValue(registration);
		const { result } = renderHook(
			() =>
				useLarkPlatformChannelManagement({
					connections: [repairConnection("repair_required")],
					organizationId: "org_1",
				}),
			{ wrapper: TestQueryClientProvider }
		);

		act(() => result.current.manage("lark"));
		expect(result.current.open).toBe(true);
		act(() => result.current.repair());

		await waitFor(() =>
			expect(api.beginRegistration).toHaveBeenCalledWith({
				mode: "repair",
				organizationId: "org_1",
				provider: "lark",
			})
		);
		await waitFor(() =>
			expect(result.current.registration?.attempt.status).toBe("configuring")
		);
	});

	it("refreshes the channel list when a stale repair request is rejected", async () => {
		const queryClient = createTestQueryClient();
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
		api.beginRegistration.mockRejectedValue(
			new Error("This channel is already connected.")
		);
		const wrapper = ({ children }: { children: ReactNode }) => (
			<TestQueryClientProvider queryClient={queryClient}>
				{children}
			</TestQueryClientProvider>
		);
		const { result } = renderHook(
			() =>
				useLarkPlatformChannelManagement({
					connections: [repairConnection("repair_required")],
					organizationId: "org_1",
				}),
			{ wrapper }
		);

		act(() => result.current.manage("lark"));
		act(() => result.current.repair());

		await waitFor(() =>
			expect(invalidateQueries).toHaveBeenCalledWith({
				queryKey: messageChannelQueryKeys.list("org_1"),
			})
		);
	});

	it("removes a disconnected channel immediately and restores it on failure", async () => {
		const queryClient = createTestQueryClient();
		const queryKey = messageChannelQueryKeys.list("org_1");
		const connection = connectedLarkConnection();
		queryClient.setQueryData(queryKey, {
			availableLarkPlatformProviders: ["lark"],
			connections: [connection],
			organizationId: "org_1",
		});
		let rejectDisconnect: ((error: Error) => void) | undefined;
		api.disconnect.mockReturnValue(
			new Promise((_resolve, reject) => {
				rejectDisconnect = reject;
			})
		);
		const wrapper = ({ children }: { children: ReactNode }) => (
			<TestQueryClientProvider queryClient={queryClient}>
				{children}
			</TestQueryClientProvider>
		);
		const { result } = renderHook(
			() =>
				useLarkPlatformChannelManagement({
					connections: [connection],
					organizationId: "org_1",
				}),
			{ wrapper }
		);

		act(() => result.current.manage("lark"));
		act(() => result.current.disconnect());

		await waitFor(() =>
			expect(
				queryClient.getQueryData<{
					connections: unknown[];
				}>(queryKey)?.connections
			).toHaveLength(0)
		);

		act(() => rejectDisconnect?.(new Error("Disconnect failed.")));

		await waitFor(() =>
			expect(
				queryClient.getQueryData<{
					connections: unknown[];
				}>(queryKey)?.connections
			).toEqual([connection])
		);
	});
});

function repairConnection(status: "configuring" | "repair_required") {
	return {
		externalAccountId: "cli_existing_app",
		externalAccountName: null,
		grantedCapabilityGroups: [],
		id: "connection_1",
		lastVerifiedAt: null,
		permissionBundleVersion: "channel-only-2026-07-18",
		provider: "lark" as const,
		reasonCode:
			status === "repair_required" ? "lark.registration_expired" : null,
		status,
		transport: "webhook" as const,
	};
}

function connectedLarkConnection() {
	return {
		externalAccountId: "cli_existing_app",
		externalAccountName: "Acme",
		grantedCapabilityGroups: ["messages"],
		id: "connection_1",
		lastVerifiedAt: "2026-07-28T00:00:00.000Z",
		permissionBundleVersion: "channel-only-2026-07-18",
		provider: "lark" as const,
		reasonCode: null,
		status: "connected" as const,
		transport: "webhook" as const,
	};
}
