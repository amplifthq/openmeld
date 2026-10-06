import type {
	OrganizationDirectoryMember,
	RoutineManagement,
} from "@openmeld/schemas/types";
import { ChatCircleIcon, UserIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { DitherProfileAvatar } from "#/components/profiles/dither-profile-avatar";
import { useCurrentOrganizationSlug } from "#/lib/organizations/organization-context";
import { buildOrganizationSpacePath } from "#/lib/organizations/organization-routes";
import { spaceStatusQueryOptions } from "#/query/spaces/status";

export function RoutineCreator({
	routine,
	member,
	pending,
}: {
	routine: RoutineManagement;
	member?: OrganizationDirectoryMember;
	pending: boolean;
}) {
	const name =
		member?.humanProfile?.profileName ??
		member?.user.name ??
		routine.creationAttribution.displayName;
	return (
		<div className="flex max-w-40 items-center gap-2" title={name ?? undefined}>
			{member?.humanProfile ? (
				<DitherProfileAvatar
					avatarImageUrl={member.user.image}
					profileId={member.humanProfile.profileId}
					profileKind="human"
					profileName={name ?? member.user.name}
					size={20}
				/>
			) : (
				<UserIcon
					aria-hidden="true"
					className="size-5 shrink-0 text-muted-foreground"
				/>
			)}
			<span className="truncate">
				{name ?? (pending ? "Loading…" : "Name unavailable")}
			</span>
		</div>
	);
}

export function RoutineDestination({
	routine,
	name,
	pending,
}: {
	routine: RoutineManagement;
	name?: string;
	pending: boolean;
}) {
	const orgSlug = useCurrentOrganizationSlug();
	// The directory covers ordinary Spaces in one read. Resolve private chats or
	// destinations absent from that directory through the existing authorized API.
	const space = useQuery(
		spaceStatusQueryOptions({
			spaceId: routine.targetSpaceId ?? "",
			enabled:
				routine.destinationKind === "space" &&
				Boolean(routine.targetSpaceId) &&
				!name &&
				!pending,
		})
	);
	if (routine.destinationKind !== "space") {
		return (
			<span className="text-muted-foreground">Connected conversation</span>
		);
	}
	const label = name ?? space.data?.name;
	if (!(label && routine.targetSpaceId)) {
		return (
			<span className="text-muted-foreground">
				{pending || space.isLoading ? "Loading…" : "Space unavailable"}
			</span>
		);
	}
	return (
		<Link
			className="flex max-w-44 items-center gap-1.5 underline-offset-4 hover:underline"
			title={label}
			to={buildOrganizationSpacePath({
				orgSlug,
				spaceId: routine.targetSpaceId,
			})}
		>
			<ChatCircleIcon
				aria-hidden="true"
				className="size-4 shrink-0 text-muted-foreground"
			/>
			<span className="truncate">{label}</span>
		</Link>
	);
}
