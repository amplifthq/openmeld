import type { SignalEnvelope } from "@openmeld/schemas/types";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSpaceHistoryNavigation } from "./use-space-history-navigation";

vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: undefined, isPending: false, isError: false }),
}));

// Only identity is consumed when selecting the cached rendering window.
const message = (id: string) => ({ id }) as SignalEnvelope;

describe("returning to the live Space history", () => {
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
