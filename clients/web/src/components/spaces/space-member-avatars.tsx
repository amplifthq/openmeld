import { HOSTED_CENTER_AGENT_CONTROLLER_REF } from "@openmeld/agent-runtime";
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
	layout?: "compact" | "horizontal";
}) {
	const horizontal = input.layout === "horizontal";
	const members = input.members.slice(0, horizontal ? 5 : 3);
	const size = horizontal || members.length === 1 ? 20 : 12;
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
			className={
				horizontal
					? "isolate inline-flex h-5 max-w-full shrink-0 items-center"
					: "relative size-5 shrink-0"
			}
			data-slot="space-member-avatars"
		>
			{members.map((member, index) => (
				<span
					className={
						horizontal
							? "relative flex shrink-0 overflow-hidden bg-background ring-1 ring-background"
							: `absolute flex overflow-hidden bg-sidebar ring-1 ring-sidebar ${positions[index]}`
					}
					key={member.profileId}
					style={{
						borderRadius:
							member.profileKind === "human" ||
							(input.appearances?.get(member.profileId)?.agentControllerRef ??
								member.agentControllerRef) ===
								HOSTED_CENTER_AGENT_CONTROLLER_REF
								? "50%"
								: "22%",
						...(horizontal
							? {
									zIndex: members.length - index,
									marginLeft:
										index > 0
											? Math.min(16, 32 / (members.length - 1)) - size
											: 0,
								}
							: {}),
					}}
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
							profileName={member.profileName}
							size={size}
						/>
					)}
				</span>
			))}
		</span>
	);
}
