import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useSidebarDisclosure } from "./use-sidebar-disclosure";

afterEach(() => {
	cleanup();
	localStorage.clear();
});

it("keeps Chats collapsed on the directory and respects a manual choice after visiting a chat", () => {
	const { result, rerender } = renderHook(
		({ active }) => useSidebarDisclosure("chat", "viewer", "org", active),
		{ initialProps: { active: null as string | null } }
	);
	expect(result.current.isOpen("Chats:chats")).toBe(false);
	rerender({ active: "chats" });
	expect(result.current.isOpen("Chats:chats")).toBe(true);
	rerender({ active: null });
	expect(result.current.isOpen("Chats:chats")).toBe(false);
	act(() => result.current.setOpen("Chats:chats", true));
	const restored = renderHook(() =>
		useSidebarDisclosure("chat", "viewer", "org", null)
	);
	expect(restored.result.current.isOpen("Chats:chats")).toBe(true);
	const spaces = renderHook(() =>
		useSidebarDisclosure("space", "viewer", "org", null)
	);
	expect(spaces.result.current.isOpen("Spaces:chats")).toBe(false);
});

it("starts Team collapsed, reveals the selected person's group, and remembers manual choices", () => {
	const { result, rerender } = renderHook(
		({ active }) => useSidebarDisclosure("people", "viewer", "org", active),
		{ initialProps: { active: null as string | null } }
	);
	for (const id of ["center-agent", "starred", "design", "online", "offline"]) {
		expect(result.current.isOpen(`People:${id}`)).toBe(false);
	}
	rerender({ active: "offline" });
	expect(result.current.isOpen("People:offline")).toBe(true);
	act(() => result.current.setOpen("People:design", true));
	rerender({ active: null });
	expect(result.current.isOpen("People:offline")).toBe(false);
	expect(result.current.isOpen("People:design")).toBe(true);
	const restored = renderHook(() =>
		useSidebarDisclosure("people", "viewer", "org", null)
	);
	expect(restored.result.current.isOpen("People:design")).toBe(true);
	const spaces = renderHook(() =>
		useSidebarDisclosure("space", "viewer", "org", null)
	);
	expect(spaces.result.current.isOpen("Spaces:design")).toBe(false);
});

it("temporarily expands on entry while preserving manual choices on the directory", () => {
	const { result, rerender, unmount } = renderHook(
		({ active }) => useSidebarDisclosure("space", "viewer", "org", active),
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
		useSidebarDisclosure("space", "viewer", "org", null)
	);
	expect(restored.result.current.isOpen("work")).toBe(false);
	expect(restored.result.current.isOpen("other")).toBe(true);
});

it("expands again when entering another Space in the same group", () => {
	const { result, rerender } = renderHook(
		({ space }) =>
			useSidebarDisclosure("space", "viewer", "org", "work", space),
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
		({ profile, org }) => useSidebarDisclosure("space", profile, org, null),
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
