const DITHER_PROFILE_AVATAR_SEED_NAMESPACE =
	"openmeld-dither-profile-avatar:v1";

export type DitherProfileAvatarKind = "human";

export function buildDitherProfileAvatarSeed(input: {
	profileId: string;
	profileKind: DitherProfileAvatarKind;
}): string {
	return `${DITHER_PROFILE_AVATAR_SEED_NAMESPACE}:${input.profileKind}:${input.profileId}`;
}
