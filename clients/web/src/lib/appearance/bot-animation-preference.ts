import { useBrowserPreference } from "#/lib/use-browser-preference";

export function useBotAnimationPreference() {
	const [stored, write] = useBrowserPreference(
		"openmeld.appearance.bot-animation"
	);
	return {
		enabled: stored !== "off",
		setEnabled: (enabled: boolean) => write(enabled ? "on" : "off"),
	};
}
