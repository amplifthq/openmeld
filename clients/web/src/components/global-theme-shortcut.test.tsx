import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GlobalThemeShortcut } from "./global-theme-shortcut";

const { setTheme } = vi.hoisted(() => ({ setTheme: vi.fn() }));
vi.mock("next-themes", () => ({
	useTheme: () => ({ resolvedTheme: "dark", setTheme }),
}));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

it("switches themes without any app or organization context and removes its listener", () => {
	const { unmount } = render(<GlobalThemeShortcut />);
	fireEvent.keyDown(window, { key: "D", shiftKey: true });
	expect(setTheme).toHaveBeenCalledExactlyOnceWith("light");
	unmount();
	fireEvent.keyDown(window, { key: "D", shiftKey: true });
	expect(setTheme).toHaveBeenCalledOnce();
});
it("does not switch while typing, composing, or using another modifier", () => {
	const { getByRole } = render(
		<>
			<GlobalThemeShortcut />
			<input />
		</>
	);
	fireEvent.keyDown(getByRole("textbox"), { key: "D", shiftKey: true });
	fireEvent.keyDown(window, { key: "D", shiftKey: true, isComposing: true });
	fireEvent.keyDown(window, { key: "D", shiftKey: true, ctrlKey: true });
	expect(setTheme).not.toHaveBeenCalled();
});
