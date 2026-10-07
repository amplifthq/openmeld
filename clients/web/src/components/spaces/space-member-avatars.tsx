import { HOSTED_CENTER_AGENT_CONTROLLER_REF } from "@openmeld/agent-runtime";
import type {
	AccountSpaceIndexItem,
	OrganizationProfileDirectoryResponse,
} from "@openmeld/schemas/types";
import { cn } from "@openmeld/ui/lib/utils";
import { AgentProfileControllerAvatar } from "#/components/agents/agent-profile-controller-avatar";
import { DitherProfileAvatar } from "#/components/profiles/dither-profile-avatar";

// All layers stay inside the leading icon slot: no row growth or text overlap.
const TRIANGLE_POSITIONS = [
	"top-0 left-1/2 -translate-x-1/2",
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
						avatarStyle: profile.avatarStyle ?? null,
						avatarModelId: profile.avatarModelId ?? null,
						agentControllerRef: profile.agentControllerRef,
					},
				] as const
		),
	]);
}
export type SpaceMemberAppearance = {
	avatarUrl: string | null;
	agentControllerRef: string | null;
	avatarStyle?: OrganizationProfileDirectoryResponse["agentProfiles"][number]["avatarStyle"];
	avatarModelId?: string | null;
};

export function SpaceMemberAvatars(input: {
	members: NonNullable<AccountSpaceIndexItem["memberPreviews"]>;
	appearances?: ReadonlyMap<string, SpaceMemberAppearance>;
	layout?: "compact" | "horizontal" | "grid";
	memberCount?: number | null;
	compactSize?: 20 | 24;
}) {
	const horizontal = input.layout === "horizontal";
	const grid = input.layout === "grid";
	const members = input.members.slice(0, horizontal ? 5 : 3);
	const remaining = Math.max(
		0,
		(input.memberCount ?? members.length) - members.length
	);
	const compactSize = input.compactSize ?? 20;
	const compactMemberSize =
		members.length === 1 ? compactSize : Math.round(compactSize * 0.6);
	const rowSize = horizontal ? 20 : compactMemberSize;
	const size = grid ? 40 : rowSize;
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
			className={cn(
				"shrink-0",
				grid && "grid size-24 place-items-center gap-2",
				grid &&
					(members.length === 1 && !remaining ? "grid-cols-1" : "grid-cols-2"),
				horizontal && "isolate inline-flex h-5 max-w-full items-center",
				!(grid || horizontal) && "relative"
			)}
			data-slot="space-member-avatars"
			style={
				horizontal || grid
					? undefined
					: { width: compactSize, height: compactSize }
			}
		>
			{members.map((member, index) => (
				<span
					className={cn(
						"flex",
						horizontal &&
							"relative shrink-0 bg-background ring-1 ring-background",
						!(grid || horizontal) &&
							`absolute bg-sidebar ring-1 ring-sidebar ${positions[index]}`
					)}
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
							avatarStyle={
								input.appearances?.get(member.profileId)?.avatarStyle
							}
							modelId={input.appearances?.get(member.profileId)?.avatarModelId}
							profileId={member.profileId}
							profileName={member.profileName}
							size={size}
							variant={grid ? "plain" : undefined}
						/>
					)}
				</span>
			))}
			{grid && remaining > 0 && (
				<span className="text-muted-foreground text-sm tabular-nums">
					+{remaining}
				</span>
			)}
		</span>
	);
}
