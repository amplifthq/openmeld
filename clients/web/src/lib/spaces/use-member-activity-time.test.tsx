import {
	createSpaceMemberHumanSnapshot,
	createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import { buildSpaceMemberDirectory } from "@openmeld/space";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useMemberActivityTime } from "./use-member-activity-time";

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

it("ages a cached Space timestamp instead of repeating its old relative label", () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-09-05T00:00:00Z"));
	const snapshot = createSpaceMembersSnapshot({
		humans: [
			createSpaceMemberHumanSnapshot({
				lastSeenAt: "2026-09-04T22:00:00Z",
				lastSeenLabel: "Seen 2h ago",
				liveNow: false,
			}),
		],
	});
	const entry = buildSpaceMemberDirectory(snapshot)
		.sections.flatMap((section) => section.entries)
		.find((member) => member.profileKind === "human");
	if (!entry) {
		throw new Error("Human fixture missing");
	}
	const { result } = renderHook(() => useMemberActivityTime(entry));
	expect(result.current).toBe("2h ago");
	act(() => {
		vi.setSystemTime(new Date("2026-09-05T18:00:00Z"));
		window.dispatchEvent(new Event("focus"));
	});
	expect(result.current).toBe("20h ago");
});
