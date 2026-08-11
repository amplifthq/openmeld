export const OPENMELD_WELCOMING_SPACE_PURPOSE = "openmeld_welcoming_space";

export function isWelcomingSpacePurpose(
	spacePurpose: string | null | undefined
): boolean {
	return spacePurpose === OPENMELD_WELCOMING_SPACE_PURPOSE;
}
