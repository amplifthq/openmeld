import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useConversationDisclosure } from "./use-conversation-disclosure";
import { useConversationView } from "./use-conversation-view";

afterEach(() => {
	cleanup();
	localStorage.clear();
});
it("defaults to Recent, remembers Grouped across mounts, and isolates accounts and organizations", () => {
	const { result, rerender, unmount } = renderHook(
		({ user, org }) => useConversationView(user, org),
		{ initialProps: { user: "one", org: "org" } }
	);
	expect(result.current.view).toBe("recent");
	act(() => result.current.setView("grouped"));
	expect(result.current.view).toBe("grouped");
	rerender({ user: "two", org: "org" });
	expect(result.current.view).toBe("recent");
	rerender({ user: "one", org: "another" });
	expect(result.current.view).toBe("recent");
	unmount();
	expect(
		renderHook(() => useConversationView("one", "org")).result.current.view
	).toBe("grouped");
});
it("refreshes another mounted view without navigation", () => {
	const first = renderHook(() => useConversationView("one", "org"));
	const second = renderHook(() => useConversationView("one", "org"));
	act(() => first.result.current.setView("recent"));
	expect(second.result.current.view).toBe("recent");
});
it("preserves existing fold choices and reveals search results without changing them", () => {
	localStorage.setItem(
		"openmeld:space-sidebar-disclosure:human:org",
		'{"work":true}'
	);
	localStorage.setItem(
		"openmeld:chat-sidebar-disclosure:human:org",
		'{"work":false}'
	);
	const { result, rerender } = renderHook(
		({ searching }) =>
			useConversationDisclosure("human", "org", "active", "spaces", searching),
		{ initialProps: { searching: false } }
	);
	expect(result.current.isOpen("Conversations:space:work")).toBe(true);
	expect(result.current.isOpen("Conversations:chat:work")).toBe(false);
	rerender({ searching: true });
	expect(result.current.isOpen("Conversations:chat:work")).toBe(true);
	rerender({ searching: false });
	expect(result.current.isOpen("Conversations:chat:work")).toBe(false);
	expect(result.current.isOpen("Conversations:recent")).toBe(true);
});
