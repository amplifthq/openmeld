import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { EMPTY_CHAT_PREFERENCES } from "#/lib/organizations/center-agent-chat-preferences";
import { accountSidebarQueryKey } from "#/query/account/sidebar-preferences";
import { centerAgentSessionsQueryOptions } from "#/query/organizations/center-agent-sessions";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";
import { fixtureSpace } from "#/test-support/conversation-sidebar-fixture";
import {
	ConversationNamesProvider,
	useConversationNames,
} from "./conversation-names";

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization: { id: "org" },
		currentUserId: "user",
	}),
}));
vi.mock("#/lib/profiles/use-default-human-profile", () => ({
	useDefaultHumanProfile: () => ({
		defaultHumanProfile: { openMeldProfileId: "human" },
	}),
}));
afterEach(cleanup);

it("shares current sidebar data, covers unloaded chats, and reacts to saved names without rewriting Inbox", async () => {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const sidebarKey = accountSidebarQueryKey("user", "org");
	const preferences = {
		...EMPTY_CHAT_PREFERENCES,
		chats: {
			...EMPTY_CHAT_PREFERENCES,
			titles: {
				chat: "Saved chat",
				archived: "Saved older chat",
				converted: "Former DM name",
			},
		},
	};
	client.setQueryData(sidebarKey, { revision: 1, preferences });
	client.setQueryData(
		[...centerAgentSessionsQueryOptions("org", "human").queryKey],
		{
			pages: [
				{
					sessions: [{ spaceId: "chat", name: "Automatic topic" }],
					nextCursor: null,
				},
			],
			pageParams: [undefined],
		}
	);
	client.setQueryData(accountSpaceQueryKeys.items("human", "account"), {
		pinnedItems: [],
		spaceItems: [
			fixtureSpace("space", "Shared current name"),
			fixtureSpace("converted", "Converted Space"),
			{
				...fixtureSpace("foreign", "Private foreign name"),
				organizationId: "other-org",
			},
		],
	});
	client.setQueryData(organizationQueryKeys.profileIdentityDirectory("org"), {
		members: [],
		agentProfiles: [],
	});
	const { result, unmount } = renderHook(useConversationNames, {
		wrapper: ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={client}>
				<ConversationNamesProvider>{children}</ConversationNamesProvider>
			</QueryClientProvider>
		),
	});
	expect(result.current?.names.get("chat")).toEqual({
		name: "Saved chat",
		sourceName: "Automatic topic",
	});
	expect(result.current?.names.get("archived")?.name).toBe("Saved older chat");
	expect(result.current?.names.get("space")?.name).toBe("Shared current name");
	expect(result.current?.names.get("converted")?.name).toBe("Converted Space");
	expect(result.current?.names.has("foreign")).toBe(false);
	act(() =>
		client.setQueryData(sidebarKey, {
			revision: 2,
			preferences: {
				...preferences,
				chats: {
					...preferences.chats,
					titles: { ...preferences.chats.titles, chat: "Renamed again" },
				},
			},
		})
	);
	await waitFor(() =>
		expect(result.current?.names.get("chat")?.name).toBe("Renamed again")
	);
	unmount();
	client.clear();
});
