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
	it.each([
		"removed",
		"unchanged",
		"read failed",
	] as const)("keeps removal optimistic while reconciling a failed write response: %s", async (outcome) => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		api.setMessageReaction.mockRejectedValueOnce(new Error("Response lost"));
		let resolveRead!: (
			value: Awaited<ReturnType<Api["getMessageReactions"]>>
		) => void;
		let rejectRead!: (error: Error) => void;
		api.getMessageReactions.mockReturnValueOnce(
			new Promise((resolve, reject) => {
				resolveRead = resolve;
				rejectRead = reject;
			})
		);
		const view = renderHook(
			() =>
				useMessageReactions({
					spaceId: "space-a",
					signalId: "message-a",
					profileId: "profile-a",
					snapshot: reacted,
				}),
			{
				wrapper: ({ children }: PropsWithChildren) => (
					<QueryClientProvider client={client}>{children}</QueryClientProvider>
				),
			}
		);
		try {
			let operation!: Promise<void>;
			act(() => {
				operation = view.result.current.toggle({
					emoji: "👍",
					label: "thumbs up",
				});
			});
			await waitFor(() =>
				expect(api.getMessageReactions).toHaveBeenCalledOnce()
			);
			expect(view.result.current.groups).toEqual([]);
			expect(view.result.current.error).toBeNull();
			expect(view.result.current.pending["👍"]?.active).toBe(false);
			await act(async () => {
				if (outcome === "read failed") {
					rejectRead(new Error("Offline"));
				} else {
					resolveRead({
						signalId: "message-a",
						reactions:
							outcome === "removed" ? { version: 2, groups: [] } : reacted,
					});
				}
				await operation;
			});
			expect(view.result.current.groups).toEqual(
				outcome === "removed" ? [] : reacted.groups
			);
			expect(view.result.current.error).toBe(
				outcome === "removed"
					? null
					: "Couldn’t update your reaction. Try again."
			);
			expect(view.result.current.pending).toEqual({});
		} finally {
			view.unmount();
			client.clear();
		}
	});
	it("saves a confirmed reaction when the user leaves before the response arrives", async () => {
		const client = new QueryClient();
		const historyKey = spaceQueryKeys.history("space-a", "profile-a");
		client.setQueryData(historyKey, { envelopes: [signal] });
		let resolveResponse!: (
			value: Awaited<ReturnType<Api["setMessageReaction"]>>
		) => void;
		api.setMessageReaction.mockReturnValue(
			new Promise((resolve) => {
				resolveResponse = resolve;
			})
		);
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
		let pending!: Promise<void>;
		act(() => {
			pending = view.result.current.toggle({ emoji: "👍", label: "thumbs up" });
		});
		view.unmount();
		resolveResponse({ signalId: "message-a", reactions: reacted });
		await pending;
		try {
			expect(
				client.getQueryData<SpaceHistorySnapshot>(historyKey)?.envelopes[0]
			).toEqual({ ...signal, reactions: reacted });
		} finally {
			client.clear();
		}
	});
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
