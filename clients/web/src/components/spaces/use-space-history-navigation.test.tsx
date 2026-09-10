import type { SignalEnvelope } from "@openmeld/schemas/types";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSpaceHistoryNavigation } from "./use-space-history-navigation";

vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: undefined, isPending: false, isError: false }),
}));

const historyApi = vi.hoisted(() => ({ listSignalEnvelopes: vi.fn() }));
vi.mock("#/lib/spaces/api", () => ({
	createUnscopedWebSpaceApi: () => historyApi,
}));

// Only identity is consumed when selecting the cached rendering window.
const message = (id: string) => ({ id }) as SignalEnvelope;

describe("returning to the live Space history", () => {
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
		act(() => result.current.latest());
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
		expect(result.current.visibleLiveEnvelopes).toHaveLength(480);
	});
});
