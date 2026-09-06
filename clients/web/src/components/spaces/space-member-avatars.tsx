import type {
	AccountSpaceIndexItem,
	OrganizationProfileDirectoryResponse,
} from "@openmeld/schemas/types";
import { AgentProfileControllerAvatar } from "#/components/agents/agent-profile-controller-avatar";
import { DitherProfileAvatar } from "#/components/profiles/dither-profile-avatar";

// All layers stay inside the leading icon slot: no row growth or text overlap.
const TRIANGLE_POSITIONS = [
	"top-0 left-1",
	"bottom-0 left-0",
	"right-0 bottom-0",
];
const PAIR_POSITIONS = ["top-0 left-0", "right-0 bottom-0"];
export function resolveSpaceMemberAppearances(
	directory: OrganizationProfileDirectoryResponse | undefined
) {
	return new Map<string, SpaceMemberAppearance>([
		...(directory?.members ?? []).flatMap((member) =>
			member.humanProfile
				? [
						[
							member.humanProfile.profileId,
							{ avatarUrl: member.user.image, agentControllerRef: null },
						] as const,
					]
				: []
		),
		...(directory?.agentProfiles ?? []).map(
			(profile) =>
				[
					profile.profileId,
					{
						avatarUrl: null,
						agentControllerRef: profile.agentControllerRef,
					},
				] as const
		),
	]);
}
export type SpaceMemberAppearance = {
	avatarUrl: string | null;
	agentControllerRef: string | null;
};

export function SpaceMemberAvatars(input: {
	members: NonNullable<AccountSpaceIndexItem["memberPreviews"]>;
	appearances?: ReadonlyMap<string, SpaceMemberAppearance>;
}) {
	const members = input.members.slice(0, 3);
	const size = members.length === 1 ? 20 : 12;
	let positions = ["inset-0"];
	if (members.length === 3) {
		positions = TRIANGLE_POSITIONS;
	}
	if (members.length === 2) {
		positions = PAIR_POSITIONS;
	}
	return (
		<span
			aria-hidden="true"
			className="relative size-5 shrink-0"
			data-slot="space-member-avatars"
		>
			{members.map((member, index) => (
				<span
					className={`absolute flex overflow-hidden rounded-full bg-sidebar ring-1 ring-sidebar ${positions[index]}`}
					key={member.profileId}
				>
					{member.profileKind === "human" ? (
						<DitherProfileAvatar
							avatarImageUrl={
								input.appearances?.get(member.profileId)?.avatarUrl
							}
							profileId={member.profileId}
							profileKind="human"
							profileName={member.profileName}
							size={size}
						/>
					) : (
						<AgentProfileControllerAvatar
							agentControllerRef={
								input.appearances?.get(member.profileId)?.agentControllerRef ??
								member.agentControllerRef
							}
							profileId={member.profileId}
							size={size}
						/>
					)}
				</span>
			))}
		</span>
	);
}
