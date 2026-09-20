/** Presentation only: never use browser platform hints for identity or permissions. */
export function desktopUsesMacControls(): boolean {
	return (
		typeof navigator !== "undefined" &&
		navigator.platform.toLowerCase().startsWith("mac")
	);
}
