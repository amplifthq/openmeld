import { cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useAppKeyboardShortcuts } from "./use-app-keyboard-shortcuts";

const { navigate, setTheme } = vi.hoisted(() => ({
	navigate: vi.fn(async (_options: unknown) => undefined),
	setTheme: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("next-themes", () => ({
	useTheme: () => ({ resolvedTheme: "dark", setTheme }),
}));
vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({ currentOrganization: { slug: "acme" } }),
}));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	vi.useRealTimers();
	document.body.innerHTML = "";
});

it.each([
	["h", "/o/acme/spaces"],
	["s", "/o/acme/spaces"],
	["m", "/o/acme/chats"],
	["p", "/o/acme/people"],
	["a", "/o/acme/agents"],
	["i", "/o/acme/inbox"],
	["c", "/o/acme/computers"],
])("navigates with g then %s", (key, to) => {
	renderHook(() => useAppKeyboardShortcuts(vi.fn()));
	fireEvent.keyDown(window, { key: "g" });
	fireEvent.keyDown(window, { key });
	expect(navigate).toHaveBeenCalledWith({ to });
});
it("keeps Command K and leaves theme switching to the global owner", () => {
	const command = vi.fn();
	renderHook(() => useAppKeyboardShortcuts(command));
	fireEvent.keyDown(window, { key: "k", metaKey: true });
	expect(command).toHaveBeenCalledOnce();
	fireEvent.keyDown(window, { key: "D", shiftKey: true });
	expect(setTheme).not.toHaveBeenCalled();
});
it("ignores typing, composition, and expired sequences", () => {
	vi.useFakeTimers();
	vi.setSystemTime(10_000);
	renderHook(() => useAppKeyboardShortcuts(vi.fn()));
	const input = document.createElement("input");
	document.body.appendChild(input);
	fireEvent.keyDown(input, { key: "g" });
	fireEvent.keyDown(input, { key: "h" });
	fireEvent.keyDown(input, { key: "D", shiftKey: true });
	fireEvent.keyDown(window, { key: "g", isComposing: true });
	fireEvent.keyDown(window, { key: "h" });
	fireEvent.keyDown(window, { key: "g" });
	vi.advanceTimersByTime(1001);
	fireEvent.keyDown(window, { key: "h" });
	expect(navigate).not.toHaveBeenCalled();
	expect(setTheme).not.toHaveBeenCalled();
});
