import { useBrowserPreference } from "#/lib/use-browser-preference";

export function useMessagePreviews(profileId: string, organizationId: string) {
	const [saved, setSaved] = useBrowserPreference(
		`openmeld.spaces.message-previews:${profileId}:${organizationId}`
	);
	return {
		showMessagePreviews: saved === "shown",
		setShowMessagePreviews: (show: boolean) =>
			setSaved(show ? "shown" : "hidden"),
	};
}
