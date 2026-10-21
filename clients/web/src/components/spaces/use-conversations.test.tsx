import type { AccountSidebarPreferences } from "@openmeld/schemas";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EMPTY_CHAT_PREFERENCES } from "#/lib/organizations/center-agent-chat-preferences";
import { fixtureSpace } from "#/test-support/conversation-sidebar-fixture";
import { useConversations } from "./use-conversations";

const save = vi.fn();
const setPinned = vi.fn();
const saveAsync = vi.fn();
const updateAsync = vi.fn();
function fixture() {
	const preferences = {
		pinned: { sort: "manual" as const, spaceIds: ["hidden-pin"] },
		spaces: { sort: "priority" as const, spaceIds: [] },
		groups: [],
		chats: EMPTY_CHAT_PREFERENCES,
	};
	return {
		org: { id: "org", slug: "test" },
		profileId: "human",
		selected: "release",
		store: {
			preferences,
			save,
			saveAsync,
			updateAsync,
			update: vi.fn(),
			disabled: false,
		},
		preferences: EMPTY_CHAT_PREFERENCES,
		spaces: {
			data: {
				pinnedItems: [],
				spaceItems: [
					{
						...fixtureSpace("release", "Release"),
						openProfileId: "agent-member",
					},
					{
						...fixtureSpace("foreign", "Another organization"),
						organizationId: "other-org",
					},
				],
			},
		},
		chats: [
			{
				spaceId: "session",
				name: "Agent session",
				createdAt: "2026-09-10",
				session: true,
			},
		],
		previews: [{ data: { timestamp: 900, text: "Ready" } }],
		title: () => "My saved title",
		chatPath: () => "/o/test/chats/center-agent?session=session",
		ordinaryAccountItems: [],
		indicators: {
			unreadBySpaceId: new Map(),
			activeWakeSummaryBySpaceId: new Map(),
		},
		inbox: { data: { attention: [] } },
		pin: { setPinned, arePinActionsPending: false },
	};
}
let directMessages: ReturnType<typeof fixture>;
vi.mock("./use-chats", () => ({ useChats: () => directMessages }));
// The last-opened MemberAgent chat is read inside the organization app shell.
vi.mock(
	"#/components/member-agents/member-agent-last-chat",
	async (original) => ({
		...(await original<
			typeof import("#/components/member-agents/member-agent-last-chat")
		>()),
		useMemberAgentLastChatScope: () => null,
	})
);
beforeEach(() => {
	vi.clearAllMocks();
	directMessages = fixture();
	setPinned.mockResolvedValue(true);
	saveAsync.mockResolvedValue(undefined);
	updateAsync.mockImplementation(
		(
			update: (current: AccountSidebarPreferences) => AccountSidebarPreferences
		) => {
			saveAsync(update(directMessages.store.preferences));
			return Promise.resolve();
		}
	);
});
afterEach(cleanup);

it("uses authorized organization rows, the Human Space viewer, and exact session titles and routes", () => {
	const { result } = renderHook(() =>
		useConversations({ currentSpaceId: "release" })
	);
	expect(result.current.conversations.map((item) => item.spaceId)).toEqual([
		"release",
		"session",
	]);
	expect(result.current.conversations[0].url).toContain("profileId=human");
	expect(result.current.conversations[0].url).not.toContain("agent-member");
	expect(result.current.conversations[1]).toMatchObject({
		title: "My saved title",
		url: "/o/test/chats/center-agent?session=session",
		activity: Date.parse("2026-09-10"),
	});
	expect(save).not.toHaveBeenCalled();
	expect(setPinned).not.toHaveBeenCalled();
});
it("uses creation and joining recency for empty conversations without inventing a message", () => {
	directMessages.spaces.data.spaceItems[0] = {
		...fixtureSpace("release", "Release"),
		spaceCreatedAt: "2026-09-12T00:00:00.000Z",
		messagePreview: undefined,
		openProfileId: "agent-member",
	};
	directMessages.previews = [];
	const { result, rerender } = renderHook(() => useConversations({}));
	expect(result.current.conversations.map(({ activity }) => activity)).toEqual([
		Date.parse("2026-09-12T00:00:00.000Z"),
		Date.parse("2026-09-10"),
	]);
	expect(
		result.current
			.sort(result.current.conversations, {
				id: "spaces",
				sort: "recent",
				spaceIds: [],
			})
			.map(({ spaceId }) => spaceId)
	).toEqual(["release", "session"]);
	directMessages.previews = [
		{ data: { timestamp: Date.parse("2026-09-13"), text: "New reply" } },
	];
	rerender();
	expect(
		result.current
			.sort(result.current.conversations, {
				id: "spaces",
				sort: "recent",
				spaceIds: [],
			})
			.map(({ spaceId }) => spaceId)
	).toEqual(["session", "release"]);
});
it("saves ordering independently while canonical pin failure remains owned by the pin mutation", async () => {
	setPinned.mockResolvedValue(false);
	const { result } = renderHook(() => useConversations({}));
	await act(async () => {
		await result.current.move("pinned", "release", []);
	});
	expect(setPinned).toHaveBeenCalledWith(
		expect.objectContaining({ spaceId: "release" }),
		true
	);
	expect(updateAsync).toHaveBeenCalledOnce();
});
it("pins ordinary Spaces through Space Index and preserves hidden ordering preferences", async () => {
	const { result } = renderHook(() => useConversations({}));
	await act(async () => {
		await result.current.move("pinned", "release", []);
	});
	expect(saveAsync).toHaveBeenCalledWith(
		expect.objectContaining({
			pinned: { sort: "manual", spaceIds: ["release", "hidden-pin"] },
		})
	);
});
it("pins sessions through existing chat preferences without writing Space history", async () => {
	const { result } = renderHook(() => useConversations({}));
	await act(async () => {
		await result.current.move("pinned", "session", []);
	});
	expect(setPinned).not.toHaveBeenCalled();
	expect(saveAsync.mock.calls[0][0].chats.pinned.spaceIds).toEqual(["session"]);
});
it("rejects cross-kind moves before any write", async () => {
	const { result } = renderHook(() => useConversations({}));
	await act(async () => {
		await result.current.move("chats", "release", []);
	});
	expect(setPinned).not.toHaveBeenCalled();
	expect(saveAsync).not.toHaveBeenCalled();
});
