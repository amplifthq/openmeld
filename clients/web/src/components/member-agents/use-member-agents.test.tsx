import {
	type GetMemberAgentPresenceResponse,
	MEMBER_AGENT_DIRECT_MESSAGE_SESSIONS_ROUTE,
	MEMBER_AGENT_PRESENCE_ROUTE,
} from "@openmeld/schemas";
import type { OrganizationProfileDirectoryResponse } from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { memberAgentQueryKeys } from "#/query/organizations/member-agents";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";
import {
	MIGRATED_LISTING,
	MIGRATED_PROFILES,
	OWNER_USER_ID,
} from "#/test-support/member-agent-fixtures";
import { useMemberAgentDirectory } from "./use-member-agent-directory";
import {
	useArchivedMemberAgentSessionIds,
	useMemberAgentIndex,
	useMemberAgentSessionTitles,
} from "./use-member-agents";

const ORGANIZATION_ID = "org-test";

vi.mock("#/lib/member-agents/member-agents-feature", () => ({
	isMemberAgentsEnabled: () => true,
}));
vi.mock("#/lib/organizations/organization-context", () => {
	const value = {
		currentUserId: "user-felix",
		currentOrganization: { id: "org-test", slug: "test", name: "Test" },
	};
	return {
		useAppOrganization: () => value,
		useOptionalAppOrganization: () => value,
	};
});
const requestJson = vi.fn();
vi.mock("#/lib/openmeld-api/client", () => ({
	createOrganizationScopedWebOpenMeldApiFoundation: () => ({ requestJson }),
}));

afterEach(() => {
	cleanup();
	requestJson.mockReset();
});

function seededClient() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	client.setQueryData(
		memberAgentQueryKeys.all(ORGANIZATION_ID),
		MIGRATED_LISTING
	);
	client.setQueryData(
		organizationQueryKeys.profileIdentityDirectory(ORGANIZATION_ID),
		{
			organizationId: ORGANIZATION_ID,
			generatedAt: "2026-10-21T00:00:00.000Z",
			members: [
				{
					memberId: "member-felix",
					organizationId: ORGANIZATION_ID,
					userId: OWNER_USER_ID,
					role: "owner",
					joinedAt: "2026-08-01T00:00:00.000Z",
					user: {
						id: OWNER_USER_ID,
						name: "Felix",
						email: "felix@example.com",
						image: null,
					},
					humanProfile: {
						profileId: "human-felix",
						profileName: "Felix Lu",
						profileHandle: "felix",
						status: "active",
					},
				},
			],
			agentProfiles: [],
		} satisfies OrganizationProfileDirectoryResponse
	);
	client.setQueryData(accountSpaceQueryKeys.items("human-felix", "account"), {
		pinnedItems: [],
		spaceItems: [],
	});
	return client;
}

function wrapperFor(client: QueryClient) {
	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
}

const NO_SESSIONS = {
	generatedAt: "2026-10-21T00:00:00.000Z",
	organizationId: ORGANIZATION_ID,
	memberProfileId: "human-felix",
	sessions: [],
	nextCursor: null,
};

function presenceOf(
	state: GetMemberAgentPresenceResponse["memberAgents"][number]["state"]
): GetMemberAgentPresenceResponse {
	return {
		ok: true,
		organizationId: ORGANIZATION_ID,
		generatedAt: "2026-10-21T00:00:00.000Z",
		memberAgents: [
			{
				memberAgentId: "ma-claude",
				harnessKind: "claude-code",
				state,
				computers: [{ openMeldServiceRuntimeId: "runtime-mac", online: true }],
				profiles: [
					{
						openMeldProfileId: "agt-claude-default",
						wakeAvailability: state === "available" ? "available" : "checking",
					},
				],
				workload: { status: "ready", runningCount: 0, queuedCount: 0 },
			},
		],
	};
}

/** Answers each presence read with the next result; Sessions read empty. */
function answerPresence(results: (GetMemberAgentPresenceResponse | Error)[]) {
	requestJson.mockImplementation(({ url }: { url: string }) => {
		if (url.startsWith(MEMBER_AGENT_PRESENCE_ROUTE)) {
			const next = results.shift();
			return next instanceof Error || next === undefined
				? Promise.reject(next ?? new Error("no more presence answers"))
				: Promise.resolve(next);
		}
		return Promise.resolve(NO_SESSIONS);
	});
}

function useClaudeState() {
	const directory = useMemberAgentDirectory({
		profiles: MIGRATED_PROFILES,
		runtimeByProfileId: new Map(),
	});
	return directory?.rows.find((row) => row.memberAgentId === "ma-claude")
		?.presence.state;
}

function useSidebarSessionReads() {
	const memberAgents = useMemberAgentIndex();
	return {
		archived: useArchivedMemberAgentSessionIds(memberAgents),
		titles: useMemberAgentSessionTitles(memberAgents),
	};
}

describe("MemberAgent Session reads", () => {
	it("reads every MemberAgent Session in one request, not one per Profile", async () => {
		requestJson.mockResolvedValue({
			generatedAt: "2026-10-21T00:00:00.000Z",
			organizationId: ORGANIZATION_ID,
			memberProfileId: "human-felix",
			sessions: [
				{
					spaceId: "space-claude-1",
					agentProfileId: "agt-claude-default",
					name: "Release notes",
					archivedAt: null,
				},
				{
					spaceId: "space-claude-2",
					agentProfileId: "agt-claude-reviewer",
					name: null,
					archivedAt: "2026-10-20T00:00:00.000Z",
				},
				{
					spaceId: "space-codex-1",
					agentProfileId: "agt-codex",
					name: "Fix flaky test",
					archivedAt: null,
				},
				// A Profile no longer in the member's listing is ignored.
				{
					spaceId: "space-unlisted",
					agentProfileId: "agt-unlisted",
					name: "Old",
					archivedAt: "2026-10-01T00:00:00.000Z",
				},
			],
			nextCursor: null,
		});
		const client = seededClient();
		const { result } = renderHook(() => useSidebarSessionReads(), {
			wrapper: ({ children }: { children: ReactNode }) => (
				<QueryClientProvider client={client}>{children}</QueryClientProvider>
			),
		});

		await waitFor(() =>
			expect(result.current.titles.get("space-codex-1")).toBe("Fix flaky test")
		);
		expect([...result.current.archived]).toEqual(["space-claude-2"]);
		expect(Object.fromEntries(result.current.titles)).toEqual({
			"space-claude-1": "Release notes",
			"space-claude-2": "New chat",
			"space-codex-1": "Fix flaky test",
		});
		// Three Profiles, one request; no per-Profile Session list.
		const urls = requestJson.mock.calls.map(([call]) => String(call.url));
		expect(urls).toHaveLength(1);
		expect(
			urls[0]?.startsWith(MEMBER_AGENT_DIRECT_MESSAGE_SESSIONS_ROUTE)
		).toBe(true);
		expect(urls.some((url) => url.includes("agentProfileId="))).toBe(false);
	});
});

describe("MemberAgent presence while it refreshes", () => {
	it("keeps the last known state through a failed refresh", async () => {
		answerPresence([
			presenceOf("available"),
			new Error("member_agents.presence_unavailable"),
		]);
		const client = seededClient();
		const { result } = renderHook(() => useClaudeState(), {
			wrapper: wrapperFor(client),
		});
		await waitFor(() => expect(result.current).toBe("available"));

		await act(async () => {
			await client.refetchQueries({
				queryKey: memberAgentQueryKeys.presence(ORGANIZATION_ID),
			});
		});

		expect(
			client.getQueryState(memberAgentQueryKeys.presence(ORGANIZATION_ID))
				?.status
		).toBe("error");
		expect(result.current).toBe("available");
	});

	it("keeps the last known state while a refresh is in flight", async () => {
		let answer: (value: GetMemberAgentPresenceResponse) => void = () => {
			throw new Error("presence refresh never started");
		};
		answerPresence([presenceOf("available")]);
		const client = seededClient();
		const { result } = renderHook(() => useClaudeState(), {
			wrapper: wrapperFor(client),
		});
		await waitFor(() => expect(result.current).toBe("available"));
		requestJson.mockImplementation(({ url }: { url: string }) =>
			url.startsWith(MEMBER_AGENT_PRESENCE_ROUTE)
				? new Promise((resolve) => {
						answer = resolve;
					})
				: Promise.resolve(NO_SESSIONS)
		);

		act(() => {
			client
				.invalidateQueries({
					queryKey: memberAgentQueryKeys.presence(ORGANIZATION_ID),
				})
				.catch(() => undefined);
		});
		await waitFor(() =>
			expect(
				client.getQueryState(memberAgentQueryKeys.presence(ORGANIZATION_ID))
					?.fetchStatus
			).toBe("fetching")
		);
		expect(result.current).toBe("available");

		// A newer answer replaces it, Checking included.
		act(() => {
			answer(presenceOf("checking"));
		});
		await waitFor(() => expect(result.current).toBe("checking"));
	});

	it("shows Checking only while no state has been read yet", async () => {
		answerPresence([new Error("member_agents.presence_unavailable")]);
		const client = seededClient();
		client.setDefaultOptions({ queries: { retry: false } });
		const { result } = renderHook(() => useClaudeState(), {
			wrapper: wrapperFor(client),
		});
		await waitFor(() =>
			expect(
				client.getQueryState(memberAgentQueryKeys.presence(ORGANIZATION_ID))
					?.status
			).toBe("error")
		);
		expect(result.current).toBe("checking");
	});
});
