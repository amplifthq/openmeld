import type { SignalEnvelope } from "@openmeld/schemas/types";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	clearSpaceConversationPositions,
	writeSpaceConversationPosition,
} from "#/lib/space-conversation-position";
import { useSpaceHistoryNavigation } from "./use-space-history-navigation";

const historyQuery = vi.hoisted(() => ({
	data: undefined as { entries: []; total: number } | undefined,
	isError: false,
	isPending: false,
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => historyQuery }));

const historyApi = vi.hoisted(() => ({ listSignalEnvelopes: vi.fn() }));
vi.mock("#/lib/spaces/api", () => ({
	createUnscopedWebSpaceApi: () => historyApi,
}));

// Only identity is consumed when selecting the cached rendering window.
const message = (id: string) => ({ id }) as SignalEnvelope;

describe("returning to the live Space history", () => {
	beforeEach(() => {
		historyQuery.data = undefined;
		historyApi.listSignalEnvelopes.mockReset();
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
		await act(async () => {
			const loaded =
				direction === "before"
					? await result.current.loadBefore()
					: await result.current.loadAfter();
			expect(loaded).toBe(true);
		});

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
		"target changed",
		"return to latest",
	])("ignores a late history response after %s", async (action) => {
		let finish!: (value: { envelopes: SignalEnvelope[] }) => void;
		historyApi.listSignalEnvelopes.mockReturnValueOnce(
			new Promise((resolve) => {
				finish = resolve;
			})
		);
		const { result } = renderHook(() =>
			useSpaceHistoryNavigation({
				liveEnvelopes: [],
				spaceId: "space-cancel",
				profileId: "viewer",
				enabled: false,
				accessRejected: false,
			})
		);
		const request = new AbortController();
		let opening!: Promise<boolean>;
		act(() => {
			opening = result.current.open("old", request.signal);
		});
		act(() => {
			if (action === "target changed") {
				request.abort();
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
	it("restores an older cached reading position without mounting the whole transcript", () => {
		writeSpaceConversationPosition("viewer:space-conversation:space-saved", {
			anchorSignalId: "100",
			offsetFromVisibleTop: 10,
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
		expect(result.current.activeWindow?.envelopes).toHaveLength(61);
		expect(result.current.activeWindow?.envelopes[30]?.id).toBe("100");
		clearSpaceConversationPositions();
	});
	it("replaces a recalled message in an open historical window without adding new live messages", async () => {
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
		await act(async () => {
			expect(await result.current.open(old.id)).toBe(true);
		});
		const recalled = {
			...old,
			data: {
				text: "Casey recalled a message.",
				meta: { messageRevision: 1, recalledAt: 200 },
			},
		};
		rerender({ liveEnvelopes: [recalled, { ...old, id: "new", ts: 300 }] });
		expect(result.current.activeWindow?.envelopes).toEqual([recalled]);
		expect(result.current.activeWindow?.hasBefore).toBe(false);
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
});
