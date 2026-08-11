import {
	Avatar,
	AvatarBadge,
	AvatarFallback,
	AvatarGroup,
	AvatarGroupCount,
	AvatarImage,
} from "@openmeld/ui/components/avatar";
import { resolveStatusToneIndicatorClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import type {
	ActivityFoldedMember,
	ActivityMember,
} from "./agent-activity-derive";

const WHITESPACE_PATTERN = /\s+/u;

export function AgentActivityMemberAvatar(input: {
	active?: boolean;
	className?: string;
	member: ActivityMember;
	size?: "default" | "lg" | "sm";
}) {
	return (
		<Avatar className={input.className} size={input.size}>
			{input.member.image ? (
				<AvatarImage alt="" src={input.member.image} />
			) : null}
			<AvatarFallback>{formatInitials(input.member.name)}</AvatarFallback>
			{input.active ? (
				<AvatarBadge
					aria-label="Working now"
					className={cn(
						"agent-activity-presence-breathe",
						resolveStatusToneIndicatorClassName("ready", "solid")
					)}
				/>
			) : null}
		</Avatar>
	);
}

export function AgentActivityFoldedAvatarGroup(input: {
	members: ActivityFoldedMember[];
}) {
	const visibleMembers = input.members.slice(0, 4);
	const remainingCount = input.members.length - visibleMembers.length;
	return (
		<AvatarGroup aria-label="Members with no recent activity">
			{visibleMembers.map((member) => (
				<AgentActivityMemberAvatar
					key={member.memberUserId}
					member={member.member}
					size="sm"
				/>
			))}
			{remainingCount > 0 ? (
				<AvatarGroupCount>+{String(remainingCount)}</AvatarGroupCount>
			) : null}
		</AvatarGroup>
	);
}

function formatInitials(name: string) {
	const words = name.trim().split(WHITESPACE_PATTERN).filter(Boolean);
	if (words.length === 0) {
		return "?";
	}
	if (words.length === 1) {
		return words[0]?.slice(0, 2).toUpperCase() ?? "?";
	}
	return words
		.slice(0, 2)
		.map((word) => word.charAt(0).toUpperCase())
		.join("");
}
