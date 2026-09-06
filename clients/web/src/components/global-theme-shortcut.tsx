import {
	APPLICATION_SHORTCUTS,
	blocksLetterShortcuts,
} from "@openmeld/ui/lib/application-shortcuts";
import { useTheme } from "next-themes";
import { useEffect } from "react";

/** Mounted once inside the root ThemeProvider, including public and setup pages. */
export function GlobalThemeShortcut() {
	const { resolvedTheme, setTheme } = useTheme();
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (
				event.defaultPrevented ||
				event.isComposing ||
				event.repeat ||
				!event.shiftKey ||
				event.key.toLowerCase() !== APPLICATION_SHORTCUTS.theme ||
				blocksLetterShortcuts(event)
			) {
				return;
			}
			event.preventDefault();
			setTheme(resolvedTheme === "dark" ? "light" : "dark");
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [resolvedTheme, setTheme]);
	return null;
}
