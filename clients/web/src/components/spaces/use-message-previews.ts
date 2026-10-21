import { useBrowserPreference } from "#/lib/use-browser-preference";

export function useMessagePreviews(profileId: string, organizationId: string) {
	const [saved, setSaved] = useBrowserPreference(
		`openmeld.spaces.message-previews:${profileId}:${organizationId}`
	);
	return {
		// Shown unless this person chose to hide them.
		showMessagePreviews: saved !== "hidden",
		setShowMessagePreviews: (show: boolean) =>
			setSaved(show ? "shown" : "hidden"),
	};
}
