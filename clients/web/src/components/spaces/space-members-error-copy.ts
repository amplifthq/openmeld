export const SPACE_MEMBERS_LOAD_ERROR_MESSAGE =
	"OpenMeld couldn't load members for this space right now.";

export const SPACE_MEMBERS_REFRESH_ERROR_MESSAGE =
	"Member refresh failed. Showing the last loaded member list.";

export function resolveMissingSpaceMembersMessage(
	errorMessage: string | null
): string {
	return (
		errorMessage ?? "Members are still loading. Try sending again shortly."
	);
}
