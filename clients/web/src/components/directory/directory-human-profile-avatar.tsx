import { cn } from "@openmeld/ui/lib/utils";
import { UserIcon } from "@phosphor-icons/react";
import type { DirectoryHumanProfileRow } from "#/components/directory/directory-human-profile-model";
import { DitherProfileAvatar } from "#/components/profiles/dither-profile-avatar";

const AVATAR_SIZE = {
	card: 56,
	detail: 96,
} as const;

export function DirectoryHumanProfileAvatar(input: {
	context: keyof typeof AVATAR_SIZE;
	member: DirectoryHumanProfileRow;
}) {
	const size = AVATAR_SIZE[input.context];
	if (input.member.profileStatus !== null) {
		return (
			<DitherProfileAvatar
				avatarImageUrl={input.member.avatarImageUrl}
				className={cn("shrink-0", input.context === "card" && "mt-0.5")}
				data-testid={
					input.context === "card"
						? `human-profile-avatar-${input.member.id}`
						: undefined
				}
				profileId={input.member.id}
				profileKind="human"
				profileName={input.member.name}
				size={size}
			/>
		);
	}

	return (
		<span
			className={cn(
				"grid shrink-0 place-items-center rounded-md border border-border bg-background text-muted-foreground",
				input.context === "card" ? "size-14" : "size-24"
			)}
			data-testid={
				input.context === "detail"
					? `human-profile-avatar-placeholder-${input.member.id}`
					: undefined
			}
		>
			<UserIcon
				aria-hidden="true"
				className={input.context === "card" ? "size-6" : "size-10"}
			/>
		</span>
	);
}
