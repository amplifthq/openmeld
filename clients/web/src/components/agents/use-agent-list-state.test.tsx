import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentListView } from "./agent-list";
import { useAgentListState } from "./use-agent-list-state";

afterEach(() => {
	cleanup();
	window.localStorage.clear();
});

describe("useAgentListState", () => {
	it("persists both cleared values when an empty result clears search and filters together", () => {
		const key = "agent-list-clear-test";
		const view: AgentListView = {
			filters: {
				type: [],
				availability: ["offline"],
				controller: [],
				provider: [],
				model: [],
			},
			sort: "name",
			grouping: "none",
		};
		const { result, unmount } = renderHook(() => useAgentListState(key));
		act(() => result.current.setSearch("no matching Agent"));
		act(() => result.current.setView(view));
		expect(result.current.search).toBe("no matching Agent");
		expect(result.current.view).toEqual(view);

		act(() => {
			result.current.setSearch("");
			result.current.setView(null);
		});
		expect(result.current.search).toBe("");
		expect(result.current.view).toBeNull();
		unmount();

		const restored = renderHook(() => useAgentListState(key));
		expect(restored.result.current.search).toBe("");
		expect(restored.result.current.view).toBeNull();
	});
});
