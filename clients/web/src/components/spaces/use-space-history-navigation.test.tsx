import { OpenMeldApiClientHttpError } from "@openmeld/api-client";
import type { SignalEnvelope } from "@openmeld/schemas/types";
import {
	focusManager,
	onlineManager,
	QueryClient,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	clearSpaceConversationPositions,
	writeSpaceConversationPosition,
} from "#/lib/space-conversation-position";
import { useSpaceHistoryNavigation } from "./use-space-history-navigation";

let queryClient: QueryClient;
const historyQuery = vi.hoisted(() => ({
	data: undefined as { entries: []; total: number } | undefined,
	isError: false,
	isPending: false,
}));
vi.mock("@tanstack/react-query", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-query")>();
	return {
		...actual,
		useQuery: (options: Parameters<typeof actual.useQuery>[0]) => {
			const isDirectory = options.queryKey.at(-1) === "history-navigation";
			const result = actual.useQuery(
				{ ...options, enabled: isDirectory ? false : options.enabled },
				queryClient
			);
			return isDirectory ? historyQuery : result;
		},
		useQueryClient: () => queryClient,
	};
});

async function navigate<T>(action: () => Promise<T>): Promise<T> {
	let settled = false;
	let value!: T;
	act(() => {
		action().then((result) => {
			value = result;
			settled = true;
		});
	});
	await waitFor(() => expect(settled).toBe(true));
	return value;
}

const historyApi = vi.hoisted(() => ({ listSignalEnvelopes: vi.fn() }));
vi.mock("#/lib/spaces/api", () => ({
	createUnscopedWebSpaceApi: () => historyApi,
}));

const message = (id: string): SignalEnvelope => ({
	v: 1,
	id,
	spaceId: "test-space",
	ts: 0,
	type: "signal.text",
	profile: { kind: "human", profileId: "viewer", profileName: "Viewer" },
	data: { text: id },
});

describe("returning to the live Space history", () => {
	beforeEach(() => {
		queryClient = new QueryClient({
			defaultOptions: { queries: { retryDelay: 0 } },
		});
		queryClient.mount();
		vi.spyOn(queryClient, "setQueryData");
		onlineManager.setOnline(true);
		focusManager.setFocused(true);
		historyQuery.data = undefined;
		historyApi.listSignalEnvelopes.mockReset();
	});

	afterEach(() => {
		queryClient.unmount();
		queryClient.clear();
		onlineManager.setOnline(true);
		focusManager.setFocused(undefined);
	});

	it.each([
		"reconnect",
		"focus",
		"retry",
	] as const)("recovers the failed position through %s without losing readable messages", async (recovery) => {
		historyApi.listSignalEnvelopes.mockRejectedValue(
			new TypeError("Failed to fetch")
		);
		const { result } = renderHook(() =>
			useSpaceHistoryNavigation({
				accessRejected: false,
				enabled: true,
				liveEnvelopes: [message("readable")],
				profileId: "viewer",
				spaceId: "recover-space",
			})
		);
		const onLoaded = vi.fn();
		expect(
			await navigate(() => result.current.open("target", undefined, onLoaded))
		).toBe(false);
		expect(onLoaded).not.toHaveBeenCalled();
		expect(result.current.error).toBeTruthy();
		expect(result.current.visibleLiveEnvelopes.map((item) => item.id)).toEqual([
			"readable",
		]);
		historyApi.listSignalEnvelopes.mockResolvedValue({
			envelopes: [message("target")],
		});
		act(() => {
			if (recovery === "reconnect") {
				onlineManager.setOnline(false);
				onlineManager.setOnline(true);
			} else if (recovery === "focus") {
				focusManager.setFocused(false);
				focusManager.setFocused(true);
			} else {
				result.current.retry?.();
			}
		});
		await waitFor(() =>
			expect(result.current.activeWindow?.envelopes[0]?.id).toBe("target")
		);
		expect(result.current.error).toBeNull();
		expect(result.current.pending).toBe(false);
		expect(onLoaded).toHaveBeenCalledWith(true);
	});

	it("opens the authorized latest messages when an old notification anchor is missing", async () => {
		historyApi.listSignalEnvelopes
			.mockResolvedValueOnce({ envelopes: [message("old")] })
			.mockRejectedValueOnce(
				new OpenMeldApiClientHttpError({
					code: "upstream_error",
					status: 404,
					rawBody: "",
					upstreamCode: "space.signals.anchor_not_found",
					message: "space history anchor not found: child-secret-id",
				})
			)
			.mockResolvedValueOnce({ envelopes: [message("latest")] });
		const { result } = renderHook(() =>
			useSpaceHistoryNavigation({
				accessRejected: false,
				enabled: true,
				liveEnvelopes: [],
				profileId: "viewer",
				spaceId: "parent-space",
			})
		);
		await navigate(() => result.current.open("old"));
		expect(await navigate(() => result.current.open("child-secret-id"))).toBe(
			"latest"
		);
		expect(
			result.current.activeWindow?.envelopes.map((item) => item.id)
		).toEqual(["latest"]);
		expect(result.current.error).toBeNull();
		expect(result.current.notice).toBe(
			"This message is no longer available in this conversation. Showing the latest messages."
		);
		expect(
			historyApi.listSignalEnvelopes.mock.calls.map(([input]) => input.spaceId)
		).toEqual(["parent-space", "parent-space", "parent-space"]);
		expect(
			historyApi.listSignalEnvelopes.mock.calls.at(-1)?.[0].query
		).not.toHaveProperty("aroundSignalId");
		expect(
			historyApi.listSignalEnvelopes.mock.calls.at(-1)?.[0].query
		).toMatchObject({ recent: true, limit: 60 });
		act(() => result.current.latest());
		expect(result.current.notice).toContain("Showing the latest messages");
		historyApi.listSignalEnvelopes.mockResolvedValue({
			envelopes: [message("other")],
		});
		await navigate(() => result.current.open("other"));
		expect(result.current.notice).toBeNull();
	});

	it.each([
		{ status: 403, latest: false },
		{ status: 500, latest: false },
		{ status: 403, latest: true },
		{ status: 500, latest: true },
	])("keeps HTTP $status as failure (latest read: $latest)", async ({
		status,
		latest,
	}) => {
		if (latest) {
			historyApi.listSignalEnvelopes.mockResolvedValueOnce({ envelopes: [] });
		}
		historyApi.listSignalEnvelopes.mockRejectedValue(
			new OpenMeldApiClientHttpError({
				code: "upstream_error",
				status,
				rawBody: "",
				message: "internal details that must not be shown",
			})
		);
		const { result } = renderHook(() =>
			useSpaceHistoryNavigation({
				accessRejected: false,
				enabled: true,
				liveEnvelopes: [],
				profileId: "viewer",
				spaceId: "parent-space",
			})
		);
		expect(await navigate(() => result.current.open("missing"))).toBe(false);
		expect(historyApi.listSignalEnvelopes).toHaveBeenCalledTimes(
			(latest ? 1 : 0) + (status === 403 ? 1 : 3)
		);
		expect(result.current.notice).toBeNull();
		expect(result.current.error).not.toContain("internal details");
		expect(result.current.error).not.toContain("Showing the latest");
	});

	it.each([
		"access",
		"missing anchor",
	])("does not automatically retry a permanent %s failure", async (failure) => {
		const initialWindow = Array.from({ length: 61 }, (_, index) =>
			message(String(index))
		);
		historyApi.listSignalEnvelopes.mockResolvedValue({
			envelopes: initialWindow,
		});
		const { result } = renderHook(() =>
			useSpaceHistoryNavigation({
				accessRejected: false,
				enabled: true,
				liveEnvelopes: [],
				profileId: "viewer",
				spaceId: "permanent-space",
			})
		);
		await navigate(() => result.current.open("30"));
		historyApi.listSignalEnvelopes.mockClear();
		historyApi.listSignalEnvelopes.mockRejectedValue(
			new OpenMeldApiClientHttpError({
				code: "upstream_error",
				status: failure === "access" ? 403 : 404,
				rawBody: "",
				upstreamCode:
					failure === "access"
						? "space.forbidden"
						: "space.signals.anchor_not_found",
				message: "Unavailable",
			})
		);
		expect(await navigate(() => result.current.loadBefore())).toBe(false);
		await act(() => {
			onlineManager.setOnline(false);
			onlineManager.setOnline(true);
			focusManager.setFocused(false);
			focusManager.setFocused(true);
		});
		expect(result.current.error).toBeTruthy();
		expect(historyApi.listSignalEnvelopes).toHaveBeenCalledOnce();
		expect(result.current.retry).toBeUndefined();
	});

	it.each([
		"before",
		"after",
	] as const)("keeps the cold server window when the first %s load completes", async (direction) => {
		const initialWindow = Array.from({ length: 61 }, (_, index) => ({
			...message(String(index + 90)),
			ts: index + 90,
		}));
		const returnedWindow =
			direction === "before"
				? Array.from({ length: 31 }, (_, index) => ({
						...message(String(index + 60)),
						ts: index + 60,
					}))
				: Array.from({ length: 31 }, (_, index) => ({
						...message(String(index + 150)),
						ts: index + 150,
					}));
		historyApi.listSignalEnvelopes.mockResolvedValueOnce({
			envelopes: returnedWindow,
		});
		const { result } = renderHook(() =>
			useSpaceHistoryNavigation({
				accessRejected: false,
				enabled: true,
				initialWindowAnchorSignalId: "120",
				liveEnvelopes: initialWindow,
				profileId: "viewer",
				spaceId: `space-cold-${direction}`,
			})
		);

		expect(result.current.activeWindow?.envelopes).toHaveLength(61);
		expect(
			await navigate(() =>
				direction === "before"
					? result.current.loadBefore()
					: result.current.loadAfter()
			)
		).toBe(true);

		const ids = result.current.activeWindow?.envelopes.map((item) => item.id);
		expect(ids).toContain("120");
		expect(ids).toContain(direction === "before" ? "60" : "180");
		expect(ids).toContain(direction === "before" ? "150" : "90");
		expect(ids).toHaveLength(91);
		expect(result.current.activeWindow?.hasBefore).toBe(true);
		expect(result.current.activeWindow?.hasAfter).toBe(true);
	});

	it("uses the anchored window boundary for no-JS earlier links", () => {
		historyQuery.data = { entries: [], total: 240 };
		const hrefForSignalId = (signalId: string) =>
			`/spaces/space-a?signalId=${signalId}`;
		const oldestWindow = Array.from({ length: 31 }, (_, index) =>
			message(String(index + 1))
		);
		const { result, rerender } = renderHook(
			({ anchorSignalId, liveEnvelopes }) =>
				useSpaceHistoryNavigation({
					accessRejected: false,
					enabled: true,
					hrefForSignalId,
					initialWindowAnchorSignalId: anchorSignalId,
					liveEnvelopes,
					profileId: "viewer",
					spaceId: "space-a",
				}),
			{
				initialProps: {
					anchorSignalId: "1",
					liveEnvelopes: oldestWindow,
				},
			}
		);

		expect(result.current.activeWindow?.hasBefore).toBe(false);
		expect(result.current.earlierHref).toBeUndefined();

		const middleWindow = Array.from({ length: 61 }, (_, index) =>
			message(String(index + 90))
		);
		rerender({ anchorSignalId: "120", liveEnvelopes: middleWindow });
		expect(result.current.activeWindow?.hasBefore).toBe(true);
		expect(result.current.earlierHref).toBe(
			`/spaces/space-a?signalId=${result.current.activeWindow?.envelopes[0]?.id}`
		);
		expect(result.current.earlierHref).not.toContain("signalId=120");
	});

	it.each([
		{ fetchedStart: 1, total: 60, expectedVisibleStart: 1, earlier: false },
		{ fetchedStart: 1, total: 61, expectedVisibleStart: 2, earlier: true },
		{ fetchedStart: 1, total: 70, expectedVisibleStart: 11, earlier: true },
		{ fetchedStart: 1, total: 80, expectedVisibleStart: 21, earlier: true },
		{ fetchedStart: 2, total: 81, expectedVisibleStart: 22, earlier: true },
	])("keeps a normal earlier link for a $total-message recent read", ({
		earlier,
		expectedVisibleStart,
		fetchedStart,
		total,
	}) => {
		historyQuery.data = { entries: [], total };
		const fetchedCount = Math.min(total, 80);
		const fetched = Array.from({ length: fetchedCount }, (_, index) => ({
			...message(String(index + fetchedStart)),
			ts: index + fetchedStart,
		}));
		const { result } = renderHook(() =>
			useSpaceHistoryNavigation({
				accessRejected: false,
				enabled: true,
				hrefForSignalId: (signalId) =>
					`/spaces/space-short?signalId=${signalId}`,
				liveEnvelopes: fetched,
				profileId: "viewer",
				spaceId: `space-short-${total}`,
			})
		);

		expect(result.current.visibleLiveEnvelopes[0]?.id).toBe(
			String(expectedVisibleStart)
		);
		expect(result.current.visibleLiveEnvelopes).toHaveLength(
			Math.min(total, 60)
		);
		if (earlier) {
			expect(result.current.earlierHref).toBe(
				`/spaces/space-short?signalId=${expectedVisibleStart}`
			);
		} else {
			expect(result.current.earlierHref).toBeUndefined();
		}
		expect(result.current.newerHref).toBeUndefined();
	});

	it.each([
		"target changed",
		"return to latest",
		"Space changed",
		"access rejected",
	])("ignores a late history response after %s", async (action) => {
		let finish!: (value: { envelopes: SignalEnvelope[] }) => void;
		historyApi.listSignalEnvelopes.mockReturnValueOnce(
			new Promise((resolve) => {
				finish = resolve;
			})
		);
		const { result, rerender } = renderHook(
			({ spaceId, accessRejected }) =>
				useSpaceHistoryNavigation({
					liveEnvelopes: [],
					spaceId,
					profileId: "viewer",
					enabled: false,
					accessRejected,
				}),
			{ initialProps: { spaceId: "space-cancel", accessRejected: false } }
		);
		const request = new AbortController();
		let opening!: ReturnType<typeof result.current.open>;
		act(() => {
			opening = result.current.open("old", request.signal);
		});
		act(() => {
			if (action === "target changed") {
				request.abort();
			} else if (action === "Space changed") {
				rerender({ spaceId: "other-space", accessRejected: false });
			} else if (action === "access rejected") {
				rerender({ spaceId: "space-cancel", accessRejected: true });
			} else {
				result.current.latest();
			}
		});
		await act(async () => {
			finish({ envelopes: [message("old")] });
			expect(await opening).toBe(false);
		});
		expect(result.current.activeWindow).toBeNull();
		expect(result.current.error).toBeNull();
		expect(result.current.pending).toBe(false);
	});
	it.each([
		false,
		true,
	])("restores the saved reading mode without mounting the whole transcript (at bottom: %s)", (atBottom) => {
		writeSpaceConversationPosition("viewer:space-conversation:space-saved", {
			anchorSignalId: "100",
			offsetFromVisibleTop: 10,
			...(atBottom ? { atBottom: true as const } : {}),
		});
		const history = Array.from({ length: 480 }, (_, index) => ({
			...message(String(index)),
			ts: index,
		}));
		const { result } = renderHook(() =>
			useSpaceHistoryNavigation({
				liveEnvelopes: history,
				spaceId: "space-saved",
				profileId: "viewer",
				enabled: false,
				accessRejected: false,
			})
		);
		if (atBottom) {
			expect(result.current.activeWindow).toBeNull();
			expect(result.current.visibleLiveEnvelopes.at(-1)?.id).toBe("479");
		} else {
			expect(result.current.activeWindow?.envelopes).toHaveLength(61);
			expect(result.current.activeWindow?.envelopes[30]?.id).toBe("100");
		}
		clearSpaceConversationPositions();
	});
	it("joins live messages only after the server confirms the historical window reached the tail", async () => {
		const old: Extract<SignalEnvelope, { type: "signal.text" }> = {
			v: 1,
			id: "old",
			spaceId: "space-a",
			ts: 100,
			type: "signal.text",
			profile: { profileId: "human-1", profileName: "Casey", kind: "human" },
			data: { text: "Private old text" },
		};
		historyApi.listSignalEnvelopes.mockResolvedValueOnce({ envelopes: [old] });
		const { result, rerender } = renderHook(
			({ liveEnvelopes }) =>
				useSpaceHistoryNavigation({
					liveEnvelopes,
					spaceId: "space-a",
					profileId: "human-1",
					enabled: true,
					accessRejected: false,
				}),
			{ initialProps: { liveEnvelopes: [] as SignalEnvelope[] } }
		);
		expect(await navigate(() => result.current.open(old.id))).toBe(true);
		expect(queryClient.setQueryData).toHaveBeenCalledOnce();
		const recalled = {
			...old,
			data: {
				text: "Casey recalled a message.",
				meta: { messageRevision: 1, recalledAt: 200 },
			},
		};
		rerender({ liveEnvelopes: [recalled, { ...old, id: "new", ts: 300 }] });
		expect(result.current.activeWindow?.envelopes).toEqual([
			recalled,
			{ ...old, id: "new", ts: 300 },
		]);
		expect(result.current.activeWindow?.hasBefore).toBe(false);
		const later = { ...old, id: "later", ts: 400 };
		rerender({ liveEnvelopes: [later] });
		expect(result.current.activeWindow?.envelopes).toEqual([old]);
		expect(result.current.activeWindow?.hasAfter).toBe(true);
		historyApi.listSignalEnvelopes.mockResolvedValueOnce({
			envelopes: [old, { ...old, id: "bridge", ts: 250 }, later],
		});
		expect(await navigate(() => result.current.loadAfter())).toBe(true);
		expect(
			result.current.activeWindow?.envelopes.map((item) => item.id)
		).toEqual(["old", "bridge", "later"]);
	});
	it("renders a recent page without discarding older messages or moving the boundary when new messages arrive", () => {
		const history = Array.from({ length: 480 }, (_, index) =>
			message(String(index))
		);
		const { result, rerender } = renderHook(
			({ liveEnvelopes, spaceId }) =>
				useSpaceHistoryNavigation({
					liveEnvelopes,
					spaceId,
					profileId: "viewer",
					enabled: false,
					accessRejected: false,
				}),
			{ initialProps: { liveEnvelopes: history, spaceId: "space-a" } }
		);
		expect(result.current.visibleLiveEnvelopes.map((item) => item.id)).toEqual(
			history.slice(420).map((item) => item.id)
		);
		expect(result.current.hasHiddenLiveHistory).toBe(true);
		expect(history).toHaveLength(480);

		rerender({
			liveEnvelopes: [...history, message("new")],
			spaceId: "space-a",
		});
		expect(result.current.visibleLiveEnvelopes[0]?.id).toBe("420");
		expect(result.current.visibleLiveEnvelopes.at(-1)?.id).toBe("new");
		act(() => result.current.revealCachedBefore());
		expect(result.current.visibleLiveEnvelopes[0]?.id).toBe("360");
		for (let page = 0; page < 6; page += 1) {
			act(() => result.current.revealCachedBefore());
		}
		expect(result.current.visibleLiveEnvelopes).toHaveLength(481);
		expect(result.current.hasHiddenLiveHistory).toBe(false);

		act(() => result.current.latest());
		rerender({ liveEnvelopes: history, spaceId: "space-b" });
		expect(result.current.visibleLiveEnvelopes).toHaveLength(60);
		rerender({ liveEnvelopes: [], spaceId: "space-c" });
		rerender({ liveEnvelopes: history, spaceId: "space-c" });
		expect(result.current.visibleLiveEnvelopes[0]?.id).toBe("420");
	});
	it("keeps the latest messages visible when newer presence events outnumber the live window", () => {
		const messages = Array.from({ length: 80 }, (_, index) => ({
			...message(String(index)),
			ts: index,
		}));
		const presence = Array.from(
			{ length: 126 },
			(_, index) =>
				({
					id: `presence-${String(index)}`,
					ts: 80 + index,
					type: index % 2 === 0 ? "presence.join" : "presence.quit",
				}) as SignalEnvelope
		);
		const { result } = renderHook(() =>
			useSpaceHistoryNavigation({
				liveEnvelopes: [...messages, ...presence],
				spaceId: "space-presence",
				profileId: "viewer",
				enabled: false,
				accessRejected: false,
			})
		);
		expect(result.current.visibleLiveEnvelopes).toHaveLength(60);
		expect(result.current.visibleLiveEnvelopes[0]?.id).toBe("20");
		expect(result.current.visibleLiveEnvelopes.at(-1)?.id).toBe("79");
	});
});
