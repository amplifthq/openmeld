import type {
	SignalEnvelope,
	SpaceMessageReactions,
} from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import type { SpaceHistorySnapshot } from "#/query/spaces/history";
import { spaceQueryKeys } from "#/query/spaces/status";
import {
	messageReactionsKey,
	useMessageReactions,
} from "./space-message-reactions";

type Api = ReturnType<typeof createUnscopedWebSpaceApi>;
const api = vi.hoisted(() => ({
	getMessageReactions: vi.fn<Api["getMessageReactions"]>(),
	setMessageReaction: vi.fn<Api["setMessageReaction"]>(),
}));
vi.mock("#/lib/spaces/api", () => ({ createUnscopedWebSpaceApi: () => api }));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const empty: SpaceMessageReactions = { version: 0, groups: [] };
const reacted: SpaceMessageReactions = {
	version: 1,
	groups: [
		{
			emoji: "👍",
			label: "thumbs up",
			count: 1,
			reactedByMe: true,
			actors: [
				{ profileId: "profile-a", displayName: "Alex", profileKind: "human" },
			],
			actorsHasMore: false,
		},
	],
};
const signal: SignalEnvelope = {
	v: 1,
	id: "message-a",
	spaceId: "space-a",
	ts: 1,
	type: "signal.text",
	profile: { kind: "human", profileId: "profile-a", profileName: "Alex" },
	data: { text: "Keep this message and its reactions together." },
	reactions: empty,
};

describe("message reaction cache", () => {
	it("fetches a missing snapshot instead of treating it as permanently empty", async () => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		api.getMessageReactions.mockResolvedValue({
			signalId: "message-a",
			reactions: reacted,
		});
		const view = renderHook(
			() =>
				useMessageReactions({
					spaceId: "space-a",
					signalId: "message-a",
					profileId: "profile-a",
				}),
			{
				wrapper: ({ children }: PropsWithChildren) => (
					<QueryClientProvider client={client}>{children}</QueryClientProvider>
				),
			}
		);
		try {
			await waitFor(() =>
				expect(view.result.current.groups).toEqual(reacted.groups)
			);
		} finally {
			view.unmount();
			client.clear();
		}
	});
	it.each([
		"toggle",
		"refresh",
	] as const)("writes confirmed %s results into the saved message, including removal", async (operation) => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const historyKey = spaceQueryKeys.history("space-a", "profile-a");
		const otherKey = spaceQueryKeys.history("space-a", "profile-b");
		const history = { envelopes: [signal], nextCursor: "older" };
		client.setQueryData(historyKey, history);
		client.setQueryData(otherKey, history);
		const view = renderHook(
			() =>
				useMessageReactions({
					spaceId: "space-a",
					signalId: "message-a",
					profileId: "profile-a",
					snapshot: empty,
				}),
			{
				wrapper: ({ children }: PropsWithChildren) => (
					<QueryClientProvider client={client}>{children}</QueryClientProvider>
				),
			}
		);
		try {
			for (const reactions of [reacted, { version: 2, groups: [] }]) {
				api.setMessageReaction.mockResolvedValue({
					signalId: "message-a",
					reactions,
				});
				api.getMessageReactions.mockResolvedValue({
					signalId: "message-a",
					reactions,
				});
				await act(async () => {
					if (operation === "toggle") {
						await view.result.current.toggle({
							emoji: "👍",
							label: "thumbs up",
						});
					} else {
						await client.invalidateQueries({
							queryKey: messageReactionsKey("space-a", "message-a"),
						});
					}
				});
				await waitFor(() =>
					expect(
						client.getQueryData<SpaceHistorySnapshot>(historyKey)?.envelopes[0]
					).toEqual({ ...signal, reactions })
				);
			}
			expect(client.getQueryData(otherKey)).toEqual(history);
			api.getMessageReactions.mockResolvedValue({
				signalId: "message-a",
				reactions: reacted,
			});
			await act(() =>
				client.invalidateQueries({
					queryKey: messageReactionsKey("space-a", "message-a"),
				})
			);
			expect(view.result.current.groups).toEqual([]);
			client.removeQueries({ queryKey: historyKey, exact: true });
			api.getMessageReactions.mockResolvedValue({
				signalId: "message-a",
				reactions: { ...reacted, version: 3 },
			});
			await act(() =>
				client.invalidateQueries({
					queryKey: messageReactionsKey("space-a", "message-a"),
				})
			);
			expect(client.getQueryData(historyKey)).toBeUndefined();
		} finally {
			view.unmount();
			client.clear();
		}
	});
});
