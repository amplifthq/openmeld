import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useSpaceSidebarDisclosure } from "./use-space-sidebar-disclosure";

afterEach(() => {
	cleanup();
	localStorage.clear();
});

it("temporarily expands on entry while preserving manual choices on the directory", () => {
	const { result, rerender, unmount } = renderHook(
		({ active }) => useSpaceSidebarDisclosure("viewer", "org", active),
		{ initialProps: { active: null as string | null } }
	);
	expect(result.current.isOpen("Spaces:work")).toBe(false);
	rerender({ active: "work" });
	expect(result.current.isOpen("Spaces:work")).toBe(true);
	act(() => result.current.setOpen("Spaces:work", false));
	expect(result.current.isOpen("Spaces:work")).toBe(false);
	rerender({ active: "work" });
	expect(result.current.isOpen("Spaces:work")).toBe(false);
	rerender({ active: null });
	expect(result.current.isOpen("Spaces:work")).toBe(false);
	rerender({ active: "work" });
	expect(result.current.isOpen("Spaces:work")).toBe(true);
	act(() => result.current.setOpen("Spaces:other", true));
	rerender({ active: null });
	expect(result.current.isOpen("Spaces:other")).toBe(true);
	unmount();
	const restored = renderHook(() =>
		useSpaceSidebarDisclosure("viewer", "org", null)
	);
	expect(restored.result.current.isOpen("work")).toBe(false);
	expect(restored.result.current.isOpen("other")).toBe(true);
});

it("expands again when entering another Space in the same group", () => {
	const { result, rerender } = renderHook(
		({ space }) => useSpaceSidebarDisclosure("viewer", "org", "work", space),
		{ initialProps: { space: "a" } }
	);
	act(() => result.current.setOpen("work", false));
	rerender({ space: "a" });
	expect(result.current.isOpen("work")).toBe(false);
	rerender({ space: "b" });
	expect(result.current.isOpen("work")).toBe(true);
});

it("isolates account and organization choices", () => {
	const { result, rerender } = renderHook(
		({ profile, org }) => useSpaceSidebarDisclosure(profile, org, null),
		{ initialProps: { profile: "one", org: "first" } }
	);
	act(() => result.current.setOpen("spaces", true));
	rerender({ profile: "two", org: "first" });
	expect(result.current.isOpen("spaces")).toBe(false);
	rerender({ profile: "one", org: "second" });
	expect(result.current.isOpen("spaces")).toBe(false);
	rerender({ profile: "one", org: "first" });
	expect(result.current.isOpen("spaces")).toBe(true);
});
