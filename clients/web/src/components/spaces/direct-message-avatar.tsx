import { ChatCircleTextIcon } from "@phosphor-icons/react";
import type { resolveDirectMessagePresentation } from "./direct-message-presentation";
import { SpaceMemberAvatars } from "./space-member-avatars";
import { SpaceProfileIcon } from "./space-profile-icon";

type Presentation = ReturnType<typeof resolveDirectMessagePresentation>;

export function DirectMessageAvatar(input: {
	peer?: Presentation["peer"];
	participants?: Presentation["participants"];
	size?: "sm" | "sidebar" | "card";
}) {
	if (input.peer) {
		return (
			<SpaceProfileIcon
				{...input.peer}
				avatarImageUrl={input.peer.avatarUrl}
				size={input.size ?? "sm"}
			/>
		);
	}
	if (input.participants?.length === 2) {
		return (
			<SpaceMemberAvatars
				appearances={
					new Map(
						input.participants.map((profile) => [profile.profileId, profile])
					)
				}
				compactSize={24}
				layout={input.size === "card" ? "grid" : "compact"}
				members={input.participants}
			/>
		);
	}
	return (
		<ChatCircleTextIcon
			aria-label="Direct Message"
			className="size-6 shrink-0"
		/>
	);
}
